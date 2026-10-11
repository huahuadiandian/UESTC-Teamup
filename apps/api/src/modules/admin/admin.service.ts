import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Audience,
  CompetitionFormat,
  CorrectionStatus,
  EventNodeType,
  Level,
  Prisma,
  PublishStatus,
  RevisionOrigin,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { CompetitionsService } from '../radar/competitions.service';
import { decorateListItem } from '../radar/competitions.service';

export interface UpsertEventInput {
  id?: string;
  stageId: string;
  nodeType: EventNodeType;
  label?: string;
  startAt?: string | null;
  endAt?: string | null;
  location?: string;
}

export interface UpsertCompetitionInput {
  name: string;
  code?: string;
  /** 届次年份：同一赛事可存在多个年度档案 */
  year?: number;
  aliases?: string[];
  organizer?: string;
  officialUrl?: string;
  format?: CompetitionFormat;
  teamSizeMin?: number;
  teamSizeMax?: number;
  audience?: Audience;
  intro?: string;
  difficulty?: number;
  effort?: number;
  isBonusEligible?: boolean;
  bonusCategory?: string;
  bonusSpecialRule?: string;
  sourceUrl?: string;
  status?: PublishStatus;
  levels?: Level[];
  tags?: string[];
  /** 时间节点：按 stageId 归属，支持增删改（人工维护赛程的核心入口） */
  events?: UpsertEventInput[];
}

/** 竞赛主体上需要记版本的字段 */
const TRACKED_FIELDS = [
  'name',
  'year',
  'organizer',
  'officialUrl',
  'format',
  'audience',
  'intro',
  'isBonusEligible',
  'bonusCategory',
  'bonusSpecialRule',
] as const;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationService,
    private readonly competitions: CompetitionsService,
  ) {}

  // ---------- 竞赛录入 / 编辑 ----------

  async createCompetition(input: UpsertCompetitionInput) {
    const { levels, tags, events, ...fields } = input;
    return this.prisma.$transaction(async (tx) => {
      let comp;
      try {
        comp = await tx.competition.create({
          data: {
            ...fields,
            code: fields.code ?? `C-${Date.now()}`,
            // 届次年份必填：后台未传时默认当前年份
            year: fields.year ?? new Date().getFullYear(),
            aliases: fields.aliases ?? [],
            status: fields.status ?? PublishStatus.PUBLISHED,
            levels: { create: (levels ?? []).map((level) => ({ level })) },
            tags: { create: (tags ?? []).map((tag) => ({ tag })) },
          },
        });
      } catch (e) {
        // (code, year) 唯一约束：同编号同届次已存在（Issue 10）
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new BadRequestException('该竞赛编号在此年份已存在，请换用其他编号或直接编辑已有届次');
        }
        throw e;
      }

      for (const e of events ?? []) {
        await tx.competitionEvent.create({
          data: {
            competitionId: comp.id,
            stageId: e.stageId,
            nodeType: e.nodeType,
            label: e.label ?? null,
            location: e.location ?? null,
            startAt: e.startAt ? new Date(e.startAt) : null,
            endAt: e.endAt ? new Date(e.endAt) : null,
          },
        });
      }

      return tx.competition.findUnique({
        where: { id: comp.id },
        include: { levels: true, tags: true, events: true },
      });
    });
  }

  /** 编辑：字段变更记 MANUAL revision；时间节点人工编辑自动 isLocked */
  async updateCompetition(id: string, input: UpsertCompetitionInput, actorId: string) {
    const existing = await this.prisma.competition.findUnique({
      where: { id },
      include: { events: true, levels: true, tags: true },
    });
    if (!existing) throw new NotFoundException('竞赛不存在');
    const { levels, tags, events, ...fields } = input;

    try {
      await this.prisma.$transaction(async (tx) => {
        // 主体字段 diff → MANUAL revision
        const revisions: Prisma.CompetitionRevisionCreateManyInput[] = [];
        for (const f of TRACKED_FIELDS) {
          const oldV = (existing as unknown as Record<string, unknown>)[f];
          const newV = (fields as Record<string, unknown>)[f];
          if (newV !== undefined && String(oldV ?? '') !== String(newV ?? '')) {
            revisions.push({
              competitionId: id,
              field: f,
              oldValue: oldV == null ? null : String(oldV),
              newValue: newV == null ? null : String(newV),
              origin: RevisionOrigin.MANUAL,
            });
          }
        }
        if (revisions.length) await tx.competitionRevision.createMany({ data: revisions });

        await tx.competition.update({ where: { id }, data: { ...fields } });

        if (levels) {
          await tx.competitionLevel.deleteMany({ where: { competitionId: id } });
          await tx.competitionLevel.createMany({ data: levels.map((level) => ({ competitionId: id, level })) });
        }
        if (tags) {
          await tx.competitionTag.deleteMany({ where: { competitionId: id } });
          await tx.competitionTag.createMany({ data: tags.map((tag) => ({ competitionId: id, tag })) });
        }

        if (events) {
          const keepIds = new Set(events.filter((e) => e.id && !e.id.startsWith('new-')).map((e) => e.id!));
          // 删除被移除的节点（非锁定）
          for (const ev of existing.events) {
            if (!keepIds.has(ev.id) && !ev.isLocked) await tx.competitionEvent.delete({ where: { id: ev.id } });
          }
          for (const e of events) {
            const data = {
              stageId: e.stageId,
              nodeType: e.nodeType,
              label: e.label ?? null,
              location: e.location ?? null,
              startAt: e.startAt ? new Date(e.startAt) : null,
              endAt: e.endAt ? new Date(e.endAt) : null,
            };
            if (e.id && !e.id.startsWith('new-')) {
              const old = existing.events.find((x) => x.id === e.id);
              const changed =
                old &&
                (String(old.startAt ?? '') !== String(data.startAt ?? '') ||
                  String(old.endAt ?? '') !== String(data.endAt ?? '') ||
                  old.nodeType !== e.nodeType);
              if (changed) {
                // 人工修正自动加锁 + 记版本（防未来采集改回去）
                // eventId 随版本落库（Issue 15）：回滚必须精确定位到事件本身，
                // 只靠 stageId 在多事件阶段会改错节点
                await tx.competitionEvent.update({ where: { id: e.id }, data: { ...data, isLocked: true } });
                await tx.competitionRevision.createMany({
                  data: [
                    {
                      competitionId: id,
                      stageId: e.stageId,
                      eventId: e.id,
                      field: 'startAt',
                      oldValue: old?.startAt?.toISOString() ?? null,
                      newValue: data.startAt?.toISOString() ?? null,
                      origin: RevisionOrigin.MANUAL,
                    },
                    {
                      competitionId: id,
                      stageId: e.stageId,
                      eventId: e.id,
                      field: 'endAt',
                      oldValue: old?.endAt?.toISOString() ?? null,
                      newValue: data.endAt?.toISOString() ?? null,
                      origin: RevisionOrigin.MANUAL,
                    },
                  ],
                });
              } else if (old) {
                await tx.competitionEvent.update({ where: { id: e.id }, data });
              }
            } else {
              await tx.competitionEvent.create({ data: { competitionId: id, ...data } });
            }
          }
        }
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('该竞赛编号在此年份已存在，不能重复使用');
      }
      throw e;
    }

    void actorId;
    return this.prisma.competition.findUnique({
      where: { id },
      include: {
        levels: true,
        tags: true,
        events: { include: { stage: { select: { id: true, name: true } } } },
        customFields: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  // ---------- 竞赛自定义字段 ----------

  /**
   * 键名约束：1-30 字，中文 / 字母 / 数字 / 下划线 / 连字符 / 空格；
   * 值为纯文本（前端展示转义），入库前 trim，最长 500 字。
   */
  static normalizeCustomKey(key: string): string {
    const k = key.trim();
    if (!k) throw new BadRequestException('字段名不能为空');
    if (k.length > 30) throw new BadRequestException('字段名最长 30 字');
    if (!/^[\u4e00-\u9fa5A-Za-z0-9_\-\s]+$/.test(k)) {
      throw new BadRequestException('字段名只能包含中文、字母、数字、下划线、连字符');
    }
    return k;
  }

  /** 新增 / 更新单个自定义键值；每次变更写入 MANUAL revision（field = "custom:<key>"），可回滚 */
  async upsertCustomField(competitionId: string, key: string, value: string, actorId: string) {
    const k = AdminService.normalizeCustomKey(key);
    const v = value.trim();
    if (!v) throw new BadRequestException('字段值不能为空');
    if (v.length > 500) throw new BadRequestException('字段值最长 500 字');

    const competition = await this.prisma.competition.findUnique({ where: { id: competitionId }, select: { id: true } });
    if (!competition) throw new NotFoundException('竞赛不存在');

    const field = await this.prisma.competitionCustomField.upsert({
      where: { competitionId_key: { competitionId, key: k } },
      create: { competitionId, key: k, value: v, updatedById: actorId },
      update: { value: v, updatedById: actorId },
    });

    // 版本留痕（与主体字段同一套 revision 体系，origin=MANUAL，可回滚）
    const oldValue = await this.prisma.competitionRevision.findFirst({
      where: { competitionId, field: `custom:${k}` },
      orderBy: { createdAt: 'desc' },
      select: { newValue: true },
    });
    await this.prisma.competitionRevision.create({
      data: {
        competitionId,
        field: `custom:${k}`,
        oldValue: oldValue?.newValue ?? null,
        newValue: v,
        origin: RevisionOrigin.MANUAL,
      },
    });
    return field;
  }

  /** 删除自定义键值；同样留痕（newValue=null），回滚可恢复 */
  async deleteCustomField(competitionId: string, key: string) {
    const k = AdminService.normalizeCustomKey(key);
    const existing = await this.prisma.competitionCustomField.findUnique({
      where: { competitionId_key: { competitionId, key: k } },
    });
    if (!existing) throw new NotFoundException('自定义字段不存在');

    await this.prisma.$transaction([
      this.prisma.competitionCustomField.delete({ where: { id: existing.id } }),
      this.prisma.competitionRevision.create({
        data: {
          competitionId,
          field: `custom:${k}`,
          oldValue: existing.value,
          newValue: null,
          origin: RevisionOrigin.MANUAL,
        },
      }),
    ]);
    return { deleted: true };
  }

  async archiveCompetition(id: string) {
    const existing = await this.prisma.competition.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('竞赛不存在');
    await this.prisma.competition.update({ where: { id }, data: { status: PublishStatus.ARCHIVED } });
    return { archived: true };
  }

  /**
   * 管理员删除组队帖（硬删除）。
   * TeamMember 由外键级联清理；Comment / Favorite 是多态关联（无外键），需同事务手工清理，避免孤儿数据。
   */
  async deleteTeam(id: string) {
    const team = await this.prisma.team.findUnique({ where: { id }, select: { id: true, competition: { select: { name: true } } } });
    if (!team) throw new NotFoundException('组队帖不存在');
    await this.prisma.$transaction([
      this.prisma.comment.deleteMany({ where: { targetType: 'TEAM', targetId: id } }),
      this.prisma.favorite.deleteMany({ where: { targetType: 'TEAM', targetId: id } }),
      this.prisma.team.delete({ where: { id } }),
    ]);
    return { deleted: true, name: team.competition.name };
  }

  async adminList(query: { page: number; pageSize: number; q?: string; status?: string }) {
    const where: Prisma.CompetitionWhereInput = {};
    if (query.q) where.OR = [{ name: { contains: query.q } }, { aliases: { has: query.q } }];
    if (query.status) where.status = query.status as never;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.competition.findMany({
        where,
        include: {
          levels: true,
          tags: true,
          events: { select: { id: true, nodeType: true, startAt: true, endAt: true } },
          _count: { select: { teams: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.competition.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        ...decorateListItem(r as never),
        status: r.status,
        sourceUrl: r.sourceUrl,
        teamCount: r._count.teams,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** 管理台详情：levels / tags 摊平成字符串数组；events / stages 供时间节点维护（Issue 8） */
  async adminDetail(id: string) {
    const row = await this.prisma.competition.findUnique({
      where: { id },
      include: {
        levels: true,
        tags: true,
        tracks: { orderBy: [{ sortOrder: 'asc' }], select: { id: true, code: true, name: true } },
        stages: {
          orderBy: [{ sequence: 'asc' }],
          include: { events: { orderBy: [{ startAt: 'asc' }] } },
        },
        // 顶层事件列表：编辑页直接以此初始化（含 stageId，提交时原样回传）
        events: { orderBy: [{ startAt: 'asc' }, { endAt: 'asc' }] },
        customFields: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!row) return null;
    return {
      ...row,
      levels: row.levels.map((l) => l.level),
      tags: row.tags.map((t) => t.tag),
    };
  }

  // ---------- 纠错处理 ----------

  async correctionsList(query: { status?: CorrectionStatus; page: number; pageSize: number }) {
    const where: Prisma.CorrectionReportWhereInput = query.status ? { status: query.status } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.correctionReport.findMany({
        where,
        include: {
          competition: { select: { id: true, name: true } },
          reporter: { select: { id: true, nickname: true, college: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.correctionReport.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /** 采纳：写入目标 + isLocked + MANUAL revision；驳回：仅状态 */
  async reviewCorrection(adminId: string, reportId: string, accept: boolean, note?: string) {
    const report = await this.prisma.correctionReport.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('纠错不存在');
    if (report.status !== CorrectionStatus.PENDING) throw new BadRequestException('该纠错已处理');

    if (!accept) {
      await this.prisma.correctionReport.update({ where: { id: reportId }, data: { status: CorrectionStatus.REJECTED } });
      return { accepted: false };
    }
    if (report.proposedValue == null) throw new BadRequestException('该纠错未提供建议值，无法采纳');

    const [head, eventId, evField] = report.field.split(':');

    // 纵深防御：URL 类字段采纳前再次校验 scheme
    if (URL_FIELDS.has(head)) assertHttpUrl(report.proposedValue);

    await this.prisma.$transaction(async (tx) => {
      if (head === 'event' && eventId) {
        const ev = await tx.competitionEvent.findUnique({ where: { id: eventId } });
        if (!ev) throw new NotFoundException('时间节点不存在');
        const newDate = new Date(report.proposedValue!);
        if (Number.isNaN(newDate.getTime())) throw new BadRequestException('建议值不是合法日期');
        await tx.competitionEvent.update({
          where: { id: eventId },
          data: evField === 'endAt' ? { endAt: newDate, isLocked: true } : { startAt: newDate, isLocked: true },
        });
        await tx.competitionRevision.create({
          data: {
            competitionId: report.competitionId,
            stageId: ev.stageId,
            eventId: ev.id,
            field: evField!,
            oldValue: report.currentValue,
            newValue: report.proposedValue,
            origin: RevisionOrigin.MANUAL,
          },
        });
      } else if (head === 'isBonusEligible') {
        const v = report.proposedValue!.toLowerCase() === 'true';
        await tx.competition.update({ where: { id: report.competitionId }, data: { isBonusEligible: v } });
        await tx.competitionRevision.create({
          data: {
            competitionId: report.competitionId,
            field: head,
            oldValue: report.currentValue,
            newValue: report.proposedValue,
            origin: RevisionOrigin.MANUAL,
          },
        });
      } else if (CORRECTABLE_SIMPLE.has(head)) {
        await tx.competition.update({
          where: { id: report.competitionId },
          data: { [head]: report.proposedValue } as never,
        });
        await tx.competitionRevision.create({
          data: {
            competitionId: report.competitionId,
            field: head,
            oldValue: report.currentValue,
            newValue: report.proposedValue,
            origin: RevisionOrigin.MANUAL,
          },
        });
      } else {
        throw new BadRequestException('不支持的纠错字段');
      }

      await tx.correctionReport.update({
        where: { id: reportId },
        data: { status: CorrectionStatus.ACCEPTED, note: note ?? report.note },
      });
    });

    void adminId;
    await this.notify.notify(report.reporterId, 'CORRECTION_NEW', {
      reportId,
      accepted: true,
      message: '你提交的纠错已被采纳，感谢贡献！',
    });
    return { accepted: true };
  }

  // ---------- 版本历史与回滚 ----------

  async revisions(query: { competitionId?: string; page: number; pageSize: number }) {
    const where: Prisma.CompetitionRevisionWhereInput = query.competitionId ? { competitionId: query.competitionId } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.competitionRevision.findMany({
        where,
        include: {
          competition: { select: { id: true, name: true } },
          stage: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.competitionRevision.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /**
   * 一键回滚：把字段写回旧值；回滚动作本身记为 ROLLBACK revision（Issue 15）。
   * 时间节点字段优先按 eventId 精确定位 —— 一个阶段可以有多个事件，只按 stageId
   * 取「最近更新的一条」会改错节点；eventId 缺失的存量记录回退 stageId 口径。
   * 回滚写入与 ROLLBACK 版本记录在同一事务中完成。
   */
  async rollback(revisionId: string) {
    const rev = await this.prisma.competitionRevision.findUnique({ where: { id: revisionId } });
    if (!rev) throw new NotFoundException('版本记录不存在');
    if (rev.oldValue == null) throw new BadRequestException('该记录没有旧值可回滚');

    if (rev.field.startsWith('custom:')) {
      // 自定义字段回滚：写回旧值；旧值为空表示该键当时不存在 → 删除
      if (!rev.competitionId) throw new BadRequestException('该记录没有关联对象');
      const key = rev.field.slice('custom:'.length);
      await this.prisma.$transaction(async (tx) => {
        if (rev.oldValue!.trim()) {
          await tx.competitionCustomField.upsert({
            where: { competitionId_key: { competitionId: rev.competitionId!, key } },
            create: { competitionId: rev.competitionId!, key, value: rev.oldValue! },
            update: { value: rev.oldValue! },
          });
        } else {
          await tx.competitionCustomField.deleteMany({
            where: { competitionId: rev.competitionId!, key },
          });
        }
        await tx.competitionRevision.create({ data: this.rollbackRevisionOf(rev) });
      });
    } else if (rev.eventId || rev.stageId) {
      // 时间节点字段：优先按 eventId 精确定位（Issue 15），存量无 eventId 的记录
      // 回退为「该阶段最近更新的一条」（旧口径，仅用于历史数据）
      await this.prisma.$transaction(async (tx) => {
        const ev = rev.eventId
          ? await tx.competitionEvent.findFirst({
              where: { id: rev.eventId, competitionId: rev.competitionId ?? undefined },
            })
          : await tx.competitionEvent.findFirst({
              where: { competitionId: rev.competitionId ?? undefined, stageId: rev.stageId ?? undefined },
              orderBy: { updatedAt: 'desc' },
            });
        if (!ev) throw new NotFoundException('时间节点已不存在');
        const d = new Date(rev.oldValue!);
        if (Number.isNaN(d.getTime())) throw new BadRequestException('旧值不是合法日期');
        await tx.competitionEvent.update({
          where: { id: ev.id },
          data: rev.field === 'endAt' ? { endAt: d, isLocked: true } : { startAt: d, isLocked: true },
        });
        await tx.competitionRevision.create({
          data: { ...this.rollbackRevisionOf(rev), eventId: ev.id },
        });
      });
    } else if (rev.competitionId) {
      let value: string | boolean | number = rev.oldValue;
      if (rev.field === 'isBonusEligible') value = rev.oldValue.toLowerCase() === 'true';
      // Int 字段：Prisma 不接受字符串，需转回数字
      else if (rev.field === 'year') {
        const y = Number(rev.oldValue);
        if (!Number.isInteger(y)) throw new BadRequestException('旧值不是合法年份');
        value = y;
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.competition.update({
          where: { id: rev.competitionId! },
          data: { [rev.field]: value } as never,
        });
        await tx.competitionRevision.create({ data: this.rollbackRevisionOf(rev) });
      });
    } else {
      throw new BadRequestException('该记录没有关联对象');
    }
    return { rolledBack: true };
  }

  /** ROLLBACK 版本记录：与被回滚记录同字段/同定位，旧值新值互换 */
  private rollbackRevisionOf(rev: {
    competitionId: string | null;
    stageId: string | null;
    field: string;
    oldValue: string | null;
    newValue: string | null;
  }) {
    return {
      competitionId: rev.competitionId,
      stageId: rev.stageId,
      field: rev.field,
      oldValue: rev.newValue,
      newValue: rev.oldValue,
      origin: RevisionOrigin.ROLLBACK,
    };
  }
}

const CORRECTABLE_SIMPLE = new Set(['name', 'organizer', 'officialUrl', 'intro', 'bonusCategory', 'bonusSpecialRule']);

/** URL 类字段：采纳写入前必须校验 scheme，只允许 http/https */
const URL_FIELDS = new Set(['officialUrl', 'sourceUrl']);

function assertHttpUrl(value: string): void {
  if (!/^https?:\/\//i.test(value.trim())) {
    throw new BadRequestException('链接必须以 http:// 或 https:// 开头');
  }
}
