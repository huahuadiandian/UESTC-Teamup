import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS = Symbol('REDIS');

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor() {
    this.client = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  async get(key: string) {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number) {
    return ttlSeconds ? this.client.set(key, value, 'EX', ttlSeconds) : this.client.set(key, value);
  }

  async del(...keys: string[]) {
    return this.client.del(...keys);
  }

  /** 自增并设置过期（用于限流计数） */
  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const n = await this.client.incr(key);
    if (n === 1) await this.client.expire(key, ttlSeconds);
    return n;
  }

  /** 递减计数（发信失败时回滚已占用的配额） */
  async decr(key: string): Promise<number> {
    return this.client.decr(key);
  }

  /** SET NX EX：分布式锁，返回 true 表示抢到 */
  async lock(key: string, ttlSeconds: number): Promise<boolean> {
    const ok = await this.client.set(key, '1', 'EX', ttlSeconds, 'NX');
    return ok === 'OK';
  }

  async unlock(key: string) {
    await this.client.del(key);
  }

  /**
   * 原子消费验证码（Issue 12）：旧的 get → 校验 → del 三步之间并发请求可能
   * 复用同一个验证码。这里用 Lua 在 Redis 端一次完成「比对 + 删除 + 失败计数」。
   * 返回：'OK' 匹配并已消费；'EXPIRED' 不存在；'WRONG:<n>' 第 n 次错误；
   * 'VOID' 连错达到上限、验证码已作废。
   */
  async consumeCodeWithFailLimit(
    codeKey: string,
    failKey: string,
    expected: string,
    failTtlSeconds: number,
    maxFails: number,
  ): Promise<string> {
    const script = `
local saved = redis.call('GET', KEYS[1])
if not saved then
  redis.call('DEL', KEYS[2])
  return 'EXPIRED'
end
if saved == ARGV[1] then
  redis.call('DEL', KEYS[1], KEYS[2])
  return 'OK'
end
local fails = redis.call('INCR', KEYS[2])
if fails == 1 then
  redis.call('EXPIRE', KEYS[2], ARGV[2])
end
if fails >= tonumber(ARGV[3]) then
  redis.call('DEL', KEYS[1], KEYS[2])
  return 'VOID'
end
return 'WRONG:' .. fails`;
    const res = await this.client.eval(script, 2, codeKey, failKey, expected, String(failTtlSeconds), String(maxFails));
    return String(res);
  }
}

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
