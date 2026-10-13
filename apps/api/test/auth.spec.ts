/**
 * 认证服务层测试：发码配额、冷却、失败回滚、验证码爆破防护、登录即注册。
 * 运行：pnpm -F @teamup/api test （需要本地 PostgreSQL；Redis 用内存夹具）
 */
process.env.NODE_ENV = 'test';

import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthService, dayStamp, minuteStamp } from '../src/modules/auth/auth.service';
import type { MailService } from '../src/modules/mail/mail.module';
import type { MailMessage } from '../src/modules/mail/mail-provider.interface';
import type { RedisService } from '../src/common/redis.service';
import type { SessionService } from '../src/common/auth/session.service';
import { hashPassword } from '../src/common/password';
import { FakeRedisService, closePrisma, getPrisma, migrateTestDatabase, resetDb } from './helpers.js';

migrateTestDatabase();

const IP = '10.0.0.1';

class FakeMail {
  sent: MailMessage[] = [];
  failNext = false;

  async send(msg: MailMessage) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('SMTP 连接失败');
    }
    this.sent.push(msg);
  }
}

function makeAuth(mail: FakeMail, redis: FakeRedisService, sessions?: Partial<SessionService>) {
  const stub = { destroyByUserId: async () => {} } as unknown as SessionService;
  return new AuthService(
    getPrisma(),
    redis as unknown as RedisService,
    mail as unknown as MailService,
    { ...stub, ...sessions } as SessionService,
  );
}

const studentNo = (n: number) => `2024000${String(n).padStart(4, '0')}`;
const campusEmail = (n: number) => `${studentNo(n)}@std.uestc.edu.cn`;

test('setup', async () => {
  await resetDb(getPrisma());
});

test('sendCode：成功发码（Redis + 邮件 + dev 回显）', async () => {
  const redis = new FakeRedisService();
  const mail = new FakeMail();
  const auth = makeAuth(mail, redis);
  const email = campusEmail(1);

  const res = await auth.sendCode(email, IP);

  assert.match(res.devCode ?? '', /^\d{6}$/);
  assert.equal(await redis.get(`verify:code:${email}`), res.devCode, '验证码应写入 Redis');
  assert.equal(mail.sent.length, 1);
  assert.equal(mail.sent[0].to, email);
  assert.equal(mail.sent[0].kind, 'LOGIN_CODE');
  assert.ok(mail.sent[0].html.includes(res.devCode!), 'HTML 正文应含验证码');
  assert.ok(mail.sent[0].text!.includes(res.devCode!), '纯文本正文应含验证码');
});

test('sendCode：非校园邮箱拒绝发码', async () => {
  const mail = new FakeMail();
  const auth = makeAuth(mail, new FakeRedisService());
  await assert.rejects(auth.sendCode('someone@example.com', IP), /成电校园邮箱/);
  assert.equal(mail.sent.length, 0);
});

test('sendCode：60s 冷却期内静默返回且不重发、不覆写验证码', async () => {
  const redis = new FakeRedisService();
  const mail = new FakeMail();
  const auth = makeAuth(mail, redis);
  const email = campusEmail(2);

  const first = await auth.sendCode(email, IP);
  const second = await auth.sendCode(email, IP);

  assert.deepEqual(second, {}, '冷却期响应形状与成功一致（防枚举）');
  assert.equal(mail.sent.length, 1, '冷却期内不得重发');
  assert.equal(await redis.get(`verify:code:${email}`), first.devCode, '原验证码不得被覆写');
});

test('sendCode：发信失败清验证码并回滚冷却/配额，可立即重试', async () => {
  const redis = new FakeRedisService();
  const mail = new FakeMail();
  const auth = makeAuth(mail, redis);
  const email = campusEmail(3);

  mail.failNext = true;
  await assert.rejects(auth.sendCode(email, IP), /邮件发送失败/);
  assert.equal(await redis.get(`verify:code:${email}`), null, '失败后不得残留验证码');
  assert.equal(await redis.get(`verify:cooldown:${email}`), null, '失败后冷却锁应回滚');
  assert.equal(await redis.get(`verify:quota:email:${email}:${dayStamp()}`), '0', '邮箱配额应回滚');

  const retry = await auth.sendCode(email, IP);
  assert.match(retry.devCode ?? '', /^\d{6}$/, '回滚后可立即重试成功');
});

test('sendCode：同邮箱每日 5 次上限，拒绝时回滚冷却与配额', async () => {
  const redis = new FakeRedisService();
  const mail = new FakeMail();
  const auth = makeAuth(mail, redis);
  const email = campusEmail(4);

  for (let i = 0; i < 5; i += 1) {
    await auth.sendCode(email, IP);
    await redis.del(`verify:cooldown:${email}`); // 模拟冷却到期
  }

  await assert.rejects(auth.sendCode(email, IP), /该邮箱今日发送次数已达上限/);
  assert.equal(await redis.get(`verify:quota:email:${email}:${dayStamp()}`), '5', '超限拒绝应回滚计数');
  assert.equal(await redis.get(`verify:cooldown:${email}`), null, '超限拒绝应释放冷却锁');
});

test('sendCode：同 IP 每日上限（真实公网 IP 才生效）', async () => {
  const redis = new FakeRedisService();
  const mail = new FakeMail();
  const auth = makeAuth(mail, redis);

  await redis.set(`verify:quota:ip:203.0.113.9:${dayStamp()}`, '20', 3600);
  await assert.rejects(auth.sendCode(campusEmail(5), '203.0.113.9'), /当前网络发送次数已达上限/);
});

test('sendCode：代理/私网 IP（如 Docker 网关）不参与 IP 维度限流（2026-10-13 事故回归）', async () => {
  const redis = new FakeRedisService();
  const mail = new FakeMail();
  const auth = makeAuth(mail, redis);
  const proxyIp = '172.19.0.1'; // 端口发布后 req.ip 恒为该网关地址，被全站用户共享

  // 该私网桶即使已顶格，也不得阻断发码——否则「每 IP 20 次」退化成全站共享桶
  await redis.set(`verify:quota:ip:${proxyIp}:${dayStamp()}`, '9999', 3600);
  const res = await auth.sendCode(campusEmail(10), proxyIp);

  assert.match(res.devCode ?? '', /^\d{6}$/);
  assert.equal(mail.sent.length, 1);
});

test('sendCode：全局每分钟上限（保护邮件额度）', async () => {
  const redis = new FakeRedisService();
  const mail = new FakeMail();
  const auth = makeAuth(mail, redis);

  await redis.set(`verify:quota:global:min:${minuteStamp()}`, '10', 120);
  await assert.rejects(auth.sendCode(campusEmail(6), IP), /当前发送人数较多/);
});

test('sendCode：全局每日上限可用 MAIL_GLOBAL_DAILY_LIMIT 调整', async () => {
  const redis = new FakeRedisService();
  const mail = new FakeMail();
  const auth = makeAuth(mail, redis);
  const old = process.env.MAIL_GLOBAL_DAILY_LIMIT;

  try {
    process.env.MAIL_GLOBAL_DAILY_LIMIT = '2';
    for (const n of [7, 8]) {
      const email = campusEmail(n);
      await auth.sendCode(email, IP);
      await redis.del(`verify:cooldown:${email}`);
    }
    await assert.rejects(auth.sendCode(campusEmail(9), IP), /今日邮件发送额度已用完/);
  } finally {
    if (old === undefined) delete process.env.MAIL_GLOBAL_DAILY_LIMIT;
    else process.env.MAIL_GLOBAL_DAILY_LIMIT = old;
  }
});

test('loginWithCode：错误计数、连错 5 次作废、作废后需重发', async () => {
  const redis = new FakeRedisService();
  const mail = new FakeMail();
  const auth = makeAuth(mail, redis);
  const email = campusEmail(10);

  const { devCode } = await auth.sendCode(email, IP);
  const wrong = String((Number(devCode) + 1) % 1_000_000).padStart(6, '0');

  for (let i = 1; i <= 4; i += 1) {
    await assert.rejects(auth.loginWithCode(email, wrong), new RegExp(`还剩 ${5 - i} 次机会`));
  }
  await assert.rejects(auth.loginWithCode(email, wrong), /已作废/);
  await assert.rejects(auth.loginWithCode(email, devCode!), /验证码已过期/, '作废后即使输对也无效');
});

test('loginWithCode：首次登录自动注册，再次登录复用账号', async () => {
  const redis = new FakeRedisService();
  const mail = new FakeMail();
  const auth = makeAuth(mail, redis);
  const email = campusEmail(11);

  const first = await auth.sendCode(email, IP);
  const login1 = await auth.loginWithCode(email, first.devCode!);
  assert.equal(login1.isNew, true);
  assert.equal(login1.user.studentNo, studentNo(11));
  assert.equal(login1.user.grade, 2024, '学号前 4 位解析年级');

  await redis.del(`verify:cooldown:${email}`);
  const second = await auth.sendCode(email, IP);
  const login2 = await auth.loginWithCode(email, second.devCode!);
  assert.equal(login2.isNew, false);
  assert.equal(login2.user.id, login1.user.id);
});

test('登录码与找回码互相隔离', async () => {
  const redis = new FakeRedisService();
  const mail = new FakeMail();
  const auth = makeAuth(mail, redis);
  const email = campusEmail(12);

  const { devCode } = await auth.sendResetCode(email, IP);
  assert.equal(mail.sent.at(-1)!.kind, 'RESET_CODE', '找回邮件 kind 应为 RESET_CODE');
  await assert.rejects(auth.loginWithCode(email, devCode!), /验证码已过期/, '找回码不能用于登录');
});

test('resetPassword：找回验证码重置密码并吊销该用户全部会话', async () => {
  const prisma = getPrisma();
  const redis = new FakeRedisService();
  const mail = new FakeMail();
  const destroyed: string[] = [];
  const auth = makeAuth(mail, redis, {
    destroyByUserId: async (userId: string) => {
      destroyed.push(userId);
    },
  } as Partial<SessionService>);
  const email = campusEmail(13);
  const user = await prisma.user.create({
    data: { email, studentNo: studentNo(13), passwordHash: await hashPassword('OldPass123') },
  });

  const { devCode } = await auth.sendResetCode(email, IP);
  await auth.resetPassword(email, devCode!, 'NewPass456');

  assert.deepEqual(destroyed, [user.id], '重置后应吊销全部会话');
  const login = await auth.loginWithPassword(email, 'NewPass456');
  assert.equal(login.user.id, user.id, '新密码应可登录');
  await assert.rejects(auth.loginWithPassword(email, 'OldPass123'), /邮箱或密码不正确/);
});

test('loginWithPassword：邮箱连错 5 次锁定 15 分钟，验证码登录不受影响（Issue 12）', async () => {
  const prisma = getPrisma();
  const redis = new FakeRedisService();
  const mail = new FakeMail();
  const auth = makeAuth(mail, redis);
  const email = campusEmail(14);
  await prisma.user.create({
    data: { email, studentNo: studentNo(14), passwordHash: await hashPassword('RightPass123') },
  });

  for (let i = 0; i < 5; i += 1) {
    await assert.rejects(auth.loginWithPassword(email, 'WrongPass123', IP), /邮箱或密码不正确/);
  }
  // 第 6 次即使密码正确也被锁定
  await assert.rejects(auth.loginWithPassword(email, 'RightPass123', IP), /登录失败次数过多/);

  // 锁定只影响密码登录：邮箱验证码作为第二因子仍然可用
  const { devCode } = await auth.sendCode(email, IP);
  const login = await auth.loginWithCode(email, devCode!);
  assert.equal(login.user.email, email);
});

test('loginWithPassword：成功登录清空失败计数（不累积误伤）', async () => {
  const prisma = getPrisma();
  const auth = makeAuth(new FakeMail(), new FakeRedisService());
  const email = campusEmail(15);
  await prisma.user.create({
    data: { email, studentNo: studentNo(15), passwordHash: await hashPassword('RightPass123') },
  });

  for (let round = 0; round < 3; round += 1) {
    for (let i = 0; i < 4; i += 1) {
      await assert.rejects(auth.loginWithPassword(email, 'WrongPass123', IP), /邮箱或密码不正确/);
    }
    const ok = await auth.loginWithPassword(email, 'RightPass123', IP);
    assert.equal(ok.user.email, email);
  }
});

test('loginWithPassword：同 IP 失败窗口达 30 次后拒绝密码登录（Issue 12）', async () => {
  const prisma = getPrisma();
  const auth = makeAuth(new FakeMail(), new FakeRedisService());
  // 6 个邮箱 × 5 次 = 30 次失败（单邮箱 5 次即锁，避免与邮箱锁定语义混淆）
  for (let i = 0; i < 6; i += 1) {
    const email = campusEmail(20 + i);
    await prisma.user.create({
      data: { email, studentNo: studentNo(20 + i), passwordHash: await hashPassword('RightPass123') },
    });
    for (let f = 0; f < 5; f += 1) {
      await assert.rejects(auth.loginWithPassword(email, 'WrongPass123', IP), /邮箱或密码不正确/);
    }
  }

  const victim = campusEmail(26);
  await prisma.user.create({
    data: { email: victim, studentNo: studentNo(26), passwordHash: await hashPassword('RightPass123') },
  });
  await assert.rejects(auth.loginWithPassword(victim, 'RightPass123', IP), /当前网络登录失败次数过多/);
  // 其他 IP 不受影响
  const ok = await auth.loginWithPassword(victim, 'RightPass123', '10.0.0.2');
  assert.equal(ok.user.email, victim);
});

test('loginWithPassword：邮箱不存在与密码错误响应一致（防枚举）', async () => {
  const auth = makeAuth(new FakeMail(), new FakeRedisService());
  await assert.rejects(
    auth.loginWithPassword('20991111@std.uestc.edu.cn', 'Whatever123', IP),
    /邮箱或密码不正确/,
  );
});

test('teardown', async () => {
  await closePrisma();
});
