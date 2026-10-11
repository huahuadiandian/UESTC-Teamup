import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { NotificationService } from '../notification/notification.service';

/** 允许纠错的字段（竞赛详情页每个字段旁的「报告错误」入口） */
const CORRECTABLE_FIELDS: Record<string, 'text' | 'date'> = {
  name: 'text',
  organizer: 'text',
  officialUrl: 'text',
  intro: 'text',
  isBonusEligible: 'text',
  bonusCategory: 'text',
  bonusSpecialRule: 'text',
};

/** URL 类字段：提交时必须校验 scheme，阻止 javascript: 等存储型 XSS */
const URL_FIELDS = new Set(['officialUrl', 'sourceUrl']);

@Injectable()
export class CorrectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationService,
  ) {}

  async submit(reporterId: string, competitionId: string, dto: { field: string; proposedValue?: string; note?: string }) {
    const competition = await this.prisma.competition.findUnique({ where: { id: competitionId } });
    if (!competition) throw new NotFoundException('竞赛不存在');

    // field 形如 "name"（竞赛字段）或 "event:<id>:endAt"（时间节点字段）
    let currentValue: string | null = null;
    const [head, evId, evField] = dto.field.split(':');

    if (head === 'event') {
      if (!evId || !['startAt', 'endAt'].includes(evField ?? '')) throw new BadRequestException('不支持的纠错字段');
      const ev = await this.prisma.competitionEvent.findUnique({ where: { id: evId } });
      if (!ev || ev.competitionId !== competitionId) throw new BadRequestException('时间节点不存在');
      currentValue = (evField === 'endAt' ? ev.endAt : ev.startAt)?.toISOString() ?? null;
    } else {
      if (!CORRECTABLE_FIELDS[head]) throw new BadRequestException('不支持的纠错字段');
      // URL 类字段：只接受 http/https，防止 javascript: 之类被采纳后写入库（存储型 XSS）
      if (URL_FIELDS.has(head) && dto.proposedValue != null && !/^https?:\/\//i.test(dto.proposedValue.trim())) {
        throw new BadRequestException('链接必须以 http:// 或 https:// 开头');
      }
      currentValue = (competition as unknown as Record<string, string | null>)[head] ?? null;
      if (head === 'isBonusEligible') currentValue = String(competition.isBonusEligible ?? '');
    }

    if (dto.proposedValue != null && dto.proposedValue === currentValue) {
      throw new BadRequestException('你填写的值与当前值相同');
    }

    const report = await this.prisma.correctionReport.create({
      data: {
        competitionId,
        field: dto.field,
        currentValue,
        proposedValue: dto.proposedValue ?? null,
        note: dto.note ?? null,
        reporterId,
      },
    });

    // 通知管理员处理
    const admins = await this.prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
    await this.notify.notifyMany(
      admins.map((a) => a.id),
      'CORRECTION_NEW',
      { reportId: report.id, competitionId, field: dto.field, proposedValue: dto.proposedValue },
    );

    return report;
  }
}
