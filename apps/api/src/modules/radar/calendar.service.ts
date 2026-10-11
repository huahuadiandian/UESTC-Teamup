import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { Level, LevelLabel } from '@teamup/shared';

const STAGE_KIND_LABEL: Record<string, string> = {
  CAMPUS: '校级',
  QUALIFIER: '预选',
  REGIONAL: '区域',
  PROVINCIAL: '省级',
  NATIONAL: '国家级',
  INTERNATIONAL: '国际',
  FINAL: '总决赛',
  OTHER: '',
};

@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  /** 区间内的时间节点（FullCalendar 数据源）；按级别配色由前端处理 */
  async range(query: { start?: string; end?: string; levels?: string[]; year?: number }) {
    const start = query.start ? new Date(query.start) : new Date(Date.now() - 30 * 86400_000);
    const end = query.end ? new Date(query.end) : new Date(Date.now() + 120 * 86400_000);

    const rows = await this.prisma.competitionEvent.findMany({
      where: {
        OR: [
          { startAt: { lte: end, gte: start } },
          { endAt: { lte: end, gte: start } },
          { startAt: { lte: start }, endAt: { gte: end } },
        ],
        competition: {
          status: 'PUBLISHED',
          // 届次筛选：传入 year 时只看该届竞赛的节点
          ...(query.year ? { year: query.year } : {}),
          ...(query.levels?.length ? { levels: { some: { level: { in: query.levels as never[] } } } } : {}),
        },
      },
      include: {
        stage: { select: { name: true, stageKind: true, bonusTier: true } },
        competition: { select: { id: true, name: true, levels: true, year: true } },
      },
      orderBy: { startAt: 'asc' },
      take: 500,
    });

    return rows.map((e) => ({
      id: e.id,
      competitionId: e.competition.id,
      competitionName: e.competition.name,
      competitionYear: e.competition.year,
      stage: e.stage.name,
      stageKind: e.stage.stageKind,
      bonusTier: e.stage.bonusTier,
      nodeType: e.nodeType,
      competitionLevels: e.competition.levels.map((l) => l.level),
      startAt: e.startAt,
      endAt: e.endAt,
      isLocked: e.isLocked,
      // 报名期与赛程期两类样式区分（PAGES.md §2.4）
      kind: e.nodeType === 'SIGNUP_START' || e.nodeType === 'SIGNUP_END' ? 'signup' : 'race',
    }));
  }

  /** 导出 .ics（手机日历订阅） */
  async ics(): Promise<string> {
    const rows = await this.prisma.competitionEvent.findMany({
      where: {
        endAt: { gte: new Date() },
        competition: { status: 'PUBLISHED' },
      },
      include: {
        stage: { select: { name: true, stageKind: true } },
        competition: { select: { name: true } },
      },
      orderBy: { endAt: 'asc' },
      take: 300,
    });

    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//UESTC TeamUp//Competition Radar//CN',
      'CALSCALE:GREGORIAN',
      'X-WR-CALNAME:成电竞赛雷达',
      'X-WR-TIMEZONE:Asia/Shanghai',
    ];

    const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const esc = (s: string) => s.replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');

    for (const e of rows) {
      if (!e.endAt) continue;
      const start = e.startAt ?? e.endAt;
      const kindLabel = STAGE_KIND_LABEL[e.stage.stageKind] ?? '';
      lines.push(
        'BEGIN:VEVENT',
        `UID:event-${e.id}@uestc-teamup`,
        `DTSTAMP:${fmt(new Date())}`,
        `DTSTART:${fmt(start)}`,
        `DTEND:${fmt(e.endAt)}`,
        `SUMMARY:${esc(`${e.competition.name} · ${e.stage.name}${kindLabel ? `（${kindLabel}）` : ''}`)}`,
        `DESCRIPTION:${esc('来自 UESTC TeamUp 竞赛雷达')}`,
        'END:VEVENT',
      );
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }
}

// 保留引用，避免未使用告警
void Level;
void LevelLabel;
