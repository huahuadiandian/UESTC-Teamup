import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { MailMessage, MailProvider } from './mail-provider.interface';

/**
 * QQ 邮箱 SMTP 实现（MODULE_AUTH §5）。
 *
 * - smtp.qq.com:465（SSL；587 走 STARTTLS，由端口自动判定）；
 * - 凭据 = 完整 QQ 邮箱 + 16 位 SMTP 授权码（非 QQ 密码），只走环境变量，绝不入库/进日志；
 * - 懒加载单例 transporter，不开连接池（低流量下开池反而易触发 QQ 并发限制）；
 * - 设置连接/握手/读写超时，避免发信请求悬挂拖垮接口。
 */
@Injectable()
export class QqSmtpProvider implements MailProvider {
  readonly name = 'qq-smtp';
  private readonly logger = new Logger('Mail');
  private transporter: Transporter | null = null;

  /** 配置齐备性检查；缺凭据时给出明确报错（生产环境由 MailService 在启动时拦截） */
  static isConfigured(): boolean {
    return Boolean(process.env.QQ_SMTP_USER && process.env.QQ_SMTP_PASS);
  }

  private getTransporter(): Transporter {
    if (!this.transporter) {
      const user = process.env.QQ_SMTP_USER;
      const pass = process.env.QQ_SMTP_PASS;
      if (!user || !pass) {
        throw new Error('QQ_SMTP_USER / QQ_SMTP_PASS 未配置，无法发送邮件');
      }
      const port = Number(process.env.QQ_SMTP_PORT ?? 465);
      this.transporter = nodemailer.createTransport({
        host: process.env.QQ_SMTP_HOST ?? 'smtp.qq.com',
        port,
        secure: port === 465,
        auth: { user, pass },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
        pool: false,
      });
    }
    return this.transporter;
  }

  /** 连接自检：启动时由 MailService 调用，失败仅告警不阻断启动 */
  async verify(): Promise<void> {
    await this.getTransporter().verify();
  }

  async send(msg: MailMessage): Promise<void> {
    const user = process.env.QQ_SMTP_USER;
    if (!user) throw new Error('QQ_SMTP_USER 未配置');
    const fromName = process.env.MAIL_FROM_NAME ?? 'UESTC TeamUp';
    await this.getTransporter().sendMail({
      from: `"${fromName}" <${user}>`,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
  }
}
