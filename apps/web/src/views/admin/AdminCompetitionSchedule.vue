<script setup lang="ts">
/**
 * 赛道 / 赛程阶段 / 时间节点 编辑器（管理后台竞赛编辑页「赛道与赛程」标签）
 *
 * 结构：Competition → Track（赛道）→ Stage（阶段）→ Event（时间节点）。
 * 每个动作即时落库（新增/编辑/删除后重新拉取详情），不做整表单 diff，
 * 避免旧版「时间节点随大表单提交、被静默丢弃/误删」的问题。
 * 时间节点的日期改动由后端自动加锁并写入版本记录，可在「版本回滚」里恢复。
 */
import { ref, onMounted, computed, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { dayjs } from '../../api/types';
import { api } from '../../api/client';

const props = defineProps<{ competitionId: string }>();

interface EventRow {
  id: string;
  stageId: string;
  nodeType: string;
  label: string | null;
  startAt: string | null;
  endAt: string | null;
  location: string | null;
  isLocked: boolean;
}
interface StageRow {
  id: string;
  trackId: string | null;
  code: string;
  name: string;
  stageKind: string;
  scope: string | null;
  sequence: number;
  bonusTier: string | null;
  note: string | null;
  events: EventRow[];
}
interface TrackRow {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  format: string | null;
  teamSizeMin: number | null;
  teamSizeMax: number | null;
}

const loading = ref(true);
const tracks = ref<TrackRow[]>([]);
const stages = ref<StageRow[]>([]);
const collapsed = ref<Record<string, boolean>>({});

const STAGE_KIND_OPTIONS = [
  { value: 'CAMPUS', label: '校级' },
  { value: 'QUALIFIER', label: '预选 / 资格赛' },
  { value: 'REGIONAL', label: '区域 / 分区赛' },
  { value: 'PROVINCIAL', label: '省级' },
  { value: 'NATIONAL', label: '国家级' },
  { value: 'INTERNATIONAL', label: '国际赛' },
  { value: 'FINAL', label: '总决赛' },
  { value: 'OTHER', label: '其他' },
];
const STAGE_KIND_LABEL: Record<string, string> = Object.fromEntries(STAGE_KIND_OPTIONS.map((o) => [o.value, o.label]));

const BONUS_TIER_OPTIONS = [
  { value: 'NATIONAL', label: '国家级' },
  { value: 'PROVINCIAL', label: '省级' },
  { value: 'NONE', label: '不认定' },
];
const BONUS_TIER_LABEL: Record<string, string> = Object.fromEntries(BONUS_TIER_OPTIONS.map((o) => [o.value, o.label]));

const NODE_TYPE_OPTIONS = [
  { value: 'SIGNUP_START', label: '报名开始' },
  { value: 'SIGNUP_END', label: '报名截止' },
  { value: 'SUBMISSION', label: '作品提交' },
  { value: 'CONTEST', label: '比赛 / 答辩' },
  { value: 'RESULT', label: '结果公布' },
  { value: 'AWARD', label: '颁奖' },
  { value: 'OTHER', label: '其他' },
];
const NODE_TYPE_LABEL: Record<string, string> = Object.fromEntries(NODE_TYPE_OPTIONS.map((o) => [o.value, o.label]));

const eventCount = computed(() => stages.value.reduce((n, s) => n + s.events.length, 0));

const sorted = (list: StageRow[]) => [...list].sort((a, b) => a.sequence - b.sequence || a.name.localeCompare(b.name));

/** 共享阶段（trackId=null）+ 每个赛道一组，模板只渲染这一份分组 */
const groups = computed(() => {
  const out: { key: string; track: TrackRow | null; stages: StageRow[] }[] = [
    { key: '__shared__', track: null, stages: sorted(stages.value.filter((s) => !s.trackId)) },
  ];
  for (const t of tracks.value) {
    out.push({ key: t.id, track: t, stages: sorted(stages.value.filter((s) => s.trackId === t.id)) });
  }
  return out;
});

async function load() {
  loading.value = true;
  try {
    const c = await api.get<{ tracks?: TrackRow[]; stages?: StageRow[] }>(`/admin/competitions/${props.competitionId}`);
    tracks.value = (c.tracks ?? []).map((t) => ({ ...t }));
    stages.value = (c.stages ?? []).map((s) => ({ ...s, events: (s.events ?? []).map((e) => ({ ...e })) }));
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '赛程数据加载失败');
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => props.competitionId, load);

function toggle(key: string) {
  collapsed.value[key] = !collapsed.value[key];
}

/** 存储的是 UTC 瞬时；转成本地时区文本回填到日期选择器（否则跨时区会偏移小时） */
const toLocalPicker = (iso: string | null) => (iso ? dayjs(iso).format('YYYY-MM-DDTHH:mm') : null);
const rangeText = (s: string | null, e: string | null) => {
  const a = s ? dayjs(s).format('YYYY-MM-DD HH:mm') : '—';
  const b = e ? dayjs(e).format('YYYY-MM-DD HH:mm') : '—';
  return `${a} → ${b}`;
};

/* ==================== 赛道 ==================== */
const trackDialog = ref(false);
const trackSaving = ref(false);
const trackForm = ref({
  id: '',
  code: '',
  name: '',
  shortName: '',
  description: '',
  sortOrder: 0,
  format: '' as '' | 'INDIVIDUAL' | 'TEAM',
  teamSizeMin: null as number | null,
  teamSizeMax: null as number | null,
  isActive: true,
});

function openTrackDialog(t: TrackRow | null) {
  trackForm.value = t
    ? {
        id: t.id,
        code: t.code,
        name: t.name,
        shortName: t.shortName ?? '',
        description: t.description ?? '',
        sortOrder: t.sortOrder,
        format: (t.format as '' | 'INDIVIDUAL' | 'TEAM') ?? '',
        teamSizeMin: t.teamSizeMin,
        teamSizeMax: t.teamSizeMax,
        isActive: t.isActive,
      }
    : { id: '', code: '', name: '', shortName: '', description: '', sortOrder: tracks.value.length, format: '', teamSizeMin: null, teamSizeMax: null, isActive: true };
  trackDialog.value = true;
}

async function saveTrack() {
  const f = trackForm.value;
  if (!f.code.trim()) {
    ElMessage.warning('请填写赛道编码（跨届次稳定标识）');
    return;
  }
  if (!f.name.trim()) {
    ElMessage.warning('请填写赛道名称');
    return;
  }
  trackSaving.value = true;
  try {
    const payload = {
      code: f.code.trim(),
      name: f.name.trim(),
      shortName: f.shortName.trim() || null,
      description: f.description.trim() || null,
      sortOrder: f.sortOrder,
      format: f.format || null,
      teamSizeMin: f.teamSizeMin ?? null,
      teamSizeMax: f.teamSizeMax ?? null,
      isActive: f.isActive,
    };
    if (f.id) await api.put(`/admin/tracks/${f.id}`, payload);
    else await api.post(`/admin/competitions/${props.competitionId}/tracks`, payload);
    trackDialog.value = false;
    ElMessage.success(f.id ? '赛道已更新' : '赛道已新增');
    await load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败');
  } finally {
    trackSaving.value = false;
  }
}

async function removeTrack(t: TrackRow) {
  const count = stages.value.filter((s) => s.trackId === t.id).length;
  try {
    await ElMessageBox.confirm(
      `删除赛道「${t.name}」会同时删除其下 ${count} 个赛程阶段及全部时间节点，且不可撤销。确定继续？`,
      '删除赛道',
      { type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger' },
    );
  } catch {
    return;
  }
  try {
    await api.delete(`/admin/tracks/${t.id}`);
    ElMessage.success('赛道已删除');
    await load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败');
  }
}

/* ==================== 赛程阶段 ==================== */
const stageDialog = ref(false);
const stageSaving = ref(false);
const stageForm = ref({
  id: '',
  trackId: '' as string,
  code: '',
  name: '',
  stageKind: 'CAMPUS',
  scope: '',
  sequence: 0,
  bonusTier: '' as '' | 'NATIONAL' | 'PROVINCIAL' | 'NONE',
  note: '',
});

function openStageDialog(stage: StageRow | null, trackId: string | null) {
  if (stage) {
    stageForm.value = {
      id: stage.id,
      trackId: stage.trackId ?? '',
      code: stage.code,
      name: stage.name,
      stageKind: stage.stageKind,
      scope: stage.scope ?? '',
      sequence: stage.sequence,
      bonusTier: (stage.bonusTier as '' | 'NATIONAL' | 'PROVINCIAL' | 'NONE') ?? '',
      note: stage.note ?? '',
    };
  } else {
    const tid = trackId ?? '';
    const siblings = stages.value.filter((s) => (s.trackId ?? '') === tid);
    stageForm.value = {
      id: '',
      trackId: tid,
      code: '',
      name: '',
      stageKind: 'CAMPUS',
      scope: '',
      sequence: siblings.length,
      bonusTier: '',
      note: '',
    };
  }
  stageDialog.value = true;
}

async function saveStage() {
  const f = stageForm.value;
  if (!f.code.trim()) {
    ElMessage.warning('请填写阶段编码（稳定标识，如 SIGNUP / FINAL）');
    return;
  }
  if (!f.name.trim()) {
    ElMessage.warning('请填写阶段名称');
    return;
  }
  stageSaving.value = true;
  try {
    const payload = {
      trackId: f.trackId || null,
      code: f.code.trim(),
      name: f.name.trim(),
      stageKind: f.stageKind,
      scope: f.scope.trim() || null,
      sequence: f.sequence,
      bonusTier: f.bonusTier || null,
      note: f.note.trim() || null,
    };
    if (f.id) await api.put(`/admin/stages/${f.id}`, payload);
    else await api.post(`/admin/competitions/${props.competitionId}/stages`, payload);
    stageDialog.value = false;
    ElMessage.success(f.id ? '阶段已更新' : '阶段已新增');
    await load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败');
  } finally {
    stageSaving.value = false;
  }
}

async function removeStage(s: StageRow) {
  try {
    await ElMessageBox.confirm(
      `删除阶段「${s.name}」会同时删除其下 ${s.events.length} 个时间节点，且不可撤销。确定继续？`,
      '删除赛程阶段',
      { type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger' },
    );
  } catch {
    return;
  }
  try {
    await api.delete(`/admin/stages/${s.id}`);
    ElMessage.success('阶段已删除');
    await load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败');
  }
}

/* ==================== 时间节点 ==================== */
const eventDialog = ref(false);
const eventSaving = ref(false);
const eventForm = ref({
  id: '',
  stageId: '',
  nodeType: 'CONTEST',
  label: '',
  startAt: null as string | null,
  endAt: null as string | null,
  location: '',
});

function openEventDialog(stage: StageRow, e: EventRow | null) {
  eventForm.value = e
    ? {
        id: e.id,
        stageId: stage.id,
        nodeType: e.nodeType,
        label: e.label ?? '',
        startAt: toLocalPicker(e.startAt),
        endAt: toLocalPicker(e.endAt),
        location: e.location ?? '',
      }
    : { id: '', stageId: stage.id, nodeType: 'CONTEST', label: '', startAt: null, endAt: null, location: '' };
  eventDialog.value = true;
}

async function saveEvent() {
  const f = eventForm.value;
  if (!f.startAt && !f.endAt) {
    ElMessage.warning('请至少填写开始或截止时间');
    return;
  }
  if (f.startAt && f.endAt && new Date(f.endAt) < new Date(f.startAt)) {
    ElMessage.warning('截止时间不能早于开始时间');
    return;
  }
  eventSaving.value = true;
  try {
    const payload = {
      stageId: f.stageId,
      nodeType: f.nodeType,
      label: f.label.trim() || null,
      location: f.location.trim() || null,
      // 本地时间 → ISO 瞬时；服务端按同一瞬时入库，前端再按本地展示，跨时区不偏移
      startAt: f.startAt ? new Date(f.startAt).toISOString() : null,
      endAt: f.endAt ? new Date(f.endAt).toISOString() : null,
    };
    if (f.id) await api.put(`/admin/events/${f.id}`, payload);
    else await api.post(`/admin/competitions/${props.competitionId}/events`, payload);
    eventDialog.value = false;
    ElMessage.success(f.id ? '时间节点已更新（日期改动已自动加锁并留痕）' : '时间节点已新增');
    await load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败');
  } finally {
    eventSaving.value = false;
  }
}

async function removeEvent(e: EventRow) {
  try {
    await ElMessageBox.confirm(`删除该时间节点「${e.label || NODE_TYPE_LABEL[e.nodeType] || e.nodeType}」？`, '删除时间节点', {
      type: 'warning',
      confirmButtonText: '删除',
      confirmButtonClass: 'el-button--danger',
    });
  } catch {
    return;
  }
  try {
    await api.delete(`/admin/events/${e.id}`);
    ElMessage.success('节点已删除');
    await load();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '删除失败');
  }
}

/** 阶段下拉：共享 + 各赛道（给节点/阶段编辑弹窗复用） */
const stageScopeOptions = computed(() => [
  { value: '', label: '全赛事共享' },
  ...tracks.value.map((t) => ({ value: t.id, label: `赛道：${t.name}` })),
]);
</script>

<template>
  <div v-loading="loading" class="flex flex-col gap-14px">
    <!-- 概览 + 全局操作 -->
    <div class="sched-head">
      <div class="stat"><span>赛道</span><b>{{ tracks.length }}</b></div>
      <div class="stat"><span>赛程阶段</span><b>{{ stages.length }}</b></div>
      <div class="stat"><span>时间节点</span><b>{{ eventCount }}</b></div>
      <div class="ml-auto flex items-center gap-8px flex-wrap">
        <el-button size="small" round @click="openTrackDialog(null)">+ 新增赛道</el-button>
      </div>
    </div>

    <p class="sched-tip">
      单赛道赛事可直接用「全赛事共享阶段」；多赛道（如电赛 A/B 题）先建赛道，再在赛道下建阶段与节点。
      时间节点的日期改动会自动加锁，并在「版本回滚」中留痕可恢复。
    </p>

    <!-- 分组渲染：共享阶段 + 每个赛道 -->
    <section v-for="g in groups" :key="g.key" class="sched-block">
      <header class="sched-block-head">
        <button class="collapse-toggle" :aria-expanded="!collapsed[g.key]" @click="toggle(g.key)">
          <svg viewBox="0 0 24 24" fill="none" :class="{ 'is-open': !collapsed[g.key] }"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <template v-if="g.track">
          <h3 class="sched-title">{{ g.track.name }}</h3>
          <code class="sched-code">{{ g.track.code }}</code>
          <el-tag v-if="!g.track.isActive" size="small" type="info" effect="plain" round>已停用</el-tag>
          <el-tag v-if="g.track.format" size="small" effect="plain" round>
            {{ g.track.format === 'TEAM' ? '团队赛' : '个人赛' }}
            <template v-if="g.track.format === 'TEAM' && (g.track.teamSizeMin || g.track.teamSizeMax)">
              （{{ g.track.teamSizeMin ?? '?' }}–{{ g.track.teamSizeMax ?? '?' }} 人）
            </template>
          </el-tag>
          <span class="sched-count">{{ g.stages.length }} 个阶段</span>
          <div class="ml-auto flex items-center gap-4px">
            <el-button size="small" link type="primary" @click="openStageDialog(null, g.track.id)">+ 阶段</el-button>
            <el-button size="small" link @click="openTrackDialog(g.track)">编辑赛道</el-button>
            <el-button size="small" link type="danger" @click="removeTrack(g.track)">删除赛道</el-button>
          </div>
        </template>
        <template v-else>
          <h3 class="sched-title">全赛事共享阶段</h3>
          <span class="sched-count">{{ g.stages.length }} 个阶段</span>
          <div class="ml-auto">
            <el-button size="small" link type="primary" @click="openStageDialog(null, null)">+ 阶段</el-button>
          </div>
        </template>
      </header>

      <div v-show="!collapsed[g.key]" class="sched-body">
        <div v-if="!g.stages.length" class="stage-empty">暂无阶段，点击右上「+ 阶段」添加</div>
        <div v-for="s in g.stages" :key="s.id" class="stage-card">
          <div class="stage-head">
            <span class="seq">{{ s.sequence }}</span>
            <span class="kind-chip">{{ STAGE_KIND_LABEL[s.stageKind] || s.stageKind }}</span>
            <span class="stage-name">{{ s.name }}</span>
            <code class="sched-code">{{ s.code }}</code>
            <span v-if="s.bonusTier" class="tier-chip">{{ BONUS_TIER_LABEL[s.bonusTier] }}</span>
            <span class="sched-count">{{ s.events.length }} 个节点</span>
            <div class="ml-auto flex items-center gap-4px">
              <el-button size="small" link type="primary" @click="openEventDialog(s, null)">+ 节点</el-button>
              <el-button size="small" link @click="openStageDialog(s, null)">编辑</el-button>
              <el-button size="small" link type="danger" @click="removeStage(s)">删除</el-button>
            </div>
          </div>
          <div v-if="s.scope || s.note" class="stage-sub">{{ [s.scope, s.note].filter(Boolean).join(' · ') }}</div>

          <div class="event-list">
            <div v-for="e in s.events" :key="e.id" class="event-row">
              <span class="etype">{{ e.label || NODE_TYPE_LABEL[e.nodeType] || e.nodeType }}</span>
              <span class="edate">{{ rangeText(e.startAt, e.endAt) }}</span>
              <span v-if="e.location" class="eloc">{{ e.location }}</span>
              <el-tooltip v-if="e.isLocked" content="该时间已人工修改并加锁，不会被自动更新覆盖" placement="top">
                <el-icon class="lock"><i-ep-lock /></el-icon>
              </el-tooltip>
              <div class="ml-auto flex items-center gap-4px">
                <el-button size="small" link type="primary" @click="openEventDialog(s, e)">编辑</el-button>
                <el-button size="small" link type="danger" @click="removeEvent(e)">删除</el-button>
              </div>
            </div>
            <div v-if="!s.events.length" class="event-empty">暂无时间节点</div>
          </div>
        </div>
      </div>
    </section>

    <el-empty v-if="!tracks.length" :image-size="60" description="暂无赛道；单赛道赛事可直接用共享阶段，多赛道赛事请点右上「新增赛道」" />

    <!-- ============ 赛道弹窗 ============ -->
    <el-dialog v-model="trackDialog" :title="trackForm.id ? '编辑赛道' : '新增赛道'" width="min(560px, 94vw)">
      <div class="flex flex-col gap-12px">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-12px">
          <div>
            <div class="f-label">赛道编码 *（跨届次稳定，如 A / PRACTICE）</div>
            <el-input v-model="trackForm.code" placeholder="A" />
          </div>
          <div>
            <div class="f-label">赛道名称 *</div>
            <el-input v-model="trackForm.name" placeholder="A 题：电源类" />
          </div>
          <div>
            <div class="f-label">简称</div>
            <el-input v-model="trackForm.shortName" placeholder="A 题" />
          </div>
          <div>
            <div class="f-label">排序</div>
            <el-input-number v-model="trackForm.sortOrder" :min="0" :max="9999" controls-position="right" style="width: 100%" />
          </div>
          <div>
            <div class="f-label">赛制（留空沿用赛事级）</div>
            <el-select v-model="trackForm.format" placeholder="沿用赛事级" clearable style="width: 100%">
              <el-option value="INDIVIDUAL" label="个人赛" />
              <el-option value="TEAM" label="团队赛" />
            </el-select>
          </div>
          <div>
            <div class="f-label">状态</div>
            <el-select v-model="trackForm.isActive" style="width: 100%">
              <el-option :value="true" label="启用" />
              <el-option :value="false" label="停用" />
            </el-select>
          </div>
          <div>
            <div class="f-label">团队人数下限</div>
            <el-input-number v-model="trackForm.teamSizeMin" :min="1" :max="99" controls-position="right" style="width: 100%" />
          </div>
          <div>
            <div class="f-label">团队人数上限</div>
            <el-input-number v-model="trackForm.teamSizeMax" :min="1" :max="99" controls-position="right" style="width: 100%" />
          </div>
        </div>
        <div>
          <div class="f-label">赛道说明</div>
          <el-input v-model="trackForm.description" type="textarea" :rows="2" placeholder="该赛道考察内容、适合人群等" />
        </div>
      </div>
      <template #footer>
        <el-button @click="trackDialog = false">取消</el-button>
        <el-button type="primary" :loading="trackSaving" @click="saveTrack">保存</el-button>
      </template>
    </el-dialog>

    <!-- ============ 阶段弹窗 ============ -->
    <el-dialog v-model="stageDialog" :title="stageForm.id ? '编辑赛程阶段' : '新增赛程阶段'" width="min(560px, 94vw)">
      <div class="flex flex-col gap-12px">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-12px">
          <div>
            <div class="f-label">归属</div>
            <el-select v-model="stageForm.trackId" style="width: 100%">
              <el-option v-for="o in stageScopeOptions" :key="o.value" :value="o.value" :label="o.label" />
            </el-select>
          </div>
          <div>
            <div class="f-label">阶段类型 *</div>
            <el-select v-model="stageForm.stageKind" style="width: 100%">
              <el-option v-for="o in STAGE_KIND_OPTIONS" :key="o.value" :value="o.value" :label="o.label" />
            </el-select>
          </div>
          <div>
            <div class="f-label">阶段编码 *（稳定标识，如 SIGNUP / FINAL）</div>
            <el-input v-model="stageForm.code" placeholder="FINAL" />
          </div>
          <div>
            <div class="f-label">阶段名称 *</div>
            <el-input v-model="stageForm.name" placeholder="全国总决赛" />
          </div>
          <div>
            <div class="f-label">顺序（序号越小越靠前）</div>
            <el-input-number v-model="stageForm.sequence" :min="0" :max="9999" controls-position="right" style="width: 100%" />
          </div>
          <div>
            <div class="f-label">加分档次</div>
            <el-select v-model="stageForm.bonusTier" placeholder="不认定" clearable style="width: 100%">
              <el-option v-for="o in BONUS_TIER_OPTIONS" :key="o.value" :value="o.value" :label="o.label" />
            </el-select>
          </div>
        </div>
        <div>
          <div class="f-label">范围说明</div>
          <el-input v-model="stageForm.scope" placeholder="如：华北赛区 / 面向全校本科生" />
        </div>
        <div>
          <div class="f-label">备注</div>
          <el-input v-model="stageForm.note" type="textarea" :rows="2" placeholder="承办地、赛制细节等补充信息" />
        </div>
      </div>
      <template #footer>
        <el-button @click="stageDialog = false">取消</el-button>
        <el-button type="primary" :loading="stageSaving" @click="saveStage">保存</el-button>
      </template>
    </el-dialog>

    <!-- ============ 时间节点弹窗 ============ -->
    <el-dialog v-model="eventDialog" :title="eventForm.id ? '编辑时间节点' : '新增时间节点'" width="min(560px, 94vw)">
      <div class="flex flex-col gap-12px">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-12px">
          <div>
            <div class="f-label">节点类型</div>
            <el-select v-model="eventForm.nodeType" style="width: 100%">
              <el-option v-for="o in NODE_TYPE_OPTIONS" :key="o.value" :value="o.value" :label="o.label" />
            </el-select>
          </div>
          <div>
            <div class="f-label">自定义名称（选填，覆盖类型默认名）</div>
            <el-input v-model="eventForm.label" placeholder="如：实践赛报名截止" />
          </div>
          <div>
            <div class="f-label">开始时间</div>
            <el-date-picker
              v-model="eventForm.startAt"
              type="datetime"
              placeholder="开始"
              style="width: 100%"
              format="YYYY-MM-DD HH:mm"
              value-format="YYYY-MM-DDTHH:mm"
            />
          </div>
          <div>
            <div class="f-label">截止时间</div>
            <el-date-picker
              v-model="eventForm.endAt"
              type="datetime"
              placeholder="截止"
              style="width: 100%"
              format="YYYY-MM-DD HH:mm"
              value-format="YYYY-MM-DDTHH:mm"
            />
          </div>
        </div>
        <div>
          <div class="f-label">地点（选填）</div>
          <el-input v-model="eventForm.location" placeholder="线上 / 清水河校区…" />
        </div>
        <div class="text-12px color-ink-faint">修改已有节点的日期会自动将其标记为「人工锁定」并写入版本记录，可在「版本回滚」恢复。</div>
      </div>
      <template #footer>
        <el-button @click="eventDialog = false">取消</el-button>
        <el-button type="primary" :loading="eventSaving" @click="saveEvent">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.f-label {
  font-size: 13px;
  color: var(--ink-soft);
  margin-bottom: 6px;
}
.sched-head {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(15, 76, 140, 0.06), rgba(255, 255, 255, 0.5));
  border: 1px solid rgba(15, 76, 140, 0.1);
}
.stat {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12.5px;
  color: var(--ink-soft);
}
.stat b {
  font-size: 17px;
  color: var(--uestc-blue);
  font-variant-numeric: tabular-nums;
}
.sched-tip {
  font-size: 12px;
  color: var(--ink-faint);
  margin: 0;
  line-height: 1.6;
}
.sched-block {
  border-radius: 14px;
  border: 1px solid rgba(15, 76, 140, 0.1);
  background: rgba(255, 255, 255, 0.5);
  overflow: hidden;
}
.sched-block-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(15, 76, 140, 0.04);
  flex-wrap: wrap;
}
.collapse-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 7px;
  background: rgba(15, 76, 140, 0.08);
  color: var(--uestc-blue);
  cursor: pointer;
  flex: none;
}
.collapse-toggle svg {
  width: 15px;
  height: 15px;
  transition: transform 0.18s ease;
}
.collapse-toggle svg.is-open {
  transform: rotate(90deg);
}
.sched-title {
  font-size: 14px;
  font-weight: 700;
  margin: 0;
  color: var(--ink);
}
.sched-code {
  font-size: 11px;
  color: var(--ink-faint);
  background: rgba(15, 76, 140, 0.07);
  padding: 1px 6px;
  border-radius: 6px;
}
.sched-count {
  font-size: 12px;
  color: var(--ink-faint);
}
.sched-body {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.stage-card {
  border-radius: 12px;
  border: 1px solid rgba(15, 76, 140, 0.1);
  background: rgba(255, 255, 255, 0.72);
  padding: 10px 12px;
}
.stage-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.seq {
  width: 20px;
  height: 20px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, var(--uestc-blue), #1f63a0);
  flex: none;
}
.kind-chip {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 999px;
  background: rgba(15, 76, 140, 0.09);
  color: var(--uestc-blue);
  font-weight: 600;
  flex: none;
}
.tier-chip {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 999px;
  background: rgba(245, 185, 1, 0.18);
  color: #8a5800;
  font-weight: 600;
  flex: none;
}
.stage-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink);
}
.stage-sub {
  font-size: 11.5px;
  color: var(--ink-faint);
  margin: 5px 0 0 28px;
}
.event-list {
  margin: 8px 0 0 28px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.event-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 9px;
  border-radius: 9px;
  background: rgba(15, 76, 140, 0.045);
  flex-wrap: wrap;
}
.etype {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink);
  min-width: 90px;
}
.edate {
  font-size: 12px;
  color: var(--uestc-blue);
  font-variant-numeric: tabular-nums;
}
.eloc {
  font-size: 11.5px;
  color: var(--ink-faint);
}
.lock {
  font-size: 12px;
  color: var(--ink-faint);
}
.event-empty {
  font-size: 12px;
  color: var(--ink-faint);
  padding: 4px 0 2px;
}
.stage-empty {
  font-size: 12.5px;
  color: var(--ink-faint);
  padding: 10px 4px;
}
</style>
