/**
 * 种子数据（竞赛模型 V2）
 * 1. 竞赛骨架：来自 prisma/competition-seed.json（由 scripts/gen_competition_seed.py 生成）
 *    —— 含 code / 赛道 / 阶段链 / 关键时间点，结构依据 docs/COMPETITION_INSTANCES_V2.md
 * 2. 加分标准：校教〔2026〕39 号（2027 届）学科 / 文体两套
 * 3. 演示用户与招募中队伍：保证首屏不空
 *
 * 运行：pnpm db:seed
 *
 * 环境变量：
 * - SEED_ADMIN_PASSWORD：管理员账号初始密码（管理员与测试用户共用）。未设置时两者都不写入
 *   passwordHash，只能用邮箱验证码登录后再到「个人中心」设置密码。
 * - ALLOW_PROD_SEED：该脚本会清空全库，NODE_ENV=production 时默认拒绝执行，
 *   确需在生产执行须显式设置 ALLOW_PROD_SEED=true。
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  PrismaClient,
  Audience,
  BonusTier,
  CompetitionFormat,
  EventNodeType,
  Level,
  RoleType,
  StageKind,
  TeamGoal,
  TeamStatus,
} from '@prisma/client';
import { hashPassword } from '../src/common/password';

const prisma = new PrismaClient();

interface SeedTrack {
  code: string;
  name: string;
  sortOrder: number;
  description?: string;
}
interface SeedStage {
  code: string;
  name: string;
  stageKind: StageKind;
  sequence: number;
  bonusTier: BonusTier;
  /** 归属赛道 code；null = 全赛事共享阶段 */
  track: string | null;
}
interface SeedEvent {
  stage: string;
  track: string | null;
  nodeType: EventNodeType;
  startAt?: string;
  endAt?: string;
  /** 自定义文案（覆盖节点类型默认名，如「实践赛报名截止」） */
  label?: string;
}
interface SeedCompetition {
  code: string;
  name: string;
  year: number;
  aliases: string[];
  tags: string[];
  levels: Level[];
  format: CompetitionFormat;
  audience: Audience;
  difficulty: number;
  effort: number;
  intro: string;
  /** 官网首页（权威，公开展示） */
  officialUrl?: string | null;
  sourceUrl: string | null;
  bonusCategory: string;
  bonusEligible: boolean;
  tracks: SeedTrack[];
  stages: SeedStage[];
  events: SeedEvent[];
}
interface SeedBonusStandard {
  category: string;
  level: BonusTier;
  topPoints: string;
  secondPoints: string;
  thirdPoints: string;
}
interface CompetitionSeedFile {
  documentRef: string;
  bonusStandards: SeedBonusStandard[];
  competitions: SeedCompetition[];
}

const DEMO_USERS = [
  {
    // 管理员（登录后进入后台）。初始密码取自环境变量 SEED_ADMIN_PASSWORD，未设置则无密码
    email: '2024080909015@std.uestc.edu.cn',
    studentNo: '2024080909015',
    nickname: '雷达站长',
    college: '信息与通信工程学院',
    grade: 2024,
    major: '信息工程',
    role: 'ADMIN' as const,
    bio: '机器人队负责人，主攻电控与组织调度；平时整理竞赛信息与保研政策，欢迎来问赛制和组队规划。',
    skills: [['嵌入式', 4], ['组织协调', 3]] as [string, number][],
  },
  {
    // 测试用户。初始密码同样取自 SEED_ADMIN_PASSWORD；未设置则走验证码登录
    email: '2024080909000@std.uestc.edu.cn',
    studentNo: '2024080909000',
    nickname: '测试同学',
    college: '信息与通信工程学院',
    grade: 2024,
    major: '电子信息工程',
    bio: '刚上大二，先看看大家的组队帖，学习一下竞赛节奏。',
    skills: [['Python', 3]] as [string, number][],
  },
  {
    // 以下演示用户未设密码：用验证码登录后可设置密码
    email: '2024080901015@std.uestc.edu.cn',
    studentNo: '2024080901015',
    nickname: '陈软硬件都会',
    college: '信息与通信工程学院',
    grade: 2024,
    major: '电子信息工程',
    bio: '电子设计竞赛方向，主攻 STM32 与硬件设计，打过两届电赛，目标省一再冲国奖；实验室常驻，欢迎带方案来聊。',
    skills: [['STM32', 4], ['PCB', 3], ['C++', 4]] as [string, number][],
  },
  {
    email: '2024060202021@std.uestc.edu.cn',
    studentNo: '2024060202021',
    nickname: '李建模',
    college: '数学科学学院',
    grade: 2024,
    major: '数学与应用数学',
    bio: '数学建模国赛省一，擅长论文写作与 MATLAB 建模，想找能稳定投入的编程手，一起把国赛打满。',
    skills: [['MATLAB', 4], ['论文写作', 4], ['Python', 3]] as [string, number][],
  },
  {
    email: '2023060110122@std.uestc.edu.cn',
    studentNo: '2023060110122',
    nickname: '张算法',
    college: '计算机科学与工程学院',
    grade: 2023,
    major: '计算机科学与技术',
    bio: 'ACM 校队成员，Codeforces 1900，主写 C++；欢迎算法同好一起刷题，备战济南区域赛。',
    skills: [['算法竞赛', 5], ['C++', 5], ['深度学习', 3]] as [string, number][],
  },
  {
    email: '2025050303110@std.uestc.edu.cn',
    studentNo: '2025050303110',
    nickname: '王前端',
    college: '信息与软件工程学院',
    grade: 2025,
    major: '软件工程',
    bio: '全栈方向，Vue / TypeScript 熟练，正在做 AI+医疗的创新创业项目，缺路演与商业计划书队友。',
    skills: [['Vue', 4], ['TypeScript', 4], ['UI设计', 2]] as [string, number][],
  },
];

async function main() {
  // S6a：生产防护 —— 该脚本第一步就清空全库，禁止在生产误执行
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_SEED !== 'true') {
    throw new Error('禁止在生产环境执行 seed：该脚本会清空全库数据');
  }

  // S6b：管理员初始密码不再硬编码，取自环境变量；未设置则不写 passwordHash
  // （schema 中 User.passwordHash 可空，支持纯验证码登录）
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) {
    console.warn(
      '未设置 SEED_ADMIN_PASSWORD：演示用户（含管理员）将不写入密码，请用邮箱验证码登录后在「个人中心」设置密码。',
    );
  }

  // 路径兼容：dev（tsx 直接跑 prisma/seed.ts）时 JSON 与脚本同目录；
  // 容器内跑编译产物 dist/prisma/seed.js 时 JSON 在源码 prisma/ 目录
  const seedCandidates = [
    join(__dirname, 'competition-seed.json'),
    join(__dirname, '..', '..', 'prisma', 'competition-seed.json'),
  ];
  const seedPath = seedCandidates.find((p) => existsSync(p));
  if (!seedPath) {
    throw new Error(`找不到 competition-seed.json，已尝试：${seedCandidates.join('、')}`);
  }
  const seedFile: CompetitionSeedFile = JSON.parse(readFileSync(seedPath, 'utf-8'));

  console.log('清空旧数据…');
  await prisma.$transaction([
    prisma.notification.deleteMany(),
    prisma.commentLike.deleteMany(),
    prisma.comment.deleteMany(),
    prisma.favorite.deleteMany(),
    prisma.team.deleteMany(),
    prisma.correctionReport.deleteMany(),
    prisma.competitionRevision.deleteMany(),
    prisma.competitionCustomField.deleteMany(),
    prisma.competitionMaterial.deleteMany(),
    prisma.competitionAward.deleteMany(),
    prisma.competitionEvent.deleteMany(),
    prisma.competitionStage.deleteMany(),
    prisma.competitionTrack.deleteMany(),
    prisma.competitionTag.deleteMany(),
    prisma.competitionLevel.deleteMany(),
    prisma.competition.deleteMany(),
    prisma.bonusStandard.deleteMany(),
    prisma.userSkill.deleteMany(),
    prisma.banRecord.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  console.log('写入用户…');
  const users: Record<string, string> = {};
  for (const u of DEMO_USERS) {
    const created = await prisma.user.create({
      data: {
        email: u.email,
        studentNo: u.studentNo,
        nickname: u.nickname,
        college: u.college,
        grade: u.grade,
        major: u.major,
        role: u.role ?? 'STUDENT',
        bio: u.bio ?? null,
        passwordHash: adminPassword ? hashPassword(adminPassword) : null,
        skills: { create: u.skills.map(([skill, level]) => ({ skill, level })) },
      },
    });
    users[u.nickname] = created.id;
  }

  console.log(`写入竞赛（${seedFile.competitions.length} 项，含赛道 / 赛程阶段 / 时间节点）…`);
  const compIds: Record<string, string> = {};

  // 加分标准：校教〔2026〕39 号（2027 届）学科 / 文体两套
  const standardIds: Record<string, string> = {};
  for (const s of seedFile.bonusStandards) {
    const created = await prisma.bonusStandard.create({
      data: {
        documentRef: seedFile.documentRef,
        category: s.category,
        level: s.level,
        topPoints: s.topPoints,
        secondPoints: s.secondPoints,
        thirdPoints: s.thirdPoints,
      },
    });
    standardIds[`${s.category}:${s.level}`] = created.id;
  }

  for (const c of seedFile.competitions) {
    const comp = await prisma.competition.create({
      data: {
        code: c.code,
        name: c.name,
        year: c.year,
        aliases: c.aliases,
        officialUrl: c.officialUrl ?? undefined,
        sourceUrl: c.sourceUrl ?? undefined,
        format: c.format,
        audience: c.audience,
        difficulty: c.difficulty,
        effort: c.effort,
        intro: c.intro,
        hasTracks: c.tracks.length > 0,
        stageChain: (() => {
          const names: string[] = [];
          for (const s of c.stages) if (!names.includes(s.name)) names.push(s.name);
          return names.join(' → ');
        })(),
        isBonusEligible: c.bonusEligible,
        bonusCategory: c.bonusCategory,
        bonusStandardId: standardIds[`${c.bonusCategory}:${BonusTier.NATIONAL}`] ?? null,
        levels: { create: c.levels.map((level) => ({ level })) },
        tags: { create: c.tags.map((tag) => ({ tag })) },
      },
    });
    compIds[c.name] = comp.id;

    // 赛道 → 先建赛道，拿到 code → id 映射
    const trackIdByCode: Record<string, string> = {};
    for (const t of c.tracks) {
      const track = await prisma.competitionTrack.create({
        data: {
          competitionId: comp.id,
          code: t.code,
          name: t.name,
          sortOrder: t.sortOrder,
          description: t.description ?? null,
        },
      });
      trackIdByCode[t.code] = track.id;
    }

    // 赛程阶段 → 时间节点
    const stageIdByKey: Record<string, string> = {};
    for (const s of c.stages) {
      const stage = await prisma.competitionStage.create({
        data: {
          competitionId: comp.id,
          trackId: s.track ? (trackIdByCode[s.track] ?? null) : null,
          code: s.code,
          name: s.name,
          stageKind: s.stageKind,
          sequence: s.sequence,
          bonusTier: s.bonusTier,
        },
      });
      stageIdByKey[`${s.track ?? ''}:${s.code}`] = stage.id;
    }
    for (const e of c.events) {
      const stageId = stageIdByKey[`${e.track ?? ''}:${e.stage}`];
      if (!stageId) continue;
      await prisma.competitionEvent.create({
        data: {
          competitionId: comp.id,
          stageId,
          trackId: e.track ? (trackIdByCode[e.track] ?? null) : null,
          nodeType: e.nodeType,
          label: e.label ?? null,
          startAt: e.startAt ? new Date(`${e.startAt}T00:00:00Z`) : null,
          endAt: e.endAt ? new Date(`${e.endAt}T16:00:00Z`) : null,
        },
      });
    }
  }

  console.log('写入获奖记录…');
  const elecId = compIds['全国大学生电子设计竞赛'];
  const icpcId = compIds['ACM-ICPC 国际大学生程序设计竞赛'];
  await prisma.competitionAward.createMany({
    data: [
      {
        competitionId: elecId,
        year: 2025,
        awardName: '全国一等奖',
        teamName: '成电一队',
        members: ['陈软硬件都会', '李建模', '张算法'],
      },
      {
        competitionId: elecId,
        year: 2025,
        awardName: '全国二等奖',
        teamName: '格院联队',
        members: ['赵一', '钱二', '孙三'],
      },
      {
        competitionId: icpcId,
        year: 2025,
        awardName: '亚洲区域赛银牌',
        teamName: 'UESTC_Astral',
        members: ['张算法', '周四', '吴五'],
      },
    ],
  });

  console.log('写入招募帖…');
  const ddl = (s: string) => new Date(s);
  const teamIds: Record<string, string> = {};

  const teamsData = [
    {
      competitionName: '全国大学生电子设计竞赛',
      leaderNick: '陈软硬件都会',
      goal: TeamGoal.PRIZE,
      neededRoles: [RoleType.HARDWARE, RoleType.PAPER],
      requirement: '缺硬件和论文队友。有 STM32 开发经验优先，每周能到实验室 3 次以上，目标省一冲国奖。',
      qq: '2451109901',
      wechat: 'chen_dianqi_uestc',
      deadline: ddl('2026-10-20T16:00:00Z'),
      targetSize: 4,
      members: [
        { grade: 2024, college: '信息与通信工程学院', major: '电子信息工程', rank: '前 10%', intro: '陈同学（队长），软硬件都会，负责整体方案与嵌入式开发。' },
        { grade: 2024, college: '自动化工程学院', major: '自动化', rank: '前 15%', intro: '刘同学，负责建模与仿真，熟悉 MATLAB。' },
      ],
      status: TeamStatus.RECRUITING,
    },
    {
      competitionName: '全国大学生数学建模竞赛',
      leaderNick: '李建模',
      goal: TeamGoal.NATIONAL_FIRST,
      neededRoles: [RoleType.ALGORITHM],
      requirement: '三人队还缺一名编程手（Python/MATLAB 均可），最好有数值算法功底，赛前一起刷真题。',
      qq: null,
      wechat: 'ljianmo2024',
      deadline: ddl('2027-09-03T16:00:00Z'),
      targetSize: 3,
      members: [
        { grade: 2024, college: '数学科学学院', major: '数学与应用数学', rank: '前 5%', intro: '李同学（队长），建模与论文写作。' },
      ],
      status: TeamStatus.RECRUITING,
    },
    {
      competitionName: 'ACM-ICPC 国际大学生程序设计竞赛',
      leaderNick: '张算法',
      goal: TeamGoal.PRACTICE,
      neededRoles: [RoleType.ALGORITHM, RoleType.OTHER],
      requirement: '招一名能稳定出的队友，Codeforces 1600+ 优先，一起备战济南区域赛。',
      qq: '1133246670',
      wechat: null,
      deadline: ddl('2026-09-30T16:00:00Z'),
      targetSize: 3,
      members: [
        { grade: 2023, college: '计算机科学与工程学院', major: '计算机科学与技术', rank: '前 3%', intro: '张同学（队长），CF 1900，主写代码。' },
      ],
      status: TeamStatus.RECRUITING,
    },
    {
      competitionName: '中国国际大学生创新大赛',
      leaderNick: '王前端',
      goal: TeamGoal.BONUS_ONLY,
      neededRoles: [RoleType.DEFENSE, RoleType.PAPER],
      requirement: '已有完整项目（AI+医疗方向），缺路演和商业计划书撰写队友，加分为主、拿奖随缘。',
      qq: null,
      wechat: 'wangfd_uestc',
      deadline: ddl('2026-09-28T16:00:00Z'),
      targetSize: 5,
      members: [
        { grade: 2025, college: '信息与软件工程学院', major: '软件工程', rank: '前 20%', intro: '王同学（队长），负责前端与产品演示。' },
        { grade: 2024, college: '信息与软件工程学院', major: '软件工程', rank: null, intro: '郑同学，负责后端开发。' },
      ],
      status: TeamStatus.RECRUITING,
    },
    {
      competitionName: '全国大学生机器人大赛（CURC）',
      leaderNick: '雷达站长',
      goal: TeamGoal.PRACTICE,
      neededRoles: [RoleType.HARDWARE, RoleType.ALGORITHM, RoleType.FRONTEND],
      requirement: '机器人队秋季招新，机械/电控/视觉三个方向都要人，氛围好、经费足。',
      qq: '986312504',
      wechat: null,
      deadline: ddl('2026-10-15T16:00:00Z'),
      targetSize: 8,
      members: [
        { grade: 2024, college: '信息与通信工程学院', major: '信息工程', rank: '前 10%', intro: '雷达站长（队长），负责组织与电控。' },
        { grade: 2023, college: '机械与电气工程学院', major: '机械设计制造及其自动化', rank: '前 20%', intro: '冯同学，负责机械结构设计。' },
      ],
      status: TeamStatus.RECRUITING,
    },
  ];

  for (const t of teamsData) {
    const team = await prisma.team.create({
      data: {
        competitionId: compIds[t.competitionName],
        leaderId: users[t.leaderNick],
        goal: t.goal,
        neededRoles: t.neededRoles,
        requirement: t.requirement,
        qq: t.qq,
        wechat: t.wechat,
        deadline: t.deadline,
        targetSize: t.targetSize,
        status: t.status,
        members: { create: t.members },
      },
    });
    teamIds[t.leaderNick] = team.id;
  }

  console.log('写入留言与关注…');
  await prisma.comment.createMany({
    data: [
      {
        authorId: users['张算法'],
        targetType: 'COMPETITION',
        targetId: elecId,
        content: '校选赛题目偏基础，认真准备稳过。实验室常开但冬冷夏热，自备外套。',
      },
      {
        authorId: users['李建模'],
        targetType: 'COMPETITION',
        targetId: compIds['全国大学生数学建模竞赛'],
        content: '想找队友的可以直接去组队区看看，A 题一般偏物理，B 题偏离散优化。',
      },
      // 招募帖下的评论区（广告牌模式：感兴趣直接留言 + 加联系方式）
      {
        authorId: users['李建模'],
        targetType: 'TEAM',
        targetId: teamIds['陈软硬件都会'],
        content: '我对论文方向很感兴趣，之前拿过校模赛一等奖，可以投简历看看吗？',
        likes: 2,
      },
      {
        authorId: users['王前端'],
        targetType: 'TEAM',
        targetId: teamIds['陈软硬件都会'],
        content: '帮顶！这个队靠谱。',
        likes: 1,
      },
    ],
  });
  const elecTeamComment = await prisma.comment.findFirst({
    where: { targetType: 'TEAM', targetId: teamIds['陈软硬件都会'], authorId: users['李建模'] },
  });
  if (elecTeamComment) {
    await prisma.commentLike.createMany({
      data: [
        { userId: users['张算法'], commentId: elecTeamComment.id },
        { userId: users['雷达站长'], commentId: elecTeamComment.id },
      ],
    });
  }
  await prisma.favorite.create({
    data: { userId: users['雷达站长'], targetType: 'COMPETITION', targetId: elecId },
  });

  // 系统公告 + 全员系统通知（消息中心可见，横幅只在首页弹一次）
  if ((await prisma.announcement.count()) === 0) {
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    const ann = await prisma.announcement.create({
      data: {
        title: '欢迎来到 UESTC TeamUp',
        content: '校内竞赛信息与组队平台试运行中，遇到问题请通过留言或举报反馈。',
        createdBy: admin!.id,
      },
    });
    const allUsers = await prisma.user.findMany({ select: { id: true } });
    await prisma.notification.createMany({
      data: allUsers.map((u) => ({
        userId: u.id,
        kind: 'SYSTEM_NOTIFICATION' as const,
        payload: { announcementId: ann.id, title: ann.title, content: ann.content },
      })),
    });
  }

  // 12) 采集源预设（针对电子科技大学竞赛信息与研究生院实践）

  const counts = {
    competitions: await prisma.competition.count(),
    bonusEligible: await prisma.competition.count({ where: { isBonusEligible: true } }),
    tracks: await prisma.competitionTrack.count(),
    stages: await prisma.competitionStage.count(),
    events: await prisma.competitionEvent.count(),
    teams: await prisma.team.count(),
    users: await prisma.user.count(),
  };
  console.log('种子完成：', counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
