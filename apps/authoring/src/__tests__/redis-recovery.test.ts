import { afterEach, describe, expect, it } from 'vitest';
import type { Env } from '../platform/config/env.js';
import { closeRedis, getHotRedis } from '../platform/infra/redis.js';

const env = {
  REDIS_HOT_URL: 'redis://127.0.0.1:6380/0',
} as Env;

afterEach(async () => {
  await closeRedis();
});

describe('Redis dependency recovery', () => {
  it('keeps retrying the hot client with a bounded delay after repeated connection failures', () => {
    const hot = getHotRedis(env);
    const retryStrategy = hot.options.retryStrategy;
    expect(retryStrategy).toBeTypeOf('function');
    expect(retryStrategy?.(1)).toBe(200);
    expect(retryStrategy?.(2)).toBe(400);
    expect(retryStrategy?.(10)).toBe(2_000);
    expect(retryStrategy?.(1_000)).toBe(2_000);
    expect(hot.options.maxRetriesPerRequest).toBe(1);
    expect(hot.options.connectTimeout).toBe(2_000);
  });
});
