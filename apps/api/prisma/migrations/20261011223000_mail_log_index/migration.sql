-- MailLog 落库启用（真实 SMTP 实装）：按收件人 + 时间排查「验证码为什么没收到」
CREATE INDEX "MailLog_to_sentAt_idx" ON "MailLog"("to", "sentAt");
