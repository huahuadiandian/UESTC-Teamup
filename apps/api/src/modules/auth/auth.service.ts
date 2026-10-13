import { randomInt } from 'node:crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../common/redis.service';
import { PrismaService } from '../../common/prisma.service';
import { SessionService } from '../../common/auth/session.service';
import { MailService } from '../mail/mail.module';
import { loginCodeMail, resetCodeMail } from '../mail/templates';
import { hashPassword, validatePasswordStrength, verifyPassword } from '../../common/password';

/** 校园邮箱白名单与格式（Q11：放宽为 8–16 位数字，兼容研究生等） */
export const CAMPUS_EMAIL_RE = /^\d{8,16}@std\.uestc\.edu\.cn$/;

const CODE_TTL = 300; // 5 分钟

/**
 * 发码配额（2026-10-11 恢复：真实 SMTP 上线后必须保护 QQ 邮箱日额度，
 * 作为 docs/ISSUES_PRODUCT_FIXES.md Issue 3「去限流」的替代防护；其余限流保持移除）。
 */
const RESEND_COOLDOWN = 60; // 同邮箱重发冷却
const DAILY_PER_EMAIL = 5; // 同邮箱每日上限
const DAILY_PER_IP = 20; // 同 IP 每日上限
const GLOBAL_PER_MINUTE = 10; // 全局每分钟上限（保护邮件额度）
const MAX_FAILS = 5; // 验证码连错作废阈值

/**
 * 「同 IP」维度只对真实客户端 IP 生效。
 *
 * 2026-10-13 线上事故：本机 Docker 经端口发布（userland proxy）转发，真实客户端 IP
 * 在进入 nginx 之前就被替换为网桥网关地址（如 172.19.0.1）；nginx 转发
 * `X-Forwarded-For: $remote_addr` 后，后端 `req.ip` 对所有用户恒为同一个私网地址。
 * 此时 `DAILY_PER_IP` 退化成全站共享桶——当天发满 20 封后所有用户都被拒
 * （表现为「无法发送验证码」，直到北京时间次日 0 点）。
 * 因此当 IP 为私网 / 回环 / 链路本地 / unknown 时跳过该维度，由
 * 「每邮箱 5 次 + 全局每分钟 10 + 全局每天 200」兜底；取到真实公网 IP 时照常生效。
 */
const PRIVATE_IP_RE = /^(?:0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;

function isRealClientIp(ip: string): boolean {
  if (!ip || ip === 'unknown') return false;
  const v = ip.trim().toLowerCase().replace(/^::ffff:/, ''); // 兼容 IPv4-mapped IPv6
  if (v === '::1') return false;
  if (PRIVATE_IP_RE.test(v)) return false; // IPv4 私网段
  if (/^(?:fc|fd|fe80)/.test(v)) return false; // IPv6 ULA / 链路本地
  return true;
}

/**
 * 密码登录失败锁定（Issue 12）：同邮箱连错 LOGIN_EMAIL_MAX_FAILS 次锁定
 * LOGIN_LOCK_SECONDS；同 IP 失败 LOGIN_IP_MAX_FAILS 次 / LOGIN_IP_WINDOW_SECONDS
 * 内拒绝密码登录。验证码登录不受影响（第二因子仍可用，合法用户不会被完全锁死）。
 */
const LOGIN_EMAIL_MAX_FAILS = 5;
const LOGIN_LOCK_SECONDS = 900; // 15 分钟
const LOGIN_IP_WINDOW_SECONDS = 600; // 10 分钟滑动窗口
const LOGIN_IP_MAX_FAILS = 30; // 校园 NAT 出口共享 IP，阈值需宽于单账号

/** 全局每日上限（保护 QQ 邮箱额度，防账号被限）；可用 MAIL_GLOBAL_DAILY_LIMIT 调整 */
function globalDailyLimit(): number {
  const n = Number(process.env.MAIL_GLOBAL_DAILY_LIMIT ?? 200);
  return Number.isFinite(n) && n > 0 ? n : 200;
}

/** 登录 / 找回两条流程的命名空间与邮件模板（配额互相隔离，全局限额共享） */
const FLOWS = {
  login: { ns: 'verify', kind: 'LOGIN_CODE', mail: loginCodeMail },
  reset: { ns: 'pwdreset', kind: 'RESET_CODE', mail: resetCodeMail },
} as const;

type FlowName = keyof typeof FLOWS;

interface SendQuotaKeys {
  cooldown: string;
  emailQuota: string;
  ipQuota: string;
  globalMinute: string;
  globalDay: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * 发送验证码（登录 / 首次注册）。配额矩阵与 Redis Key 见 MODULE_AUTH §2/§6。
   * 无论邮箱是否已注册，响应一致（防邮箱枚举）。
   */
  async sendCode(email: string, ip: string): Promise<{ devCode?: string }> {
    const { devCode } = await this.sendEmailCode(email, ip, 'login');
    return devCode ? { devCode } : {};
  }

  /** 忘记密码：发送找回验证码 */
  async sendResetCode(email: string, ip: string): Promise<{ devCode?: string }> {
    const { devCode } = await this.sendEmailCode(email, ip, 'reset');
    return devCode ? { devCode } : {};
  }

  private async sendEmailCode(email: string, ip: string, flow: FlowName) {
    if (!CAMPUS_EMAIL_RE.test(email)) throw new BadRequestException('请使用成电校园邮箱（@std.uestc.edu.cn）');

    const cfg = FLOWS[flow];
    const day = dayStamp();
    // IP 维度仅在能取到真实客户端 IP 时参与限流（见 isRealClientIp 注释）
    const ipLimitOn = isRealClientIp(ip);
    const keys: SendQuotaKeys & { code: string; fail: string } = {
      code: `${cfg.ns}:code:${email}`,
      fail: `${cfg.ns}:fail:${email}`,
      cooldown: `${cfg.ns}:cooldown:${email}`,
      emailQuota: `${cfg.ns}:quota:email:${email}:${day}`,
      ipQuota: `${cfg.ns}:quota:ip:${ip}:${day}`,
      // 全局限额登录 + 找回共享：目的是保护邮箱额度，而不是区分业务
      globalMinute: `verify:quota:global:min:${minuteStamp()}`,
      globalDay: `verify:quota:global:day:${day}`,
    };
    const dayTtl = Math.max(secondsUntilDayEnd(), 60);

    // 60s 重发冷却：冷却期内静默返回与成功完全一致的形状（不重发、不覆写已有验证码），
    // 避免攻击者替受害者反复发码，使其始终拿不到自己触发的新码（H6）。
    if (!(await this.redis.lock(keys.cooldown, RESEND_COOLDOWN))) return {};

    // 先占用配额再校验；任一超限即回滚全部计数与冷却锁（S4c：失败不能把用户锁死在失败态）
    const emailCount = await this.redis.incrWithTtl(keys.emailQuota, dayTtl);
    const ipCount = ipLimitOn ? await this.redis.incrWithTtl(keys.ipQuota, dayTtl) : 0;
    const minuteCount = await this.redis.incrWithTtl(keys.globalMinute, 120);
    const dayCount = await this.redis.incrWithTtl(keys.globalDay, dayTtl);

    if (emailCount > DAILY_PER_EMAIL) {
      await this.rollbackSendQuota(keys, ipLimitOn);
      throw new BadRequestException('该邮箱今日发送次数已达上限');
    }
    if (ipLimitOn && ipCount > DAILY_PER_IP) {
      await this.rollbackSendQuota(keys, ipLimitOn);
      throw new BadRequestException('当前网络发送次数已达上限，请明日再试');
    }
    if (minuteCount > GLOBAL_PER_MINUTE) {
      await this.rollbackSendQuota(keys, ipLimitOn);
      throw new BadRequestException('当前发送人数较多，请稍后再试');
    }
    if (dayCount > globalDailyLimit()) {
      await this.rollbackSendQuota(keys, ipLimitOn);
      throw new BadRequestException('今日邮件发送额度已用完，请明日再试');
    }

    const code = String(randomInt(100000, 1000000));
    await this.redis.set(keys.code, code, CODE_TTL);
    await this.redis.del(keys.fail);

    try {
      await this.mail.send({ to: email, ...cfg.mail(code), kind: cfg.kind });
    } catch (err) {
      // 发信失败必须回滚：清验证码 + 释放冷却与配额，避免「看似已发送实则不可用」
      await this.redis.del(keys.code);
      await this.rollbackSendQuota(keys, ipLimitOn);
      this.logger.error(`验证码邮件发送失败: ${email} (${flow}) ${(err as Error)?.message ?? String(err)}`);
      throw new BadRequestException('邮件发送失败，请稍后重试');
    }

    this.logger.log(`验证码已发送至 ${email} (${flow})`);
    return { devCode: process.env.NODE_ENV !== 'production' ? code : undefined };
  }

  /** 发信失败 / 配额拒绝时回滚：释放冷却锁并归还已占用的计数（ipLimitOn=false 时未占用 IP 计数） */
  private async rollbackSendQuota(keys: SendQuotaKeys, ipLimitOn: boolean) {
    await this.redis.del(keys.cooldown);
    await this.redis.decr(keys.emailQuota);
    if (ipLimitOn) await this.redis.decr(keys.ipQuota);
    await this.redis.decr(keys.globalMinute);
    await this.redis.decr(keys.globalDay);
  }

  private async consumeCode(email: string, code: string, flow: FlowName) {
    const ns = FLOWS[flow].ns;
    const codeKey = `${ns}:code:${email}`;
    const failKey = `${ns}:fail:${email}`;
    // 原子消费（Issue 12）：比对、删除、失败计数在 Redis 端一次完成，
    // 并发请求不可能用同一个验证码通过两次校验
    const result = await this.redis.consumeCodeWithFailLimit(codeKey, failKey, code.trim(), CODE_TTL, MAX_FAILS);
    if (result === 'EXPIRED') throw new BadRequestException('验证码已过期，请重新发送');
    if (result === 'OK') return;
    if (result === 'VOID') throw new BadRequestException('错误次数过多，该验证码已作废，请重新发送');
    const fails = Number(result.slice('WRONG:'.length)) || 1;
    throw new BadRequestException(`验证码错误（还剩 ${MAX_FAILS - fails} 次机会）`);
  }

  /**
   * 验证码登录（登录即注册）。返回 isNew 与 hasPassword 供前端引导。
   */
  async loginWithCode(email: string, code: string) {
    if (!CAMPUS_EMAIL_RE.test(email)) throw new BadRequestException('请使用成电校园邮箱（@std.uestc.edu.cn）');

    await this.consumeCode(email, code, 'login');

    const studentNo = email.split('@')[0];
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.banned) throw new BadRequestException('该账号已被封禁，如有疑问请联系管理员');
      return { user: existing, isNew: false };
    }

    const parsed = parseStudentNo(studentNo);
    const user = await this.prisma.user.create({
      data: {
        email,
        studentNo,
        grade: parsed.grade,
        college: parsed.college,
        nickname: null,
      },
    });
    return { user, isNew: true };
  }

  /**
   * 密码登录（Issue 12）：邮箱维度连错锁定 + IP 维度失败窗口限流。
   * 错误信息统一，不区分邮箱/密码（防枚举）；账号不存在时也执行一次等价
   * scrypt 计算，避免响应时长差异暴露邮箱是否已注册。
   */
  async loginWithPassword(email: string, password: string, ip = 'unknown') {
    if (!CAMPUS_EMAIL_RE.test(email)) throw new BadRequestException('请使用成电校园邮箱（@std.uestc.edu.cn）');

    const emailFailKey = `login:fail:${email}`;
    const emailLockKey = `login:lock:${email}`;
    const ipWindow = Math.floor(Date.now() / (LOGIN_IP_WINDOW_SECONDS * 1000));
    const ipFailKey = `login:ipfail:${ip}:${ipWindow}`;

    if (await this.redis.get(emailLockKey)) {
      throw new BadRequestException('登录失败次数过多，请 15 分钟后再试或使用邮箱验证码登录');
    }
    if (Number(await this.redis.get(ipFailKey)) >= LOGIN_IP_MAX_FAILS) {
      throw new BadRequestException('当前网络登录失败次数过多，请稍后再试');
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok = user
      ? await verifyPassword(password, user.passwordHash)
      : // 等时序：对不存在的邮箱执行同样强度的哈希计算
        await verifyPassword(password, await dummyHash());

    if (!ok) {
      await this.recordLoginFailure(emailFailKey, emailLockKey, ipFailKey);
      throw new BadRequestException('邮箱或密码不正确');
    }
    if (user!.banned) throw new BadRequestException('该账号已被封禁，如有疑问请联系管理员');

    // 登录成功清空该邮箱的失败计数
    await this.redis.del(emailFailKey);
    return { user: user! };
  }

  /** 记录一次密码登录失败：邮箱连错达阈值上锁，IP 窗口计数 */
  private async recordLoginFailure(emailFailKey: string, emailLockKey: string, ipFailKey: string) {
    const fails = await this.redis.incrWithTtl(emailFailKey, LOGIN_LOCK_SECONDS);
    if (fails >= LOGIN_EMAIL_MAX_FAILS) {
      await this.redis.set(emailLockKey, '1', LOGIN_LOCK_SECONDS);
      await this.redis.del(emailFailKey);
    }
    await this.redis.incrWithTtl(ipFailKey, LOGIN_IP_WINDOW_SECONDS + 60);
  }

  /**
   * 设置/修改密码（需登录）。
   * 已有密码时必须提供正确的旧密码；首次设置直接生效。
   */
  async setPassword(userId: string, newPassword: string, oldPassword?: string) {
    const strengthError = validatePasswordStrength(newPassword);
    if (strengthError) throw new BadRequestException(strengthError);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('用户不存在');

    if (user.passwordHash) {
      if (!oldPassword) throw new BadRequestException('请输入当前密码');
      if (!(await verifyPassword(oldPassword, user.passwordHash))) throw new BadRequestException('当前密码不正确');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(newPassword) },
    });
    // H5：改密后吊销该用户全部会话，旧密码泄露的会话立即失效
    await this.sessions.destroyByUserId(userId);
    return { hasPassword: true };
  }

  /** 忘记密码：校验找回验证码并重置 */
  async resetPassword(email: string, code: string, newPassword: string) {
    if (!CAMPUS_EMAIL_RE.test(email)) throw new BadRequestException('请使用成电校园邮箱（@std.uestc.edu.cn）');
    const strengthError = validatePasswordStrength(newPassword);
    if (strengthError) throw new BadRequestException(strengthError);

    await this.consumeCode(email, code, 'reset');

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new BadRequestException('验证码错误或已过期');

    await this.prisma.user.update({
      where: { email },
      data: { passwordHash: await hashPassword(newPassword) },
    });
    // H5：找回密码后吊销该用户全部会话（含可能被攻击者持有的会话）
    await this.sessions.destroyByUserId(user.id);
    return { ok: true };
  }
}

/** 防枚举用的哑哈希：首次使用时生成一次并缓存，强度与真实哈希一致 */
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('dummy-password-for-timing-equalization');
  return dummyHashPromise;
}
/**
 * 学号解析（Q10：学院编码规则未确认，解析失败不阻塞注册）
 * 2024080909015 → 前 4 位为年级；学院留空待人工补全
 */
export function parseStudentNo(studentNo: string): { grade: number | null; college: string | null } {
  let grade: number | null = null;
  if (studentNo.length >= 4) {
    const y = Number(studentNo.slice(0, 4));
    if (y >= 2015 && y <= 2035) grade = y;
  }
  return { grade, college: null };
}

// ================= 北京时间工具（配额 key 的日/分钟口径，与部署容器时区解耦） =================

const CN_OFFSET_MS = 8 * 60 * 60 * 1000;

function cnDate(): Date {
  return new Date(Date.now() + CN_OFFSET_MS);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 北京时间日期戳 yyyymmdd */
export function dayStamp(): string {
  const d = cnDate();
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

/** 北京时间分钟戳 yyyymmddHHmm */
export function minuteStamp(): string {
  const d = cnDate();
  return `${dayStamp()}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

/** 距离北京时间当天 24 点剩余秒数（每日配额 key 的 TTL） */
function secondsUntilDayEnd(): number {
  const d = cnDate();
  return 86400 - (d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds());
}
