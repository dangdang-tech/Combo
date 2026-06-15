// B-06 · LLM Gateway 模块装配(env → 真 Anthropic SDK + 限流 + 审计 + 网关)。
// 对外保持 createLlmGateway(env, db?): LlmGatewayPort / probeLlm()，infra/index.ts 与脚手架不变。
//   - 无 ANTHROPIC_API_KEY → sdk=null：所有方法直接 degraded(不抛、不裸 502，脊柱 §10;
//     /ready 仍 ready=true，llm required:false)。
//   - 有 key → 真 SDK + 进程内令牌桶限流兜底(redis_hot 跨实例限流诚实推迟 Phase 5/6)。
//   - 传入 db → PG audit_llm_calls 仓储(createPgAuditSink):成功/降级都落审计,
//     写审计失败只日志不阻断主调用(70 §8.3:审计非计费真源);缺 db 才回落 no-op。
import Anthropic from '@anthropic-ai/sdk';
import type { LlmGatewayPort } from '@cb/shared';
import type { Env } from '../../config/env.js';
import { makeLlmGateway, type LlmSdkClient } from './gateway.js';
import { createTokenBucketLimiter, noopRateLimiter } from './limiter.js';
import { createPgAuditSink, noopAuditSink, type QueryableDb } from './audit.js';

/**
 * 组装生产网关:从 env 取 ANTHROPIC_API_KEY 建真 SDK;缺 key → null(降级,不阻塞启动)。
 * 限流默认进程内令牌桶(每分钟 60 次/key)。
 * 审计:传入 db → createPgAuditSink 落 audit_llm_calls(成功/降级都写;写失败只日志不阻断);
 *      缺 db → no-op(无 PG 直跑/冒烟用)。
 */
export function createLlmGateway(env: Env, db?: QueryableDb): LlmGatewayPort {
  const key = env.ANTHROPIC_API_KEY?.trim();
  const sdk: LlmSdkClient | null = key
    ? (new Anthropic({ apiKey: key }) as unknown as LlmSdkClient)
    : null;
  return makeLlmGateway({
    sdk,
    // 有 key 才开限流(无 key 直接 degraded,限流无意义)。
    rateLimiter: sdk
      ? createTokenBucketLimiter({ ratePerWindow: 60, windowMs: 60_000 })
      : noopRateLimiter,
    // 有 db → PG 审计(成功/降级都落库);写审计失败只 console.warn,不阻断主调用。
    audit: db
      ? createPgAuditSink(db, (err) =>
          console.warn(
            `[llm-audit] 落 audit_llm_calls 失败(已忽略,审计非计费真源): ${String(err)}`,
          ),
        )
      : noopAuditSink,
  });
}

/**
 * ready 探针(degraded 不算失败,脊柱 §10.2):LLM 永远 required:false。
 *   - 无 key/未实连 → 'degraded'(不停服,不计 /ready 失败)。
 *   - 有 key → 'ok'(真探活留 Phase;本期有 key 即视为可用,失败在调用时降级)。
 */
export function probeLlm(env?: Env): 'ok' | 'degraded' | 'down' {
  if (env?.ANTHROPIC_API_KEY?.trim()) return 'ok';
  return 'degraded';
}

export { makeLlmGateway } from './gateway.js';
export type { LlmGatewayDeps, LlmSdkClient } from './gateway.js';
export { LlmTimeoutError } from './gateway.js';
export { createTokenBucketLimiter, noopRateLimiter, createRedisRateLimiter } from './limiter.js';
export {
  noopAuditSink,
  createMemoryAuditSink,
  createPgAuditSink,
  type QueryableDb,
} from './audit.js';
export { normalizeLlmError, backoffMs } from './errors.js';
export {
  computeCostMicros,
  DEFAULT_MODEL,
  realClock,
  type LlmClock,
  type LlmRateLimiter,
  type LlmAuditSink,
  type LlmAuditRecord,
  type NormalizedLlmError,
} from './types.js';
