import dayjs from 'dayjs';

export { dayjs };

export interface CompetitionListItem {
  id: string;
  /** 稳定业务编码（跨届次沿用） */
  code: string;
  name: string;
  /** 届次年份 */
  year: number | null;
  organizer: string | null;
  format: string | null;
  audience: string | null;
  difficulty: number | null;
  effort: number | null;
  /** 是否含赛道 */
  hasTracks: boolean;
  /** 赛程链展示缓存，如「校赛 → 省赛 → 全国总决赛」 */
  stageChain: string | null;
  isBonusEligible: boolean | null;
  bonusCategory: string | null;
  levels: string[];
  tags: string[];
  recruitingTeams: number;
  nextDeadline: string | null;
  status: 'OPEN' | 'UPCOMING' | 'ENDED' | 'UNKNOWN';
  updatedAt: string;
}

/** 时间节点（挂在赛程阶段上） */
export interface StageEvent {
  id: string;
  nodeType: string;
  label: string | null;
  startAt: string | null;
  endAt: string | null;
  location: string | null;
  isLocked: boolean;
}

/** 赛程阶段 */
export interface CompetitionStageView {
  id: string;
  code: string;
  name: string;
  stageKind: string;
  scope: string | null;
  sequence: number;
  bonusTier: string | null;
  note: string | null;
  events: StageEvent[];
}

/** 赛道 / 赛项 */
export interface CompetitionTrackView {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  description: string | null;
  sortOrder: number;
  parentId: string | null;
  format: string | null;
  teamSizeMin: number | null;
  teamSizeMax: number | null;
  stages: CompetitionStageView[];
}

/** 日历节点 */
export interface TimelineNode {
  id: string;
  competitionId: string;
  competitionName: string;
  competitionYear: number | null;
  stage: string;
  stageKind: string;
  bonusTier: string | null;
  nodeType: string;
  competitionLevels: string[];
  startAt: string | null;
  endAt: string | null;
  isLocked: boolean;
  kind: 'signup' | 'race';
}

export interface BonusStandardView {
  id: string;
  documentRef: string;
  category: string;
  level: string;
  topPoints: string;
  secondPoints: string;
  thirdPoints: string;
}

export interface CompetitionDetail extends CompetitionListItem {
  shortName: string | null;
  aliases: string[];
  officialUrl: string | null;
  sourceUrl: string | null;
  intro: string | null;
  teamSizeMin: number | null;
  teamSizeMax: number | null;
  bonusSpecialRule: string | null;
  bonusStandard: BonusStandardView | null;
  /** 同认定文件 + 类别下的两档加分标准（国家级 + 省级），供加分表渲染 */
  bonusStandards?: BonusStandardView[];
  /** 赛道（含各自赛程） */
  tracks: CompetitionTrackView[];
  /** 全赛事共享的赛程阶段 */
  sharedStages: CompetitionStageView[];
  awards: { id: string; year: number | null; awardName: string | null; awardTier: string | null; teamName: string | null; members: string[] }[];
  materials: { id: string; kind: string; title: string; url: string }[];
  /** 竞赛自定义键值字段 */
  customFields?: { id: string; key: string; value: string }[];
  /** 同名赛事的其他届次 */
  editions?: { id: string; year: number }[];
  recruitingTeamsList?: TeamSummary[];
}

/** 招募帖（广告牌模式）：联系方式按「组队意愿」解锁，不再默认公开 */
export interface TeamLeaderView {
  id: string;
  nickname: string | null;
  college: string | null;
  grade: number | null;
  major: string | null;
  /** 学号：仅登录用户的响应中下发（服务端按登录态裁剪），游客不可见 */
  studentNo?: string;
}

/** 竞赛详情页内嵌的招募帖摘要 */
export interface TeamSummary {
  id: string;
  goal: string;
  status: string;
  deadline: string | null;
  neededRoles: string[];
  /** 计划招募人数（含队长本人） */
  targetSize?: number | null;
  /** 已有人数 = 1（队长）+ 手填成员行数 */
  memberCount?: number;
  /** 已登记组队意愿的人数 */
  intentCount?: number;
  leader: TeamLeaderView;
}

export interface TeamListItem {
  id: string;
  goal: string;
  status: string;
  deadline: string | null;
  neededRoles: string[];
  expired: boolean;
  /** 计划招募人数（含队长本人） */
  targetSize: number | null;
  /** 已有人数（含队长） */
  memberCount: number;
  /** 已登记组队意愿的人数 */
  intentCount: number;
  competition: { id: string; name: string };
  leader: TeamLeaderView;
  commentCount: number;
  createdAt: string;
}

export interface TeamDetail extends TeamListItem {
  requirement: string | null;
  /** 联系方式：仅在 viewer.isLeader / isAdmin / viewer.hasIntent 时下发（Issue 1） */
  qq: string | null;
  wechat: string | null;
  /** 当前查看者是否已解锁联系方式 */
  contactUnlocked: boolean;
  competition: { id: string; name: string; levels: string[]; officialUrl: string | null };
  /** 已有成员情况（队长手填，纯展示；游客不可见） */
  members: { id: string; grade: number | null; college: string | null; major: string | null; rank: string | null; intro: string | null }[];
  /**
   * M15：后端契约 —— isLeader 仅表示「真实队长」，isAdmin 表示「当前用户是管理员」，
   * hasIntent 表示当前用户已对该帖登记组队意愿。
   * 写操作（编辑/解散/切状态）只看 isLeader；管理员在详情页是只读视角。
   */
  viewer: { isLeader: boolean; isAdmin?: boolean; hasIntent?: boolean };
}

/** 反馈条目（后台查看 / 导出同源结构） */
export interface FeedbackItem {
  id: string;
  type: 'FUNCTION' | 'COMPETITION_INFO';
  competitionId: string | null;
  competitionName: string | null;
  pagePath: string | null;
  content: string;
  contact: string | null;
  submittedBy: { userId: string; nickname: string | null } | null;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  kind: string;
  kindLabel: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface CorrectionItem {
  id: string;
  competitionId: string;
  competition: { id: string; name: string } | null;
  field: string;
  currentValue: string | null;
  proposedValue: string | null;
  note: string | null;
  status: string;
  createdAt: string;
  reporter: { id: string; nickname: string | null; college: string | null } | null;
}

export interface RevisionItem {
  id: string;
  competitionId: string | null;
  competition: { id: string; name: string } | null;
  stageId: string | null;
  stage: { id: string; name: string } | null;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  origin: string;
  createdAt: string;
}

export interface CommentItem {
  id: string;
  content: string;
  parentId: string | null;
  /** 楼中楼：这条回复真实回复的对象（挂在根评论下） */
  replyTo?: { id: string; nickname: string | null } | null;
  /** 点赞数（冗余计数，由后端 CommentLike 维护） */
  likes: number;
  /** 当前登录用户是否已点赞 */
  liked: boolean;
  createdAt: string;
  author: { id: string; nickname: string | null; college: string | null; grade: number | null; major: string | null };
  replies: CommentItem[];
}

/**
 * M9：截止日期剩余天数，按**日历天差**计算（不是毫秒差取整）。
 *
 * 原实现 `Math.ceil((end - now) / 86400_000)` 的问题：
 * 今晚 23:59 截止会显示「剩 1 天」，午夜前后口径跳变；
 * 且过期为负数，调用方若只判 `>0` 就会把已过期误显示成「今日截止」。
 *
 * 新语义：0 = 今天截止，负数 = 已过期（N 天前截止）。
 * 例：今天 00:01 与今天 23:59 都返回 0。
 */
export function daysLeft(endAt: string | null): number | null {
  if (!endAt) return null;
  const end = dayjs(endAt);
  if (!end.isValid()) return null;
  return end.startOf('day').diff(dayjs().startOf('day'), 'day');
}

export function fmtDate(s: string | null | undefined, withTime = false): string {
  if (!s) return '待定';
  const d = dayjs(s);
  return withTime ? d.format('YYYY-MM-DD HH:mm') : d.format('YYYY-MM-DD');
}
