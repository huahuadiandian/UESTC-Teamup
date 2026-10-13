/**
 * 时间节点日期口径订正（一次性数据迁移）
 *
 * 背景：早期 seed 把「日期」写成了 UTC 边界的瞬时 ——
 *   startAt = `${date}T00:00:00Z`  （按 +08:00 渲染 = 同日 08:00）
 *   endAt   = `${date}T16:00:00Z`  （按 +08:00 渲染 = 次日 00:00）
 * 前端按本地时区（UTC+8）渲染时，endAt 就整整晚一天（原始 2026-11-30 显示成 2026-12-01），
 * 日历、竞赛列表「报名截止」、详情页赛程、ICS 导出全部受影响（时间也变成 08:00 / 00:00 这种噪声）。
 *
 * 本脚本把这两个字段重写成「本地日边界」：
 *   startAt = 当日 00:00:00 +08:00
 *   endAt   = 当日 23:59:59 +08:00
 * 之后所有按本地时区渲染的位置自然正确，前端无需任何特判。
 *
 * 用法：
 *   pnpm -F @teamup/api exec tsx scripts/fix-event-datetimes.ts           # 预演，只统计不写入
 *   pnpm -F @teamup/api exec tsx scripts/fix-event-datetimes.ts --apply   # 实际写入
 *
 * 幂等：转换后 startAt 的 UTC 时刻变为 16:00:00、endAt 变为 15:59:59，
 * 不再匹配旧约定，重复执行不会二次位移。不匹配旧约定的行一律跳过并列出，绝不静默改写。
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const APPLY = process.argv.includes('--apply');

/** 旧约定：startAt 的 UTC 时刻恰为 00:00:00 */
function isLegacyStart(d: Date): boolean {
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
}

/** 旧约定：endAt 的 UTC 时刻恰为 16:00:00（= 次日 00:00 +08:00） */
function isLegacyEnd(d: Date): boolean {
  return d.getUTCHours() === 16 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
}

/** 取该瞬时所在「UTC 日历日」的指定时刻，换算到 +08:00 的同一挂钟时间对应的瞬时 */
function localInstantOnUtcDate(d: Date, h: number, mi: number, s: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, mi, s) - TZ_OFFSET_MS);
}

async function main() {
  const events = await prisma.competitionEvent.findMany({
    select: { id: true, label: true, nodeType: true, startAt: true, endAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const updates: { id: string; startAt: Date | null; endAt: Date | null }[] = [];
  const skipped: { id: string; label: string | null; nodeType: string; startAt: string | null; endAt: string | null }[] = [];

  for (const e of events) {
    const startLegacy = e.startAt ? isLegacyStart(e.startAt) : true; // 空值无需处理
    const endLegacy = e.endAt ? isLegacyEnd(e.endAt) : true;
    if (!startLegacy || !endLegacy) {
      skipped.push({
        id: e.id,
        label: e.label,
        nodeType: e.nodeType,
        startAt: e.startAt?.toISOString() ?? null,
        endAt: e.endAt?.toISOString() ?? null,
      });
      continue;
    }
    const startAt = e.startAt ? localInstantOnUtcDate(e.startAt, 0, 0, 0) : null;
    const endAt = e.endAt ? localInstantOnUtcDate(e.endAt, 23, 59, 59) : null;
    const unchanged =
      String(startAt ?? '') === String(e.startAt ?? '') && String(endAt ?? '') === String(e.endAt ?? '');
    if (!unchanged) updates.push({ id: e.id, startAt, endAt });
  }

  console.log(`事件总数 ${events.length}｜需订正 ${updates.length}｜跳过（不符合旧约定） ${skipped.length}`);
  if (skipped.length) {
    console.log('跳过明细（前 20 条）：');
    for (const s of skipped.slice(0, 20)) {
      console.log(`  ${s.id} ${s.nodeType} ${s.label ?? ''} start=${s.startAt} end=${s.endAt}`);
    }
  }
  console.log('订正示例（前 5 条）：');
  for (const u of updates.slice(0, 5)) {
    const before = events.find((e) => e.id === u.id)!;
    console.log(
      `  ${before.nodeType} ${before.label ?? ''}\n    start ${before.startAt?.toISOString() ?? '—'} -> ${u.startAt?.toISOString() ?? '—'}` +
        `\n    end   ${before.endAt?.toISOString() ?? '—'} -> ${u.endAt?.toISOString() ?? '—'}`,
    );
  }

  if (!APPLY) {
    console.log('\n[预演模式] 未写入任何数据。确认无误后加 --apply 执行。');
    return;
  }

  // 分批写入，避免单事务过大
  let done = 0;
  for (let i = 0; i < updates.length; i += 100) {
    const batch = updates.slice(i, i + 100);
    await prisma.$transaction(
      batch.map((u) =>
        prisma.competitionEvent.update({ where: { id: u.id }, data: { startAt: u.startAt, endAt: u.endAt } }),
      ),
    );
    done += batch.length;
  }
  console.log(`\n[已写入] 订正 ${done} 条时间节点。`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
