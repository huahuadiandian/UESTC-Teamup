/**
 * MailService 测试：provider 选择、MailLog 落库、生产环境安全守卫。
 * 运行：pnpm -F @teamup/api test （需要本地 PostgreSQL）
 */
process.env.NODE_ENV = 'test';

import assert from 'node:assert/strict';
import test from 'node:test';
import { MailService } from '../src/modules/mail/mail.module';
import type { MailProvider } from '../src/modules/mail/mail-provider.interface';
import { closePrisma, getPrisma, migrateTestDatabase, resetDb } from './helpers.js';

migrateTestDatabase();

const okProvider: MailProvider = { name: 'console-dev', send: async () => {} };
const badProvider: MailProvider = {
  name: 'qq-smtp',
  send: async () => {
    throw new Error('SMTP 502 bad gateway');
  },
};

const msg = { to: 'mailtest@std.uestc.edu.cn', subject: '测试验证码', html: '<p>123456</p>', text: '123456', kind: 'LOGIN_CODE' };

test('setup', async () => {
  await resetDb(getPrisma());
});

test('MailService：发送成功写 MailLog（SENT）', async () => {
  process.env.MAIL_PROVIDER = 'console';
  const prisma = getPrisma();
  const svc = new MailService(okProvider as never, badProvider as never, prisma);

  await svc.send(msg);

  const row = await prisma.mailLog.findFirst({ where: { to: msg.to }, orderBy: { sentAt: 'desc' } });
  assert.ok(row);
  assert.equal(row.status, 'SENT');
  assert.equal(row.kind, 'LOGIN_CODE');
  assert.equal(row.error, null);
});

test('MailService：发送失败写 MailLog（FAILED + 原因）并向上抛出', async () => {
  process.env.MAIL_PROVIDER = 'qq';
  const prisma = getPrisma();
  const svc = new MailService(okProvider as never, badProvider as never, prisma);

  await assert.rejects(svc.send({ ...msg, kind: 'RESET_CODE' }), /SMTP 502/);

  const row = await prisma.mailLog.findFirst({ where: { to: msg.to, kind: 'RESET_CODE' }, orderBy: { sentAt: 'desc' } });
  assert.ok(row);
  assert.equal(row.status, 'FAILED');
  assert.match(row.error ?? '', /SMTP 502/);
});

test('MailService：生产环境禁止 console provider 启动', () => {
  const oldEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    process.env.MAIL_PROVIDER = 'console';
    assert.throws(() => new MailService(okProvider as never, badProvider as never, getPrisma()), /生产环境禁止/);
  } finally {
    process.env.NODE_ENV = oldEnv ?? 'test';
  }
});

test('MailService：生产环境 MAIL_PROVIDER=qq 缺凭据拒绝启动', () => {
  const oldEnv = process.env.NODE_ENV;
  const oldUser = process.env.QQ_SMTP_USER;
  const oldPass = process.env.QQ_SMTP_PASS;
  try {
    process.env.NODE_ENV = 'production';
    process.env.MAIL_PROVIDER = 'qq';
    delete process.env.QQ_SMTP_USER;
    delete process.env.QQ_SMTP_PASS;
    assert.throws(() => new MailService(okProvider as never, badProvider as never, getPrisma()), /未配置 QQ_SMTP_USER/);
  } finally {
    process.env.NODE_ENV = oldEnv ?? 'test';
    if (oldUser === undefined) delete process.env.QQ_SMTP_USER;
    else process.env.QQ_SMTP_USER = oldUser;
    if (oldPass === undefined) delete process.env.QQ_SMTP_PASS;
    else process.env.QQ_SMTP_PASS = oldPass;
  }
});

test('teardown', async () => {
  await closePrisma();
});
