import { Global, Injectable, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { type MailProvider, type MailMessage } from './mail-provider.interface';
import { ConsoleDevProvider } from './console-dev.provider';
import { QqSmtpProvider } from './qq-smtp.provider';

/**
 * 按 MAIL_PROVIDER 选择实现；未配置时一律走 console-dev，保证登录流程可联调。
 *
 * 每次发送（成功/失败）都会写一条 MailLog（MODULE_AUTH §5），
 * 用于回答「某邮箱为什么没收到验证码」；日志写入失败不影响发信主流程。
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger('Mail');
  private readonly provider: MailProvider;

  constructor(consoleDev: ConsoleDevProvider, qq: QqSmtpProvider, private readonly prisma: PrismaService) {
    const name = process.env.MAIL_PROVIDER ?? 'console';
    if (name === 'qq') {
      /**
       * 2026-09-27 安全收敛（docs/UESTC-TeamUp_main_issues.md A2）：
       * 生产环境必须使用真实 provider；配了 qq 却没给凭据属于部署错误，直接拒绝启动。
       */
      if (process.env.NODE_ENV === 'production' && !QqSmtpProvider.isConfigured()) {
        throw new Error(
          '[mail] MAIL_PROVIDER=qq 但未配置 QQ_SMTP_USER / QQ_SMTP_PASS（16 位 SMTP 授权码），拒绝启动。',
        );
      }
      this.provider = qq;
      return;
    }
    /**
     * 2026-09-27 安全收敛：生产环境拒绝以 console provider 启动 —— console 模式下验证码只写入服务端日志，
     * 「日志读取权限 ≈ 任意账号登录权限」，不能作为生产兜底。
     * 生产部署必须配置 MAIL_PROVIDER=qq（或其他真实 provider）。
     */
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[mail] 生产环境禁止 MAIL_PROVIDER=console：验证码会写入服务端日志（等同登录凭据）。' +
          '请配置真实邮件 provider（如 MAIL_PROVIDER=qq 及对应 SMTP 授权码）后启动。',
      );
    }
    this.provider = consoleDev;
  }

  /** 启动后异步自检 SMTP 连接：失败只告警，不阻断启动（避免服务商抖动导致服务起不来） */
  onModuleInit() {
    if (this.provider.name !== 'qq-smtp' || !QqSmtpProvider.isConfigured()) return;
    void this.provider
      .verify?.()
      .then(() => this.logger.log('[mail] QQ SMTP 连接自检通过'))
      .catch((err: unknown) =>
        this.logger.warn(`[mail] QQ SMTP 连接自检失败（服务照常启动，首次发信可能失败）：${(err as Error)?.message ?? err}`),
      );
  }

  async send(msg: MailMessage) {
    try {
      await this.provider.send(msg);
      await this.writeLog(msg, 'SENT');
    } catch (err) {
      await this.writeLog(msg, 'FAILED', err);
      throw err;
    }
  }

  private async writeLog(msg: MailMessage, status: 'SENT' | 'FAILED', err?: unknown) {
    try {
      await this.prisma.mailLog.create({
        data: {
          to: msg.to,
          kind: msg.kind,
          status,
          error: err ? String((err as Error)?.message ?? err).slice(0, 500) : null,
        },
      });
    } catch (logErr) {
      // 审计日志失败不能影响发信主流程
      this.logger.warn(`[mail] MailLog 写入失败：${(logErr as Error)?.message ?? logErr}`);
    }
  }
}

@Global()
@Module({
  providers: [ConsoleDevProvider, QqSmtpProvider, MailService],
  exports: [MailService],
})
export class MailModule {}
