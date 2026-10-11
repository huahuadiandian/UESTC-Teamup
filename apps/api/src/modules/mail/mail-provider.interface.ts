/**
 * MailProvider 抽象（MODULE_AUTH §4 —— 本模块最重要的设计决策）
 * 业务代码不允许出现任何 QQ 相关硬编码；切换服务商只改 MAIL_PROVIDER 配置。
 */
export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** 业务类型，写入 MailLog（如 LOGIN_CODE / RESET_CODE） */
  kind: string;
}

export interface MailProvider {
  readonly name: string;
  send(msg: MailMessage): Promise<void>;
  /** 连接自检（可选）：启动时提前发现 SMTP 配置错误，失败不阻断启动 */
  verify?(): Promise<void>;
  /** 剩余额度，用于降级判断；不确定时返回 null */
  quotaLeft?(): Promise<number | null>;
}
