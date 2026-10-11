# 关键模块：认证与邮件

> 相关：[README.md](./README.md)（项目速览）、[DATA_MODEL.md](./DATA_MODEL.md) §3、[OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md)

> **实现状态（2026-10-11）**：本模块已全量落地。真实发信由 `QqSmtpProvider`（nodemailer + `smtp.qq.com:465` SSL）承担，
> 每次发送写 `MailLog`，发码恢复配额矩阵（§6）。**唯一待办是 P0 真实送达率实测**：向 5–10 位不同学院同学发验证码，确认收件 / 垃圾箱 / 延迟，
> 结果不通过则走 §8 兜底方案（MailProvider 抽象使切换成本极低）。

---

## 1. 为什么这个模块风险最高

**登录是全站的单点依赖。** 邮件发不出去 → 没人能注册 → 产品等于不存在。

而本项目选了**个人 QQ 邮箱 SMTP**，它有三个硬限制：每日发信限额、批量相同内容易判垃圾邮件、收件方网关可能拦截。

> 🚨 **P0 第一件事**：向 5–10 位不同学院同学真实发送验证码，确认是否收到、是否进垃圾箱、延迟多久。
> **这个结果决定登录方案是否成立。** 不要写完全部代码才发现邮件发不出去。

---

## 2. 登录流程

```
① 用户输入 2024080909015@std.uestc.edu.cn
        ↓
② 校验：正则 + 后缀白名单（仅 @std.uestc.edu.cn）
   ├─ 正则：/^\d{13}@std\.uestc\.edu\.cn$/    ⚠️ 学号位数待确认
   └─ 拒绝：邮箱格式错误 / 非本校邮箱
        ↓
③ 限流检查（Redis，已实现）
   ├─ 同邮箱 60s 内只能发 1 次（冷却期内静默返回，不重发不覆写）
   ├─ 同邮箱 每天 ≤ 5 次
   ├─ 同 IP   每天 ≤ 20 次
   ├─ 全局     每分钟 ≤ 10 封 · 每天 ≤ 200 封   ← 保护 QQ 邮箱额度
   └─ 先占配额后校验，发信失败/超限全部回滚（避免把用户锁死在失败态）
        ↓
④ 生成 6 位验证码，存 Redis：SET verify:code:{email} {code} EX 300
   （同时存发送时间戳用于 60s 判断）
        ↓
⑤ 同步投递 SMTP（⭐ 带 10–20s 超时；小站无队列基建，同步发信才能向用户如实报错，
   失败时立即清码并回滚配额）
        ↓
⑥ 用户输入验证码
   ├─ 比对 Redis
   ├─ 失败计数：连错 5 次 → 作废该验证码，要求重新发送
   └─ 成功 → 删除 Redis key
        ↓
⑦ 查 User 表
   ├─ 存在 → 建 Session
   └─ 不存在 → 自动建档（登录即注册）
              ├─ 从学号解析年级/学院
              └─ 跳转资料补全页
        ↓
⑧ 写 Session 到 Redis，下发 HttpOnly Cookie
```

### 学号解析

`2024080909015` → 前 4 位 `2024` 是年级，**中间位的学院编码规则待确认**（[OPEN_QUESTIONS Q10](./OPEN_QUESTIONS.md)）。

**解析失败不能阻塞注册** —— 学院/年级允许为空，登录后引导用户手工补全。**不要因为一个不确定的编码规则把注册流程卡死。**

---

## 3. 会话方案

**Redis Session + HttpOnly Cookie**，不用 JWT。

| 理由 | 说明 |
|---|---|
| 能强制下线 | JWT 签发后无法撤销，封禁用户要等过期。本站有举报/封禁需求，必须有这个能力 |
| 更简单 | 不需要处理刷新令牌、撤销列表 |
| 站点规模小 | 单机 Redis，不需要为水平扩展牺牲可撤销性 |

Cookie 属性：`HttpOnly` + `Secure` + `SameSite=Lax`。

---

## 4. MailProvider 抽象 ⭐

**这是本模块最重要的设计决策。** 业务代码**不允许出现任何 QQ 相关硬编码**。

```ts
export interface MailProvider {
  readonly name: string;
  send(msg: { to: string; subject: string; html: string }): Promise<void>;
  /** 剩余额度，用于降级判断；不确定时返回 null */
  quotaLeft?(): Promise<number | null>;
}

@Injectable()
export class QqSmtpProvider implements MailProvider { ... }

// 预留（先写空实现，切换时只需改配置）
export class AliyunDmProvider implements MailProvider { ... }
export class ResendProvider  implements MailProvider { ... }
```

**为什么必须这样**：QQ 邮箱额度被限是大概率事件。如果 QQ 的调用散落在 20 个 Service 里，换服务商就是一次重构；如果收在一个类里，就是改一行配置。

**降级策略**：主通道连续失败 N 次 → 自动切备用 provider + 告警。

---

## 5. 邮件配置

| 项 | 值 |
|---|---|
| SMTP 服务器 | `smtp.qq.com` |
| 端口 | `465`（SSL）或 `587`（STARTTLS） |
| 凭据 | QQ 邮箱 设置 → 账户 → 开启 SMTP 服务 → 生成 **16 位授权码** |
| 存储 | **环境变量 `.env`，绝不入库、绝不进 git** |

```dotenv
MAIL_PROVIDER=qq
QQ_SMTP_HOST=smtp.qq.com
QQ_SMTP_PORT=465
QQ_SMTP_USER=xxx@qq.com
QQ_SMTP_PASS=xxxxxxxxxxxxxxxx   # 16 位授权码，不是 QQ 密码
```

### 降低被判定为垃圾邮件的做法

1. **正文含随机验证码与时间戳** → 每封邮件内容天然不同，不会命中"重复内容"规则
2. 控制发送速率，不要瞬时爆发
3. 设置正确的 `From` 显示名（如 `UESTC TeamUp <xxx@qq.com>`）
4. 纯 HTML + 纯文本双版本（nodemailer 的 `text` 字段）
5. **避免正文中出现大量短链接**

### 发信日志（已实现）

发送收口在 `MailService`：每次调用（成功 / 失败）都写一条 `MailLog`（收件人、类型 `LOGIN_CODE`/`RESET_CODE`、状态 `SENT`/`FAILED`、失败原因）。
可选项：发件人显示名由 `MAIL_FROM_NAME` 控制（默认 `UESTC TeamUp`）。

**用途**：同学说"我没收到验证码"时，能 10 秒内回答"是没发出去、发了被退、还是投递成功在垃圾箱"。
排查查询：`SELECT * FROM "MailLog" WHERE "to" = '<email>' ORDER BY "sentAt" DESC;`。
当日已发/待发邮件也可用 `verify:quota:global:day:{yyyymmdd}` 计数验证。

---

## 6. 验证码与限流参数

| 项 | 值 | 配置项 |
|---|---|---|
| 验证码位数 | 6 位数字 | |
| 有效期 | 5 分钟 | |
| 重发间隔 | 60 秒 | |
| 同邮箱每日上限 | 5 次 | |
| 同 IP 每日上限 | 20 次 | |
| 全局每分钟上限 | 10 封 | **保护 QQ 邮箱额度，这是最关键的限流** |
| 全局每日上限 | 200 封（默认） | `MAIL_GLOBAL_DAILY_LIMIT`，按 QQ 邮箱实际额度调整 |
| 验证失败次数上限 | 5 次 | 超过作废，防爆破 |
| 密码登录同邮箱连错上限 | 5 次 → 锁定 15 分钟 | Issue 12；锁定只影响密码登录，验证码登录仍可用 |
| 密码登录同 IP 失败上限 | 10 分钟窗口内 30 次 → 拒绝 | Issue 12；阈值宽于单账号，容忍校园 NAT 共享出口 |

> 2026-09-27 产品迭代（Issue 3）曾移除全部限流；2026-10-11 真实 SMTP 上线时**恢复了发码入口的最小配额矩阵**作为替代防护。
> 同日审计（Issue 12）补齐密码登录维度的失败锁定：同邮箱连错 5 次锁 15 分钟、同 IP 10 分钟窗口内失败 30 次拒绝密码登录。
> 日与分钟口径按北京时间计算，与部署容器时区解耦。
>
> **验证码为原子消费**（Issue 12）：校验、删除、失败计数在 Redis Lua 脚本内一次完成，
> 并发请求无法复用同一个验证码（旧的 get → 校验 → del 三步存在并发重放窗口）。

**Redis Key 设计（与实现一致）**

```
verify:code:{email}              → 登录验证码，TTL 300s（Lua 原子消费）
verify:cooldown:{email}          → 登录重发冷却，TTL 60s
verify:fail:{email}              → 登录失败计数，TTL 300s
verify:quota:email:{email}:{yyyymmdd}
verify:quota:ip:{ip}:{yyyymmdd}
verify:quota:global:min:{yyyymmddHHmm}   → 全局每分钟
verify:quota:global:day:{yyyymmdd}       → 全局每日（保护额度）
pwdreset:*                       → 找回密码同名体系，与登录配额互相隔离（全局限额共享）
login:fail:{email}               → 密码登录连错计数，TTL 900s（Issue 12）
login:lock:{email}               → 密码登录锁定标记，TTL 900s
login:ipfail:{ip}:{10min窗口号}   → 同 IP 失败窗口计数，TTL 660s
```

---

## 7. 安全清单

| 风险 | 对策 |
|---|---|
| 验证码爆破 | 6 位 + 5 次失败作废 + 5 分钟过期 |
| 邮箱枚举 | **无论邮箱是否已注册，响应必须一致**（都说"验证码已发送"），且都走同样的耗时 |
| 限流绕过 | IP + 邮箱双维度，两者都要限 |
| Session 劫持 | `HttpOnly` + `Secure` + `SameSite`；上线必须 HTTPS |
| 授权码泄露 | 只走 `.env`，`.gitignore` 必须包含它；**永远不要在日志里打印配置对象** |
| 学生邮箱被滥用 | 只能登录本站，不具备发信能力；不在站内提供任何邮件转发功能 |

---

## 8. 兜底方案（若实测送达率不通过）

1. **第三方邮件服务**：阿里云邮件推送 / Resend 免费额度（3000 封/月）—— 因为做了 `MailProvider` 抽象，切换成本极低
2. **邀请码机制**：老用户每月可发 N 个邀请码，绕过邮件
3. **管理员人工校验**：极端情况下，用户提交学号 + 学生证照片，管理员手工开通

**这三种方案都应在设计时预留，不要等出问题才想。**
