// sweeper 进程：job 对账（fencing 重入队）+ orphan 清理 + outbox 滞留补投（B-16）。
// 骨架：仅启动；Phase 3 接单活锁 + 三件事（脊柱 §11.A 受保护写入）。
import { loadEnv } from '../config/env.js';

function main(): void {
  loadEnv();

  console.log('[sweeper] booted; duties (Phase 3): job 对账 / orphan 清理 / outbox 滞留补投');
  const keepAlive = setInterval(() => {}, 1 << 30);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      clearInterval(keepAlive);
      process.exit(0);
    });
  }
}

main();
