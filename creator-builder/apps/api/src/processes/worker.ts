// worker 进程：BullMQ job processor（import/extract/structure/publish_batch）。
// 骨架：仅启动 + 列出本期注册的四类 processor 占位（Phase 3 接 BullMQ Worker + 受保护写入 CTE，脊柱 §11.A）。
// 写库铁律（Phase 3）：所有 jobs/产物写入带 WHERE id=:jobId AND fence_token=:fence AND status='running'（脊柱 §11.A 模板）。
import { loadEnv } from '../config/env.js';
import { ACTIVE_JOB_TYPES } from '@cb/shared';

function main(): void {
  loadEnv();

  console.log(`[worker] booted; processor types (Phase 3): ${ACTIVE_JOB_TYPES.join(', ')}`);
  // 骨架阶段不连 Redis、不消费队列；保持进程存活以验证可启动。
  // Phase 3：getQueueRedis(env) + new Worker(`cb:${type}`, processor, { connection }) ×4，
  //   processor 内续租（lease_until）+ 受保护写入 CTE（§11.A）+ XADD 推 SSE 帧（§5）。
  const keepAlive = setInterval(() => {}, 1 << 30);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      clearInterval(keepAlive);
      process.exit(0);
    });
  }
}

main();
