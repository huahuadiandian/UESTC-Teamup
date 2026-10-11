# 字段清单（可编辑）

> 生成时间：2026-10-11，基于 `apps/api/prisma/schema.prisma`（**竞赛模型 V2**，迁移 `20261011080000_drop_legacy_competition` / `20261011100000_competition_bonus_category`）。
> **2026-10-11 竞赛模型 V2**：竞赛结构改为三维正交 `Competition × CompetitionTrack × CompetitionStage → CompetitionEvent`；移除 `CompetitionTimeline` 与整套采集子系统（Crawl* 五张表 + `src/modules/crawler/`）。设计文档见 [COMPETITION_MODEL_V2.md](./COMPETITION_MODEL_V2.md)。
> **2026-09-19 改版**：匹配域按「广告牌模式」设计。**2026-09-20**：恢复 `Team.targetSize` + `TeamMember`。**2026-09-27**：联系方式拆分 QQ/微信、新增组队意愿 `TeamIntent`、用户手动建档免审核即时发布。
>
> **用法**：直接在本文件上增删改行，改完后告诉我「清单改完了」，我会据此同步更新：
> 后端 `schema.prisma`（并生成迁移）→ `packages/shared` 枚举与类型 → 前端 `api/types.ts`、表单页与列表页。
>
> - 「可空」= 该字段允许不填；「默认 X」= 未填时自动取值。
> - 类型含义：文本 / 长文本 / 整数 / 布尔 / 时间 / JSON / 字符串数组。

---

## 目录

1. [枚举](#枚举)
2. [用户域](#用户域)：User、UserSkill
3. [竞赛域（V2）](#竞赛域v2)：Competition、CompetitionTrack、CompetitionStage、CompetitionEvent、BonusStandard、CompetitionLevel、CompetitionTag、CompetitionAward、CompetitionMaterial、CompetitionCustomField、CompetitionRevision、CorrectionReport
4. [匹配域](#匹配域广告牌模式)：Team（招募帖）、TeamMember、TeamIntent
5. [内容与通知域](#内容与通知域)：Post、Comment、CommentLike、Favorite、Notification、Report、Feedback
6. [管理域](#管理域)：MailLog、BanRecord、Announcement
7. [附录：接口返回的派生字段（只读）](#附录接口返回的派生字段只读)

---

## 枚举

改枚举值 = 同时改数据库枚举 + 前后端下拉选项；中文标签随值一起维护。

### Level（竞赛覆盖级别，展示用；与加分折算口径 BonusTier 分离）

| 值 | 中文标签 |
| --- | --- |
| INTERNATIONAL | 国际级 |
| NATIONAL | 国家级 |
| PROVINCIAL | 省级 |
| SCHOOL | 校级 |

### UserRole（用户角色）

| 值 | 中文标签 |
| --- | --- |
| STUDENT | 学生 |
| CONTRIBUTOR | 认证贡献者 |
| ADMIN | 管理员 |

### CompetitionFormat（赛制：赛事级为兜底，赛道级可覆盖）

| 值 | 中文标签 |
| --- | --- |
| INDIVIDUAL | 个人赛 |
| TEAM | 团队赛 |

### Audience（面向人群）

| 值 | 中文标签 |
| --- | --- |
| UNDERGRAD | 本科生 |
| POSTGRAD | 研究生 |
| MIXED | 本研皆可 |

### StageKind（赛程阶段语义类型，V2 新增）

> 覆盖「校赛→省赛→国赛」与「预选赛→区域赛→全国赛」等所有常见链；阶段链由数据行定义，不用枚举穷举。

| 值 | 中文标签 |
| --- | --- |
| CAMPUS | 校内赛 / 校赛 |
| QUALIFIER | 预选赛 / 资格赛 / 网络赛 |
| REGIONAL | 区域赛 / 赛区赛 / 分区赛 |
| PROVINCIAL | 省级赛 / 省赛 |
| NATIONAL | 全国赛 / 国赛 |
| INTERNATIONAL | 国际赛 |
| FINAL | 总决赛 / 终审决赛 |
| OTHER | 其他 |

### EventNodeType（时间节点类型，V2 新增）

| 值 | 中文标签 |
| --- | --- |
| SIGNUP_START | 报名开始 |
| SIGNUP_END | 报名截止 |
| SUBMISSION | 作品 / 材料提交 |
| CONTEST | 比赛 / 答辩 |
| RESULT | 结果公布 |
| AWARD | 颁奖 |
| OTHER | 其他 |

### BonusTier（推免认定档次，V2 新增；与 Level 区分：Level 是级别展示，BonusTier 是加分折算）

| 值 | 中文标签 |
| --- | --- |
| NATIONAL | 国家级 |
| PROVINCIAL | 省级 |
| NONE | 不认定 |

### TeamGoal（组队目标）

| 值 | 中文标签 |
| --- | --- |
| PRIZE | 争取拿奖 |
| PRACTICE | 学习练手 |
| NATIONAL_FIRST | 冲国一 |
| BONUS_ONLY | 保研加分 |

### TeamStatus（招募帖状态）

> RECRUITING / FULL / DISBANDED 队长手动切换；COMPETING 由系统根据竞赛赛程自动设置（比赛节点开始后置为参赛，不自动回退）；DISBANDED 是终态（进入「我的」归档仓库）。

| 值 | 中文标签 |
| --- | --- |
| RECRUITING | 招募中 |
| FULL | 已满员 |
| COMPETING | 参赛中（系统设置，不能手动） |
| DISBANDED | 已解散（终态，进归档仓库） |

### RoleType（队伍角色/空位类型）

| 值 | 中文标签 |
| --- | --- |
| ALGORITHM | 算法 |
| FRONTEND | 前端 |
| BACKEND | 后端 |
| HARDWARE | 硬件 |
| MODELING | 建模 |
| UI | UI |
| PAPER | 论文 |
| DEFENSE | 答辩 |
| OTHER | 其他（固定枚举标签，不支持自定义输入；个性化方向写在 requirement 字段） |

### PublishStatus（发布状态）

| 值 | 中文标签 |
| --- | --- |
| DRAFT | 草稿 |
| PUBLISHED | 已发布 |
| ARCHIVED | 已下线 |

### MaterialKind（资料/帖子类型）

| 值 | 中文标签 |
| --- | --- |
| PAST_PAPER | 真题 |
| OPEN_SOURCE | 开源作品 |
| EXPERIENCE | 经验帖 |
| TEMPLATE | 模板 |

### CommentTarget（评论/收藏目标类型）

| 值 | 中文标签 |
| --- | --- |
| COMPETITION | 竞赛 |
| POST | 帖子 |
| TEAM | 队伍 |

### NotificationKind（通知类型）

| 值 | 中文标签 |
| --- | --- |
| DDL_REMINDER | DDL 提醒 |
| COMMENT_REPLY | 回复 |
| CORRECTION_NEW | 用户纠错 |
| SYSTEM_NOTIFICATION | 系统通知 |
| TEAM_INTENT | 组队意愿 |

### RevisionOrigin（版本记录来源）

| 值 | 中文标签 |
| --- | --- |
| MANUAL | 人工修改 |
| ROLLBACK | 回滚动作 |

### CorrectionStatus（纠错状态）

| 值 | 中文标签 |
| --- | --- |
| PENDING | 待处理 |
| ACCEPTED | 已采纳 |
| REJECTED | 已驳回 |

### FeedbackType（用户反馈类型，2026-09-27 新增）

| 值 | 中文标签 |
| --- | --- |
| FUNCTION | 功能反馈 |
| COMPETITION_INFO | 竞赛信息反馈 |

---

## 用户域

### User（用户）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 用户 ID |
| studentNo | 文本 | 必填，全局唯一 | 学号（登录用） |
| email | 文本 | 必填，全局唯一 | 邮箱（登录用，验证码注册） |
| passwordHash | 文本 | 可空 | 密码哈希（scrypt）；首次验证码注册后可未设密码，注册/完善资料流程中必填 |
| college | 文本 | **必填** | 学院 |
| grade | 整数 | **必填** | 年级（入学年份） |
| major | 文本 | **必填** | 专业 |
| nickname | 文本 | **必填** | 昵称 |
| bio | 长文本 | 可空 | 个人简介 |
| role | 枚举 UserRole | 默认 STUDENT | 角色 |
| banned | 布尔 | 默认 false | 是否已封禁 |
| createdAt | 时间 | 自动 | 注册时间 |
| updatedAt | 时间 | 自动 | 更新时间 |

> 学号按登录态裁剪：接口序列化时**游客不下发 studentNo**（2026-09-27 隐私收敛）。

### UserSkill（用户技能）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| userId | 文本 | 联合主键 | 所属用户 |
| skill | 文本 | 联合主键 | 技能名（自由文本） |
| level | 整数 | 可空 | 熟练度（1-5） |

---

## 竞赛域（V2）

> 概念：**Track（在哪条赛道） × Stage（走到哪一层） → Event（具体哪天）**，三个维度正交。
> 无赛道的赛事不建 Track 行，所有 Stage.trackId = null（共享阶段）。

### Competition（赛事主档，每届一行）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 竞赛 ID |
| code | 文本 | 必填，`(code, year)` 唯一 | 稳定业务编码，跨年沿用（如 CUMCM / HUAWEI-ICT）；用户手动建档自动生成 `USER-xxx` |
| name | 文本 | 必填 | 竞赛名称 |
| shortName | 文本 | 可空 | 短名 |
| year | 整数 | 必填 | 届次年份（唯一性 = code + year） |
| aliases | 字符串数组 | 必填（可为空数组） | 别名列表（逗号分隔录入，用于搜索） |
| organizer | 文本 | 可空 | 主办方 |
| officialUrl | 文本 | 可空 | 官网地址 |
| sourceUrl | 文本 | 可空 | 信息来源地址 |
| format | 枚举 CompetitionFormat | 可空 | 赛事级默认赛制（无赛道时用；有赛道由 Track 覆盖） |
| teamSizeMin | 整数 | 可空 | 最小队伍人数（赛事级兜底） |
| teamSizeMax | 整数 | 可空 | 最大队伍人数（赛事级兜底） |
| audience | 枚举 Audience | 可空 | 面向人群 |
| intro | 长文本 | 可空 | 简介 |
| difficulty | 整数 | 可空 | 难度评分（1-5） |
| effort | 整数 | 可空 | 投入度评分（1-5） |
| hasTracks | 布尔 | 默认 false | 结构派生字段：是否含赛道（落库便于筛选，可重算） |
| stageChain | 文本 | 可空 | 结构派生字段：赛程链展示缓存，如「校赛 → 省赛 → 国赛」 |
| isBonusEligible | 布尔 | 可空 | 是否推免加分 |
| bonusCategory | 文本 | 可空 | **竞赛类别**（校教〔2026〕39号口径）：学科竞赛 / 文体竞赛；列表页可按此筛选，详情页按类别展示对应分值标准 |
| bonusStandardId | 文本 | 可空 | 引用 BonusStandard（分值标准统一维护，无需逐赛填写） |
| bonusSpecialRule | 长文本 | 可空 | 加分特殊规则文本（如美赛 Outstanding 映射） |
| status | 枚举 PublishStatus | 默认 PUBLISHED | 发布状态（用户手动建档即时 PUBLISHED 并知会管理员） |
| createdAt | 时间 | 自动 | 创建时间 |
| updatedAt | 时间 | 自动 | 更新时间 |

### CompetitionTrack（赛道 / 赛项，V2 新增）

> 顶层 = 赛道，子层 = 赛项（parentId 自引用，树形）；无赛道的赛事此表为空。

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 赛道 ID |
| competitionId | 文本 | 必填，`(competitionId, code)` 唯一 | 所属竞赛 |
| parentId | 文本 | 可空 | 父赛道（赛项挂在赛道下） |
| code | 文本 | 必填 | 赛道编码，如 BIGDATA |
| name | 文本 | 必填 | 赛道名，如 大数据挑战赛 |
| shortName | 文本 | 可空 | 短名 |
| aliases | 字符串数组 | 必填（可为空数组） | 别名 |
| description | 长文本 | 可空 | 赛道描述 |
| sortOrder | 整数 | 默认 0 | 排序 |
| isActive | 布尔 | 默认 true | 是否启用 |
| format | 枚举 CompetitionFormat | 可空 | 赛制下沉到赛道级（留空回落赛事级） |
| teamSizeMin | 整数 | 可空 | 赛道级人数下限 |
| teamSizeMax | 整数 | 可空 | 赛道级人数上限 |

### CompetitionStage（赛程阶段，V2 新增）

> 某赛事的阶段链 = 该赛事下按 sequence 排序的一组 Stage 行；trackId = null → 全赛事共享（如「报名」），否则为该赛道专属。

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 阶段 ID |
| competitionId | 文本 | 必填 | 所属竞赛 |
| trackId | 文本 | 可空 | 所属赛道（null = 全赛事共享阶段） |
| code | 文本 | 必填，`(competitionId, trackId, code)` 唯一 | 阶段编码 |
| name | 文本 | 必填 | 展示名：「校赛」/「西南赛区」/「全国总决赛」 |
| stageKind | 枚举 StageKind | 必填 | 语义类型 |
| scope | 文本 | 可空 | 赛区/省份限定：「西南赛区」/「四川省」 |
| sequence | 整数 | 必填 | 链内顺序（1,2,3...），前端按此渲染路线图 |
| bonusTier | 枚举 BonusTier | 可空 | 推免认定口径：该阶段奖项折算到哪一档（与 stageKind 解耦） |
| note | 长文本 | 可空 | 备注 |

### CompetitionEvent（时间节点，V2 新增，替代 CompetitionTimeline）

> 挂在阶段上，一个阶段可有多个节点；各赛道日期常常不同 → 分属各自阶段的节点。

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 节点 ID |
| competitionId | 文本 | 必填 | 所属竞赛（冗余，便于按赛事查询） |
| stageId | 文本 | 必填 | 所属阶段 |
| trackId | 文本 | 可空 | 冗余自 Stage，便于按赛道过滤 |
| nodeType | 枚举 EventNodeType | 必填 | 节点类型 |
| label | 文本 | 可空 | 自定义文案（覆盖默认名） |
| startAt | 时间 | 可空 | 开始时间 |
| endAt | 时间 | 可空 | 结束时间（通常为 DDL） |
| location | 文本 | 可空 | 承办地 / 线上 |
| isLocked | 布尔 | 默认 false | 人工锁定（预留给将来自动更新不覆盖） |
| sourceUrl | 文本 | 可空 | 来源链接 |
| note | 长文本 | 可空 | 备注 |
| createdAt | 时间 | 自动 | 创建时间 |
| updatedAt | 时间 | 自动 | 更新时间 |

### BonusStandard（推免加分标准，V2 新增）

> 按认定文件 + 类别 + 档次统一维护，替代对所有竞赛写死同一句 bonusPoints。

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 标准 ID |
| documentRef | 文本 | 必填，`(documentRef, category, level)` 唯一 | 认定文件标识，如「校教〔2026〕39号-2027届」 |
| category | 文本 | 必填 | 类别：学科竞赛 / 文体竞赛 |
| level | 枚举 BonusTier | 必填 | 档次（NATIONAL / PROVINCIAL） |
| topPoints | 文本 | 必填 | 最高奖分值 |
| secondPoints | 文本 | 必填 | 次高奖分值 |
| thirdPoints | 文本 | 必填 | 次次高奖分值 |
| note | 长文本 | 可空 | 备注 |

### CompetitionLevel（竞赛覆盖级别，多值）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| competitionId | 文本 | 联合主键 | 所属竞赛 |
| level | 枚举 Level | 联合主键 | 级别（一个竞赛可有 校→省→国 多档） |

### CompetitionTag（竞赛标签）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| competitionId | 文本 | 联合主键 | 所属竞赛 |
| tag | 文本 | 联合主键 | 标签名（自由文本，逗号分隔录入） |

### CompetitionAward（历届获奖，赛事级）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 记录 ID |
| competitionId | 文本 | 必填 | 所属竞赛 |
| year | 整数 | 可空 | 获奖年份 |
| awardName | 文本 | 可空 | 奖项名 |
| awardTier | 枚举 BonusTier | 可空 | 奖项折算档次 |
| teamName | 文本 | 可空 | 队伍名 |
| members | 字符串数组 | 必填（可为空数组） | 成员名单 |
| sourceUrl | 文本 | 可空 | 来源链接 |

### CompetitionMaterial（竞赛资料）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 资料 ID |
| competitionId | 文本 | 必填 | 所属竞赛 |
| kind | 枚举 MaterialKind | 必填 | 资料类型 |
| title | 文本 | 必填 | 标题 |
| url | 文本 | 必填 | 链接 |
| authorId | 文本 | 可空 | 上传者 |

### CompetitionCustomField（竞赛自定义键值，长尾差异）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 行 ID |
| competitionId | 文本 | 必填，`(competitionId, key)` 唯一 | 所属竞赛 |
| key | 文本 | 必填 | 字段名（支持中文/字母/数字/下划线/短横线） |
| value | 长文本 | 必填 | 字段值（纯文本，最长 500 字） |
| updatedById | 文本 | 可空 | 最后修改人 |
| createdAt | 时间 | 自动 | 创建时间 |
| updatedAt | 时间 | 自动 | 更新时间 |

### CompetitionRevision（版本记录：人工修改 / 回滚留痕）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 记录 ID |
| competitionId | 文本 | 可空 | 关联竞赛（竞赛删除后置空） |
| stageId | 文本 | 可空 | 关联阶段（阶段删除后置空） |
| field | 文本 | 必填 | 被修改的字段名 |
| oldValue | 长文本 | 可空 | 旧值 |
| newValue | 长文本 | 可空 | 新值 |
| origin | 枚举 RevisionOrigin | 必填 | 修改来源（人工 / 回滚） |
| createdAt | 时间 | 自动 | 发生时间 |

### CorrectionReport（用户纠错）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 纠错 ID |
| competitionId | 文本 | 必填 | 所属竞赛 |
| field | 文本 | 必填 | 纠错字段名 |
| currentValue | 文本 | 可空 | 当前值 |
| proposedValue | 文本 | 可空 | 建议值 |
| note | 长文本 | 可空 | 补充说明 |
| reporterId | 文本 | 必填 | 提交人 |
| status | 枚举 CorrectionStatus | 默认 PENDING | 处理状态 |
| createdAt | 时间 | 自动 | 提交时间 |

---

## 匹配域（广告牌模式）

> 平台不做申请 / 邀请 / 审批 / 私聊。队长发布招募帖（广告牌），感兴趣的人看到后**登记「我想组队」意愿**或通过队长公开的联系方式直接线下联系；进队、退队都在平台外发生。
> 帖子下方的评论区 = Comment（targetType = TEAM）+ CommentLike 点赞，见「内容与通知域」。

### Team（招募帖）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 帖子 ID |
| competitionId | 文本 | 必填 | 所属竞赛（也可只填竞赛名自动建档） |
| leaderId | 文本 | 必填 | 发帖人（队长） |
| goal | 枚举 TeamGoal | 必填 | 组队目标 |
| neededRoles | RoleType[] | 必填（可为空数组） | 招募方向标签（卡片展示 + 按方向筛选，最多 10 个，去重） |
| requirement | 长文本 | 可空 | 招募要求（方向、水平等，自由文本） |
| qq | 文本 | 可空（QQ/微信至少一项） | QQ 号（最长 64 字；广告牌模式下按意愿解锁展示） |
| wechat | 文本 | 可空（QQ/微信至少一项） | 微信号（最长 64 字） |
| deadline | 时间 | 可空 | 招募截止时间（默认填竞赛报名截止时间） |
| targetSize | 整数 | 可空 | 计划招募人数（含队长本人，1-99，展示用） |
| status | 枚举 TeamStatus | 默认 RECRUITING | 帖子状态（COMPETING 由系统按赛程自动设置） |
| createdAt | 时间 | 自动 | 发布时间 |
| updatedAt | 时间 | 自动 | 更新时间 |

### TeamMember（已有成员情况，队长手填）

> 成员仅作展示信息（加入在平台外发生），不关联平台账号、不做身份管理；**memberCount = 1 + 本表行数（队长本人是第 1 人，B1 口径）**。

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 成员行 ID |
| teamId | 文本 | 必填 | 所属招募帖 |
| grade | 整数 | 可空 | 年级（入学年份） |
| college | 文本 | 可空 | 学院 |
| major | 文本 | 可空 | 专业 |
| rank | 文本 | 可空 | rank（成绩/排名，如「前 15%」） |
| intro | 长文本 | 可空 | 成员介绍（方向、经历，可含称呼） |
| createdAt | 时间 | 自动 | 录入时间 |

### TeamIntent（组队意愿，2026-09-27 新增）

> 登录用户点击「我想组队」即登记；`(teamId, userId)` 唯一防重复，可撤销。招募人只看到计数，看不到名单。

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 意愿 ID |
| teamId | 文本 | 必填，`(teamId, userId)` 唯一 | 所属招募帖 |
| userId | 文本 | 必填 | 登记人 |
| createdAt | 时间 | 自动 | 登记时间 |

---

## 内容与通知域

### Post（经验帖，P2 仅建表预留）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 帖子 ID |
| authorId | 文本 | 必填 | 作者 |
| title | 文本 | 必填 | 标题 |
| content | 长文本 | 必填 | 正文 |
| kind | 枚举 MaterialKind | 必填 | 帖子类型 |
| refined | 布尔 | 默认 false | 是否精华 |
| likes | 整数 | 默认 0 | 点赞数 |
| createdAt | 时间 | 自动 | 发布时间 |
| updatedAt | 时间 | 自动 | 更新时间 |

### Comment（评论，多态：竞赛/帖子/招募帖）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 评论 ID |
| authorId | 文本 | 必填 | 评论人 |
| targetType | 枚举 CommentTarget | 必填 | 目标类型（TEAM = 招募帖下的评论区） |
| targetId | 文本 | 必填 | 目标 ID |
| content | 长文本 | 必填 | 内容 |
| parentId | 文本 | 可空 | 父评论（楼中楼拍平：永远指向根评论） |
| replyToId | 文本 | 可空 | 回复的回复时记录真实回复对象 |
| likes | 整数 | 默认 0 | 点赞数（冗余计数，由 CommentLike 维护） |
| createdAt | 时间 | 自动 | 发布时间 |

### CommentLike（评论点赞）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| userId | 文本 | 联合主键 | 点赞人 |
| commentId | 文本 | 联合主键 | 被点赞的评论 |
| createdAt | 时间 | 自动 | 点赞时间 |

### Favorite（收藏）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| userId | 文本 | 联合主键 | 收藏人 |
| targetType | 枚举 CommentTarget | 联合主键 | 目标类型 |
| targetId | 文本 | 联合主键 | 目标 ID |
| createdAt | 时间 | 自动 | 收藏时间 |

### Notification（站内通知）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 通知 ID |
| userId | 文本 | 必填 | 接收人 |
| kind | 枚举 NotificationKind | 必填 | 通知类型 |
| payload | JSON | 必填 | 通知内容（跳转参数、聚合计数等） |
| readAt | 时间 | 可空 | 已读时间（空 = 未读） |
| createdAt | 时间 | 自动 | 发出时间 |

### Report（举报，P2 处理台已建）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 举报 ID |
| reporterId | 文本 | 必填 | 举报人 |
| targetType | 文本 | 必填 | 目标类型（TEAM/USER/COMMENT） |
| targetId | 文本 | 必填 | 目标 ID |
| reason | 长文本 | 必填 | 举报理由 |
| handled | 布尔 | 默认 false | 是否已处理 |
| createdAt | 时间 | 自动 | 举报时间 |

### Feedback（用户反馈，2026-09-27 新增）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 反馈 ID |
| type | 枚举 FeedbackType | 必填 | 类型（功能 / 竞赛信息） |
| competitionId | 文本 | 可空 | 关联竞赛（删除后置空） |
| competitionName | 文本 | 可空 | 提交时竞赛名快照（防竞赛改名后对不上号） |
| pagePath | 文本 | 可空 | 提交页面路径 |
| content | 长文本 | 必填 | 反馈内容 |
| contact | 文本 | 可空 | 联系方式（自愿填） |
| userId | 文本 | 可空 | 提交人（游客可提交，删除后置空） |
| createdAt | 时间 | 自动 | 提交时间 |

---

## 管理域

### MailLog（发信日志，邮件留空暂不写入）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 日志 ID |
| to | 文本 | 必填 | 收件邮箱 |
| kind | 文本 | 必填 | 邮件类型 |
| status | 文本 | 必填 | 发送结果 |
| error | 文本 | 可空 | 失败原因 |
| sentAt | 时间 | 自动 | 发送时间 |

### BanRecord（封禁记录）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 记录 ID |
| userId | 文本 | 必填 | 被封禁用户 |
| actorId | 文本 | 必填 | 操作管理员 |
| reason | 文本 | 可空 | 封禁理由 |
| createdAt | 时间 | 自动 | 操作时间 |

### Announcement（系统公告）

| 字段 | 类型 | 可空/默认 | 说明 |
| --- | --- | --- | --- |
| id | 文本 | 主键，自动生成 | 公告 ID |
| title | 文本 | 必填 | 标题 |
| content | 长文本 | 必填 | 内容 |
| active | 布尔 | 默认 true | 是否启用（站内弹窗/横幅展示） |
| createdBy | 文本 | 必填 | 发布管理员 |
| createdAt | 时间 | 自动 | 发布时间 |

---

## 附录：接口返回的派生字段（只读）

这些字段**不存库**，由后端查询时计算。如果你希望它们变成本人可编辑的真实字段，或调整计算规则，也可以直接改下面的表格告诉我。

### 竞赛列表项 / 详情（CompetitionListItem / CompetitionDetail）

| 字段 | 说明 |
| --- | --- |
| recruitingTeams | 该竞赛下招募中的队伍数（计数） |
| nextDeadline | 最近一个未过期的「报名截止」节点 endAt（V2：合并共享阶段与各赛道阶段下的事件计算） |
| status | OPEN / UPCOMING / ENDED / UNKNOWN（由全部时间节点推算，列表与详情同口径） |

### 竞赛详情 V2 结构（CompetitionDetail）

| 字段 | 说明 |
| --- | --- |
| tracks[] | 赛道列表，每条含 `stages[]`（各挂 `events[]`）；`format`/`teamSizeMin/Max` 赛道级留空时回落赛事级 |
| bonusStandard | 本竞赛关联的加分标准（其类别的国家级档） |
| bonusStandards | 同认定文件 + 类别下的两档标准（国家级 + 省级），详情页加分表按此渲染 |
| sharedStages[] | 全赛事共享阶段（trackId = null） |
| editions | 同 code 的其他届次（`/years` 提供已收录年份） |
| recruitingTeams | 本竞赛招募帖列表（含 memberCount / intentCount，游客不可见） |

### 招募帖（TeamListItem / TeamSummary）

| 字段 | 说明 |
| --- | --- |
| expired | 是否已过 deadline（由 deadline 推算） |
| commentCount | 帖子评论数（计数） |
| memberCount | 已有成员数量 = 1 + TeamMember 行数（队长本人是第 1 人，B1 口径） |
| intentCount | 登记组队意愿的人数 |
| contactUnlocked | 详情页：当前查看者是否已解锁联系方式（队长 / 管理员 / 已登记意愿者） |
