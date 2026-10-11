/**
 * 验证码邮件模板：纯文本 + 简单 HTML 卡片（无外链图片/短链）。
 *
 * 防垃圾邮件要点（MODULE_AUTH §5）：
 * - 正文含随机验证码与发送时间戳 → 每封内容天然不同，不命中「重复内容」规则；
 * - 不出现大量短链接，不引入外部资源（图片被拦截反而降低送达）。
 */

const CN_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 北京时间字符串（容器时区可能是 UTC，这里固定 +08:00 偏移） */
function beijingTime(): string {
  const d = new Date(Date.now() + CN_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}（北京时间）`;
}

interface TemplateOptions {
  subject: string;
  purpose: string;
  warning: string;
}

function render({ subject, purpose, warning }: TemplateOptions, code: string) {
  const sentAt = beijingTime();
  const html = `<div style="max-width:480px;margin:0 auto;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;color:#1f2329;">
  <div style="border:1px solid #e5e6eb;border-radius:12px;padding:28px 32px;">
    <p style="margin:0 0 20px;font-size:16px;font-weight:600;">UESTC TeamUp</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">你正在${purpose}，验证码是：</p>
    <p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:6px;color:#2563eb;">${code}</p>
    <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#4e5969;">验证码 5 分钟内有效，请勿转发给他人。</p>
    <p style="margin:0;font-size:13px;line-height:1.6;color:#86909c;">${warning}</p>
    <hr style="border:none;border-top:1px solid #f2f3f5;margin:20px 0;">
    <p style="margin:0;font-size:12px;line-height:1.8;color:#86909c;">发送时间：${sentAt}<br>本邮件由系统自动发送，请勿回复。</p>
  </div>
</div>`;
  const text = `【UESTC TeamUp】${subject.replace('【UESTC TeamUp】', '')}

你正在${purpose}，验证码是：${code}

验证码 5 分钟内有效，请勿转发给他人。
${warning}

发送时间：${sentAt}
本邮件由系统自动发送，请勿回复。`;
  return { subject, html, text };
}

/** 登录（首次即注册）验证码邮件 */
export function loginCodeMail(code: string) {
  return render(
    {
      subject: '【UESTC TeamUp】登录验证码',
      purpose: '登录 UESTC TeamUp',
      warning: '若非本人操作，请忽略本邮件。',
    },
    code,
  );
}

/** 找回密码验证码邮件 */
export function resetCodeMail(code: string) {
  return render(
    {
      subject: '【UESTC TeamUp】密码找回验证码',
      purpose: '重置 UESTC TeamUp 的登录密码',
      warning: '若非本人操作，请忽略本邮件，你的密码不会发生变化。',
    },
    code,
  );
}
