import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

/**
 * 密码哈希（node:crypto scrypt，无第三方依赖）
 * 存储格式：s2:<salt-hex>:<hash-hex>
 *
 * Issue 12：scrypt 是 CPU 密集型计算，必须走异步接口（libuv 线程池），
 * 同步版 scryptSync 在高频登录下会阻塞事件循环、拖垮全部接口。
 */
const KEY_LEN = 64;
const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, KEY_LEN)).toString('hex');
  return `s2:${salt}:${hash}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split(':');
  if (scheme !== 's2' || !salt || !hash) return false;
  const candidate = await scrypt(password, salt, KEY_LEN);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/**
 * 密码强度：8-64 位
 */
export function validatePasswordStrength(password: string): string | null {
  if (typeof password !== 'string' || password.length < 8 || password.length > 64) {
    return '密码长度需在 8-64 位之间';
  }
  return null;
}
