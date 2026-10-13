<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  Audience,
  AudienceLabel,
  CompetitionFormat,
  Level,
  LevelLabel,
  PublishStatus,
  PublishStatusLabel,
} from '@teamup/shared';
import { api } from '../../api/client';
import AdminCompetitionSchedule from './AdminCompetitionSchedule.vue';

const route = useRoute();
const router = useRouter();

const isEdit = computed(() => !!route.params.id);
const saving = ref(false);
const activeTab = ref('basic');

const form = ref({
  name: '',
  code: '',
  year: new Date().getFullYear() as number | null,
  aliases: [] as string[],
  organizer: '',
  officialUrl: '',
  format: null as CompetitionFormat | null,
  teamSizeMin: null as number | null,
  teamSizeMax: null as number | null,
  audience: null as Audience | null,
  intro: '',
  difficulty: null as number | null,
  effort: null as number | null,
  isBonusEligible: null as boolean | null,
  bonusCategory: '',
  bonusSpecialRule: '',
  sourceUrl: '',
  status: PublishStatus.PUBLISHED,
  levels: [] as Level[],
  tags: [] as string[],
});

/** 竞赛自定义键值字段 */
interface CustomFieldRow { id: string; key: string; value: string }
const customFields = ref<CustomFieldRow[]>([]);
const newFieldKey = ref('');
const newFieldValue = ref('');
const newFieldSaving = ref(false);

const levelOptions = Object.values(Level).map((l) => ({ value: l, label: LevelLabel[l] }));

/** 后端 adminDetail 现在返回字符串数组；防御性归一化，收到对象形态也不崩 */
function toStr(v: unknown): string {
  if (typeof v === 'string') return v;
  const o = v as { level?: unknown; name?: unknown } | null;
  return String(o?.level ?? o?.name ?? '');
}

onMounted(async () => {
  if (!isEdit.value) return;
  let c: Record<string, any>;
  try {
    c = await api.get<Record<string, any>>(`/admin/competitions/${route.params.id}`);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '竞赛信息加载失败');
    router.push({ name: 'admin-competitions' });
    return;
  }
  form.value = {
    name: c.name ?? '',
    code: c.code ?? '',
    year: c.year ?? new Date().getFullYear(),
    aliases: Array.isArray(c.aliases) ? c.aliases : [],
    organizer: c.organizer ?? '',
    officialUrl: c.officialUrl ?? '',
    format: (c.format ?? null) as CompetitionFormat | null,
    teamSizeMin: c.teamSizeMin ?? null,
    teamSizeMax: c.teamSizeMax ?? null,
    audience: (c.audience ?? null) as Audience | null,
    intro: c.intro ?? '',
    difficulty: c.difficulty ?? null,
    effort: c.effort ?? null,
    isBonusEligible: c.isBonusEligible ?? null,
    bonusCategory: c.bonusCategory ?? '',
    bonusSpecialRule: c.bonusSpecialRule ?? '',
    sourceUrl: c.sourceUrl ?? '',
    status: (c.status ?? PublishStatus.PUBLISHED) as PublishStatus,
    levels: (Array.isArray(c.levels) ? c.levels : []).map(toStr).filter(Boolean) as Level[],
    tags: (Array.isArray(c.tags) ? c.tags : []).map(toStr).filter(Boolean),
  };
  customFields.value = (Array.isArray(c.customFields) ? c.customFields : []).map((f: { id: string; key: string; value: string }) => ({
    id: f.id,
    key: f.key,
    value: f.value,
  }));
});

// ---------- 自定义字段 ----------

async function addCustomField() {
  if (!isEdit.value) {
    ElMessage.warning('请先保存竞赛，再为它添加补充字段');
    return;
  }
  if (!newFieldKey.value.trim() || !newFieldValue.value.trim()) {
    ElMessage.warning('请填写字段名与字段值');
    return;
  }
  newFieldSaving.value = true;
  try {
    const created = await api.put<{ id: string; key: string; value: string }>(
      `/admin/competitions/${route.params.id}/fields`,
      { key: newFieldKey.value.trim(), value: newFieldValue.value.trim() },
    );
    const existing = customFields.value.find((f) => f.key === created.key);
    if (existing) existing.value = created.value;
    else customFields.value.push({ id: created.id, key: created.key, value: created.value });
    newFieldKey.value = '';
    newFieldValue.value = '';
    ElMessage.success('字段已保存（已记录版本，可回滚）');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败');
  } finally {
    newFieldSaving.value = false;
  }
}

async function saveCustomField(row: CustomFieldRow) {
  try {
    const updated = await api.put<{ id: string; key: string; value: string }>(
      `/admin/competitions/${route.params.id}/fields`,
      { key: row.key, value: row.value },
    );
    row.value = updated.value;
    ElMessage.success(`「${row.key}」已更新`);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败');
  }
}

async function removeCustomField(row: CustomFieldRow) {
  try {
    await ElMessageBox.confirm(`删除补充字段「${row.key}」？删除记录会进入版本历史，可回滚恢复。`, '删除字段', { type: 'warning' });
  } catch {
    return;
  }
  try {
    await api.delete(`/admin/competitions/${route.params.id}/fields/${encodeURIComponent(row.key)}`);
    customFields.value = customFields.value.filter((f) => f.id !== row.id);
    ElMessage.success('已删除');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败');
  }
}

// ---------- 保存基本信息 ----------
//
// 赛道 / 赛程阶段 / 时间节点已移出本表单，改由「赛道与赛程」标签逐条即时落库
// （组件 AdminCompetitionSchedule），这里只提交赛事级标量与级别 / 标签。
async function save() {
  if (!form.value.name.trim()) {
    ElMessage.warning('请填写竞赛名称');
    return;
  }
  if (!isEdit.value && !form.value.code.trim()) {
    ElMessage.warning('请填写竞赛编码（code，跨届次沿用）');
    return;
  }
  saving.value = true;
  try {
    const payload = {
      name: form.value.name.trim(),
      code: form.value.code.trim() || undefined,
      year: form.value.year ?? undefined,
      aliases: form.value.aliases.filter((a) => a.trim()),
      organizer: form.value.organizer || undefined,
      officialUrl: form.value.officialUrl || undefined,
      format: form.value.format ?? undefined,
      teamSizeMin: form.value.teamSizeMin ?? undefined,
      teamSizeMax: form.value.teamSizeMax ?? undefined,
      audience: form.value.audience ?? undefined,
      intro: form.value.intro || undefined,
      difficulty: form.value.difficulty ?? undefined,
      effort: form.value.effort ?? undefined,
      isBonusEligible: form.value.isBonusEligible ?? undefined,
      bonusCategory: form.value.bonusCategory || undefined,
      bonusSpecialRule: form.value.bonusSpecialRule || undefined,
      sourceUrl: form.value.sourceUrl || undefined,
      status: form.value.status,
      levels: form.value.levels,
      tags: form.value.tags.filter((t) => t.trim()),
    };
    if (isEdit.value) {
      await api.put(`/admin/competitions/${route.params.id}`, payload);
      ElMessage.success('基本信息已保存');
    } else {
      const created = await api.post<{ id: string }>('/admin/competitions', payload);
      ElMessage.success('竞赛已录入，接下来可添加赛道与赛程');
      // 录入后停留在编辑页，方便继续维护赛程结构
      if (created?.id) {
        router.replace({ name: 'admin-competition-edit', params: { id: created.id } });
        activeTab.value = 'schedule';
      } else {
        router.push({ name: 'admin-competitions' });
      }
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="glass p-0 overflow-hidden">
    <!-- 标题 + 操作条 -->
    <div class="edit-head">
      <div class="min-w-0">
        <h2 class="edit-title">{{ isEdit ? '编辑竞赛' : '录入竞赛' }}</h2>
        <p class="edit-sub">
          {{ isEdit ? '基本信息即时保存；赛道、赛程阶段与时间节点在「赛道与赛程」中维护' : '先填写基本信息并保存，随后可添加赛道与赛程' }}
        </p>
      </div>
      <div class="flex items-center gap-8px shrink-0">
        <el-button round @click="router.back()">返回</el-button>
        <el-button type="primary" round :loading="saving" @click="save">
          {{ isEdit ? '保存基本信息' : '创建竞赛' }}
        </el-button>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="edit-tabs">
      <!-- ==================== 基本信息 ==================== -->
      <el-tab-pane label="基本信息" name="basic">
        <div class="pane-body flex flex-col gap-16px">
          <section class="field-group">
            <h3 class="group-title">基础信息</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-14px">
              <div>
                <div class="f-label">竞赛名称 *</div>
                <el-input v-model="form.name" placeholder="全国大学生电子设计竞赛" />
              </div>
              <div>
                <div class="f-label">竞赛编码 code *（跨届次沿用，如 NUEDC / CUMCM）</div>
                <el-input v-model="form.code" placeholder="NUEDC" :disabled="isEdit" />
              </div>
              <div>
                <div class="f-label">届次年份 *（同名赛事按年份建多份档案）</div>
                <el-input-number v-model="form.year" :min="2000" :max="2100" controls-position="right" style="width: 100%" />
              </div>
              <div>
                <div class="f-label">别名（逗号分隔，用于搜索）</div>
                <el-input
                  :model-value="form.aliases.join(',')"
                  placeholder="电赛,TI杯"
                  @update:model-value="(v: string) => (form.aliases = v.split(/[,，]/).map((s) => s.trim()))"
                />
              </div>
              <div>
                <div class="f-label">主办方</div>
                <el-input v-model="form.organizer" />
              </div>
              <div>
                <div class="f-label">官网链接</div>
                <el-input v-model="form.officialUrl" placeholder="https://" />
              </div>
              <div>
                <div class="f-label">信息来源（用户可见处会标注）</div>
                <el-input v-model="form.sourceUrl" placeholder="https://www.jwc.uestc.edu.cn/…" />
              </div>
              <div>
                <div class="f-label">发布状态</div>
                <el-select v-model="form.status" style="width: 100%">
                  <el-option :value="PublishStatus.PUBLISHED" :label="PublishStatusLabel[PublishStatus.PUBLISHED]" />
                  <el-option :value="PublishStatus.DRAFT" :label="PublishStatusLabel[PublishStatus.DRAFT]" />
                  <el-option :value="PublishStatus.ARCHIVED" :label="PublishStatusLabel[PublishStatus.ARCHIVED]" />
                </el-select>
              </div>
            </div>
          </section>

          <section class="field-group">
            <h3 class="group-title">赛制与规模</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-14px">
              <div>
                <div class="f-label">赛制（赛事级默认，赛道可覆盖）</div>
                <el-select v-model="form.format" placeholder="—" clearable style="width: 100%">
                  <el-option value="INDIVIDUAL" label="个人赛" />
                  <el-option value="TEAM" label="团队赛" />
                </el-select>
              </div>
              <div class="grid grid-cols-2 gap-8px">
                <div>
                  <div class="f-label">团队人数下限</div>
                  <el-input-number v-model="form.teamSizeMin" :min="1" :max="99" style="width: 100%" controls-position="right" />
                </div>
                <div>
                  <div class="f-label">上限</div>
                  <el-input-number v-model="form.teamSizeMax" :min="1" :max="99" style="width: 100%" controls-position="right" />
                </div>
              </div>
              <div>
                <div class="f-label">面向年级</div>
                <el-select v-model="form.audience" placeholder="—" clearable style="width: 100%">
                  <el-option :value="Audience.UNDERGRAD" :label="AudienceLabel[Audience.UNDERGRAD]" />
                  <el-option :value="Audience.POSTGRAD" :label="AudienceLabel[Audience.POSTGRAD]" />
                  <el-option :value="Audience.MIXED" :label="AudienceLabel[Audience.MIXED]" />
                </el-select>
              </div>
              <div class="grid grid-cols-2 gap-8px">
                <div>
                  <div class="f-label">难度（1-5★）</div>
                  <el-rate :model-value="form.difficulty ?? 0" :max="5" @update:model-value="(v: number) => (form.difficulty = v || null)" />
                </div>
                <div>
                  <div class="f-label">投入度（1-5●）</div>
                  <el-rate :model-value="form.effort ?? 0" :max="5" @update:model-value="(v: number) => (form.effort = v || null)" />
                </div>
              </div>
            </div>
          </section>

          <section class="field-group">
            <h3 class="group-title">级别与标签</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-14px">
              <div>
                <div class="f-label">级别（多值：校→省→国 链路）</div>
                <el-select v-model="form.levels" multiple placeholder="选择级别" style="width: 100%">
                  <el-option v-for="l in levelOptions" :key="l.value" :value="l.value" :label="l.label" />
                </el-select>
              </div>
              <div>
                <div class="f-label">学科标签（逗号分隔）</div>
                <el-input
                  :model-value="form.tags.join(',')"
                  placeholder="电子,嵌入式"
                  @update:model-value="(v: string) => (form.tags = v.split(/[,，]/).map((s) => s.trim()))"
                />
              </div>
            </div>
          </section>

          <section class="field-group bonus-group">
            <h3 class="group-title">推免加分（独立口径，人工维护）</h3>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-12px">
              <div>
                <div class="f-label">是否计入</div>
                <el-select v-model="form.isBonusEligible" placeholder="暂无认定信息" clearable style="width: 100%">
                  <el-option :value="true" label="计入" />
                  <el-option :value="false" label="不计入" />
                </el-select>
              </div>
              <div>
                <div class="f-label">认定类别</div>
                <el-select v-model="form.bonusCategory" placeholder="未认定" clearable style="width: 100%">
                  <el-option value="学科竞赛" label="学科竞赛" />
                  <el-option value="文体竞赛" label="文体竞赛" />
                </el-select>
              </div>
              <div>
                <div class="f-label">特殊规则</div>
                <el-input v-model="form.bonusSpecialRule" placeholder="如：美赛 Outstanding 按国家级最高奖计" />
              </div>
            </div>
            <div class="text-12px color-ink-faint mt-8px">
              分值标准（国家级 3/2.5/1.5、省级 1/0.3/0.1 等）由 BonusStandard 统一维护，无需逐赛填写
            </div>
          </section>

          <section class="field-group">
            <h3 class="group-title">竞赛简介</h3>
            <el-input v-model="form.intro" type="textarea" :rows="4" placeholder="给同学们看的介绍：比赛内容、形式、建议…" />
          </section>

          <section class="field-group">
            <h3 class="group-title">补充字段</h3>
            <p class="text-12px color-ink-faint m-0 mb-8px">展示在竞赛详情页「补充信息」区块，修改进入版本留痕</p>
            <template v-if="isEdit">
              <div class="flex flex-col gap-8px">
                <div v-for="row in customFields" :key="row.id" class="flex items-center gap-8px">
                  <el-tag size="small" effect="plain" class="shrink-0" style="min-width: 90px; justify-content: center">{{ row.key }}</el-tag>
                  <el-input v-model="row.value" maxlength="500" @change="saveCustomField(row)" />
                  <el-button type="primary" plain size="small" @click="saveCustomField(row)">保存</el-button>
                  <el-button type="danger" plain circle size="small" @click="removeCustomField(row)">
                    <el-icon><i-ep-delete /></el-icon>
                  </el-button>
                </div>
                <div class="flex items-center gap-8px mt-4px flex-wrap">
                  <el-input v-model="newFieldKey" placeholder="字段名（如：QQ 交流群）" maxlength="30" style="width: 200px" />
                  <el-input v-model="newFieldValue" placeholder="字段值（纯文本，最长 500 字）" maxlength="500" class="min-w-200px flex-1" />
                  <el-button type="primary" :loading="newFieldSaving" @click="addCustomField">添加</el-button>
                </div>
                <div class="text-12px color-ink-faint">字段名支持中文 / 字母 / 数字 / 下划线 / 连字符；值为纯文本，前台展示自动转义</div>
              </div>
            </template>
            <div v-else class="text-13px color-ink-faint">竞赛保存后即可添加补充字段</div>
          </section>

          <div class="flex gap-10px">
            <el-button type="primary" round size="large" :loading="saving" @click="save">
              {{ isEdit ? '保存基本信息' : '创建竞赛' }}
            </el-button>
            <el-button round size="large" @click="router.back()">取消</el-button>
          </div>
        </div>
      </el-tab-pane>

      <!-- ==================== 赛道与赛程 ==================== -->
      <el-tab-pane label="赛道与赛程" name="schedule">
        <div class="pane-body">
          <AdminCompetitionSchedule v-if="isEdit" :competition-id="String(route.params.id)" />
          <div v-else class="schedule-gate">
            <p>请先在「基本信息」中创建竞赛，保存后即可在这里维护赛道、赛程阶段与时间节点。</p>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.edit-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 18px 22px 14px;
  border-bottom: 1px solid rgba(15, 76, 140, 0.08);
}
.edit-title {
  font-size: 20px;
  font-weight: 800;
  margin: 0;
  color: var(--ink);
}
.edit-sub {
  font-size: 12.5px;
  color: var(--ink-soft);
  margin: 4px 0 0;
}
.edit-tabs :deep(.el-tabs__header) {
  margin: 0;
  padding: 0 22px;
}
.edit-tabs :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
  background: rgba(15, 76, 140, 0.08);
}
.edit-tabs :deep(.el-tabs__item) {
  font-size: 14px;
  font-weight: 600;
}
.pane-body {
  padding: 18px 22px 22px;
}
.field-group {
  border-radius: 14px;
  border: 1px solid rgba(15, 76, 140, 0.1);
  background: rgba(255, 255, 255, 0.55);
  padding: 14px 16px;
}
.bonus-group {
  background: linear-gradient(135deg, rgba(255, 240, 198, 0.45), rgba(255, 255, 255, 0.55));
  border-color: rgba(245, 185, 1, 0.35);
}
.group-title {
  font-size: 14px;
  font-weight: 700;
  margin: 0 0 12px;
  color: var(--ink);
}
.f-label {
  font-size: 13px;
  color: var(--ink-soft);
  margin-bottom: 6px;
}
.schedule-gate {
  padding: 30px 20px;
  text-align: center;
  color: var(--ink-soft);
  font-size: 13.5px;
  border-radius: 14px;
  border: 1px dashed rgba(15, 76, 140, 0.25);
  background: rgba(15, 76, 140, 0.03);
}
</style>
