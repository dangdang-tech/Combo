// consumer 进程：outbox 顺序消费（MarketplaceProjection + NotifyConsumer，B-14）。
// 骨架：列出本期实际产生的 topic（脊柱 §7）；Phase 3 接连续安全前缀水位算法（§11.D）。
import { loadEnv } from '../config/env.js';
import { ACTIVE_OUTBOX_TOPICS } from '@cb/shared';

function main(): void {
  loadEnv();

  console.log(`[consumer] booted; active topics (Phase 3): ${ACTIVE_OUTBOX_TOPICS.join(', ')}`);
  const keepAlive = setInterval(() => {}, 1 << 30);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      clearInterval(keepAlive);
      process.exit(0);
    });
  }
}

main();
