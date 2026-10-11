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
    const ipCount = await this.redis.incrWithTtl(keys.ipQuota, dayTtl);
    const minuteCount = await this.redis.incrWithTtl(keys.globalMinute, 120);
    const dayCount = await this.redis.incrWithTtl(keys.globalDay, dayTtl);

    if (emailCount > DAILY_PER_EMAIL) {
      await this.rollbackSendQuota(keys);
      throw new BadRequestException('该邮箱今日发送次数已达上限');
    }
    if (ipCount > DAILY_PER_IP) {
      await this.rollbackSendQuota(keys);
      throw new BadRequestException('当前网络发送次数已达上限，请明日再试');
    }
    if (minuteCount > GLOBAL_PER_MINUTE) {
      await this.rollbackSendQuota(keys);
      throw new BadRequestException('当前发送人数较多，请稍后再试');
    }
    if (dayCount > globalDailyLimit()) {
      await this.rollbackSendQuota(keys);
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
      await this.rollbackSendQuota(keys);
      this.logger.error(`验证码邮件发送失败: ${email} (${flow}) ${(err as Error)?.message ?? String(err)}`);
      throw new BadRequestException('邮件发送失败，请稍后重试');
    }

    this.logger.log(`验证码已发送至 ${email} (${flow})`);
    return { devCode: process.env.NODE_ENV !== 'production' ? code : undefined };
  }

  /** 发信失败 / 配额拒绝时回滚：释放冷却锁并归还已占用的计数 */
  private async rollbackSendQuota(keys: SendQuotaKeys) {
    await this.redis.del(keys.cooldown);
    await this.redis.decr(keys.emailQuota);
    await this.redis.decr(keys.ipQuota);
    await this.redis.decr(keys.globalMinute);
    await this.redis.decr(keys.globalDay);
  }

  private async consumeCode(email: string, code: string, flow: FlowName) {
    const ns = FLOWS[flow].ns;
    const codeKey = `${ns}:code:${email}`;
    const failKey = `${ns}:fail:${email}`;
    const saved = await this.redis.get(codeKey);
    if (!saved) throw new BadRequestException('验证码已过期，请重新发送');

    if (saved !== code.trim()) {
      const fails = await this.redis.incrWithTtl(failKey, CODE_TTL);
      if (fails >= MAX_FAILS) {
        await this.redis.del(codeKey, failKey);
        throw new BadRequestException('错误次数过多，该验证码已作废，请重新发送');
      }
      throw new BadRequestException(`验证码错误（还剩 ${MAX_FAILS - fails} 次机会）`);
    }
    await this.redis.del(codeKey, failKey);
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

  /** 密码登录。错误信息统一，不区分邮箱/密码（防枚举） */
  async loginWithPassword(email: string, password: string) {
    if (!CAMPUS_EMAIL_RE.test(email)) throw new BadRequestException('请使用成电校园邮箱（@std.uestc.edu.cn）');

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new BadRequestException('邮箱或密码不正确');
    }
    if (user.banned) throw new BadRequestException('该账号已被封禁，如有疑问请联系管理员');

    return { user };
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
      if (!verifyPassword(oldPassword, user.passwordHash)) throw new BadRequestException('当前密码不正确');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hashPassword(newPassword) },
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
      data: { passwordHash: hashPassword(newPassword) },
    });
    // H5：找回密码后吊销该用户全部会话（含可能被攻击者持有的会话）
    await this.sessions.destroyByUserId(user.id);
    return { ok: true };
  }
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
