import { Injectable, Logger } from '@nestjs/common';
import { MailMessage, MailProvider } from './mail-provider.interface';

/**
 * 当前阶段的兜底实现：不真正发信，验证码/内容打印到控制台。
 *
 * 【仅限本地开发】验证码只能从服务端日志获取（验证码登录同时是「首次即注册」通道）：
 *   - 能读取日志的人可为任意邮箱取码登录 → 绝不允许用于生产；
 *   - 生产环境由 MailService 直接拒绝以本 provider 启动（安全收敛 A2），
 *     生产必须配置 MAIL_PROVIDER=qq 及 SMTP 凭据。
 */
@Injectable()
export class ConsoleDevProvider implements MailProvider {
  readonly name = 'console-dev';
  private readonly logger = new Logger('Mail');

  async send(msg: MailMessage): Promise<void> {
    this.logger.log(`[console-dev·仅限开发] to=${msg.to} kind=${msg.kind} subject=${msg.subject}`);
    this.logger.log(`----------------------------------------`);
    this.logger.log(msg.text ?? msg.html.replace(/<[^>]+>/g, ' '));
    this.logger.log(`----------------------------------------`);
  }
}
