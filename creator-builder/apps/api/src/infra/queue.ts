// B-10/B-11 · BullMQ 队列封装（实现 shared QueuePort）。
//   - jobId 去重（BullMQ jobId = 业务 JobId，第二道幂等闸，脊柱 §4）。
//   - fenceToken 随 job data 入队（worker 写库带 WHERE fence_token=?，脊柱 §11.A 受保护写入）。
//   - PG jobs 表是状态唯一真源，BullMQ 只触发执行（脊柱 §6.1）。
// 骨架阶段：惰性建 Queue（不连 Redis 直到首次 enqueue），可 tsc/单测/启动冒烟无 Docker。
// 连接以 URL 形式传给 BullMQ（避免 BullMQ 自带 ioredis 与 workspace ioredis 的类型双实例冲突）。
import { Queue, type ConnectionOptions } from 'bullmq';
import type { JobId, JobType, QueuePort } from '@cb/shared';
import { ACTIVE_JOB_TYPES } from '@cb/shared';
import type { Env } from '../config/env.js';

/** BullMQ 连接配置（noeviction + AOF 的 redis_queue；maxRetriesPerRequest=null 是 BullMQ 硬要求）。 */
function connectionFor(env: Env): ConnectionOptions {
  const url = new URL(env.REDIS_QUEUE_URL);
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    ...(url.password ? { password: url.password } : {}),
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

/** 仅四类有 processor（脊柱 §6.3）。用 string[] 视角做成员判定（避免 tuple 收窄参数类型）。 */
const ACTIVE_TYPES: readonly string[] = ACTIVE_JOB_TYPES;

/** 每个 JobType 一条队列（本期注册 import/extract/structure/publish_batch；后两类不注册）。 */
const queues = new Map<JobType, Queue>();

function queueFor(env: Env, jobType: JobType): Queue {
  let q = queues.get(jobType);
  if (!q) {
    q = new Queue(`cb:${jobType}`, {
      connection: connectionFor(env),
      defaultJobOptions: {
        // 失败重试 ≤2（脊柱 §3.1：≤2 后才落终态错误信封）；退避指数。
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { age: 3_600 },
        removeOnFail: { age: 86_400 },
      },
    });
    queues.set(jobType, q);
  }
  return q;
}

/** BullMQ 实现的 QueuePort。enqueue 用业务 jobId 去重，fence 随 data 透传。 */
export function createBullQueuePort(env: Env): QueuePort {
  return {
    async enqueue(jobType: JobType, jobId: JobId, fenceToken: number): Promise<void> {
      if (!ACTIVE_TYPES.includes(jobType)) {
        // 仅四类有 processor（脊柱 §6.3）；其余拒绝入队（防误派）。
        throw new Error(`job type not registered: ${jobType}`);
      }
      // jobId 去重：同一 job 不重复入队（脊柱 §4 第二道闸）。
      await queueFor(env, jobType).add(jobType, { jobId, fenceToken }, { jobId });
    },
    async remove(jobId: JobId): Promise<void> {
      // 取消语义（脊柱 §6.1）：从所有活动队列移除该 job（fence 换新后旧执行已无法回写）。
      await Promise.allSettled(
        [...queues.values()].map(async (q) => {
          const job = await q.getJob(jobId);
          if (job) await job.remove();
        }),
      );
    },
  };
}

/** 优雅关闭所有队列。 */
export async function closeQueues(): Promise<void> {
  await Promise.allSettled([...queues.values()].map((q) => q.close()));
  queues.clear();
}
