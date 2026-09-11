// 热态 Redis 客户端：认证软限流计数，可驱逐且不承载队列或业务事实。
// 骨架阶段：惰性创建、lazyConnect（不在 import/启动期连，便于无 Docker 跑 tsc/单测/启动冒烟）。
import { Redis, type RedisOptions } from 'ioredis';
import type { Env } from '../config/env.js';

const reconnectDelay = (times: number): number => Math.min(times * 200, 2_000);

/** redis_hot 连接（认证限流）。 */
const HOT_OPTS: RedisOptions = {
  lazyConnect: true,
  // 热态命令不能在依赖中断时排队数十秒：认证 challenge 要快速失败关闭，
  // verification 则快速回落 PostgreSQL 的硬限制。客户端仍在后台持续重连。
  connectTimeout: 2_000,
  maxRetriesPerRequest: 1,
  retryStrategy: reconnectDelay,
};

let hotClient: Redis | undefined;

/** ioredis 在连不上时会 emit 'error'；不挂监听会变 unhandled。骨架阶段静默吞（探针据连接状态判 down）。 */
function attachSilentErrorHandler(client: Redis): Redis {
  client.on('error', () => {
    /* swallow connection errors; readiness probe reports down via ping failure */
  });
  return client;
}

/** redis_hot 单例。 */
export function getHotRedis(env: Env): Redis {
  if (!hotClient) hotClient = attachSilentErrorHandler(new Redis(env.REDIS_HOT_URL, HOT_OPTS));
  return hotClient;
}

/** 优雅关闭热态实例（进程退出时调用）。 */
export async function closeRedis(): Promise<void> {
  // disconnect（非 quit）：连不上时 quit 会挂；disconnect 立即断、不等回包。
  hotClient?.disconnect();
  hotClient = undefined;
}

/** ready 探针：PING（连不上 → down），带短超时，避免 /ready 因依赖宕机而长挂。 */
export async function pingRedis(client: Redis, timeoutMs = 2_000): Promise<boolean> {
  try {
    const pong = await withTimeout(client.ping(), timeoutMs);
    return pong === 'PONG';
  } catch {
    return false;
  }
}

/** 给 Promise 套超时（探针专用：依赖宕机时快速判 down，不裸挂）。 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}
