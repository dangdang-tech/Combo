// 单一 API 进程：认证、计费、Agent Draft 与 Agent 交付 HTTP 服务。
import { loadEnv } from '../platform/config/env.js';
import { startNodeObservability } from '../platform/observability/node.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const observability = startNodeObservability(env);
  const { buildApp } = await import('../bootstrap/app.js');
  const app = await buildApp();
  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(
    { observability: observability.enabled },
    `[api] listening on http://${env.HOST}:${env.PORT}`,
  );

  let shuttingDown = false;
  const shutdown = (sig: string): void => {
    if (shuttingDown) return; // 重复信号无视：只跑一次关停
    shuttingDown = true;
    app.log.info(`[api] ${sig} received, closing`);
    // 兜底：app.close() 会等 in-flight 请求 drain，卡住的上游请求
    // 会让它永不 resolve、关停被无限堵住（只能等 docker SIGKILL，拖住部署/重启）。到点强制退出。
    const force = setTimeout(() => {
      app.log.error(`[api] 关停在 ${env.SHUTDOWN_TIMEOUT_MS}ms 内未完成，强制退出`);
      process.exit(1);
    }, env.SHUTDOWN_TIMEOUT_MS);
    force.unref(); // 别让这个定时器把进程钉住
    void app
      .close()
      .then(() => observability.shutdown())
      .then(() => {
        clearTimeout(force);
        process.exit(0);
      })
      .catch((err) => {
        app.log.error({ err }, '[api] 关停出错，强制退出');
        process.exit(1);
      });
  };
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => shutdown(sig));
}

main().catch((err) => {
  console.error('[api] fatal', err);
  process.exit(1);
});
