// B-06 · LLM Gateway 实现骨架（实现 shared LlmGatewayPort）。限流/重试/计费/流式。
// 脊柱口径：
//   - 超时分级按 taskClass（LLM_TIMEOUTS_MS）。
//   - 重试 ≤2（LLM_MAX_RETRIES），≤2 后才落终态错误信封（脊柱 §3.1）。
//   - 上游不稳 → degraded（进度短语 + 退路），绝不裸转圈 / 裸 502（脊柱 §10）。
//   - usage 落 audit（非计费真源），本期不接预算闸。
// 骨架阶段：方法接口齐全但内部为占位实现（Phase 3 接 @anthropic-ai/sdk + 限流计数 + 退避重试 + token 计费）。
import type { LlmCallOptions, LlmGatewayPort, LlmResult } from '@cb/shared';
import { LLM_MAX_RETRIES, LLM_TIMEOUTS_MS } from '@cb/shared';
import type { Env } from '../config/env.js';

const EMPTY_USAGE = { promptTokens: 0, completionTokens: 0, costMicros: 0 };

/**
 * LLM Gateway 骨架：声明限流/重试/计费/流式的接口契约。
 * Phase 3 在 complete/stream/embed 内接 Anthropic SDK，套：
 *   1) 限流（redis_hot 计数 + 滑窗）；2) 超时（LLM_TIMEOUTS_MS[taskClass]）；
 *   3) 退避重试（≤ LLM_MAX_RETRIES）；4) usage 计费落 audit_llm_calls。
 */
export function createLlmGateway(_env: Env): LlmGatewayPort {
  // env 留给 Phase 3 接 ANTHROPIC_API_KEY / OpenRouter base；骨架不实连。
  return {
    async complete(_prompt: string, opts: LlmCallOptions): Promise<LlmResult> {
      // 骨架：返回 degraded 降级结果（不裸转圈、不裸 502；调用方据 degraded 给进度短语 + 退路）。
      assertTimeoutConfigured(opts);
      return { degraded: true, usage: EMPTY_USAGE };
    },

    async *stream(_prompt: string, opts: LlmCallOptions): AsyncIterable<{ deltaText: string }> {
      // 骨架：空流（Phase 3 → field_delta 上游）。
      assertTimeoutConfigured(opts);
      // 无产出（占位）；yield* 空数组保留 async generator 形态供 Phase 3 直接填充。
      yield* [];
    },

    async embed(_input: string | string[], opts: LlmCallOptions): Promise<LlmResult> {
      assertTimeoutConfigured(opts);
      return { embedding: [], degraded: true, usage: EMPTY_USAGE };
    },
  };
}

/** 校验 taskClass 有超时档（守门：新增 taskClass 必须配超时）。 */
function assertTimeoutConfigured(opts: LlmCallOptions): void {
  const timeout = LLM_TIMEOUTS_MS[opts.taskClass];
  if (typeof timeout !== 'number') {
    throw new Error(`no timeout configured for LLM taskClass: ${opts.taskClass}`);
  }
}

/** 重试上限（供 Phase 3 重试循环引用，脊柱 §3.1）。 */
export const LLM_RETRY_LIMIT = LLM_MAX_RETRIES;

/**
 * ready 探针（degraded 不算失败，脊柱 §10.2）：LLM 永远 required:false，
 * 上游不稳只标 degraded、不停服。骨架恒返 degraded（未实连）。
 */
export function probeLlm(): 'ok' | 'degraded' | 'down' {
  return 'degraded';
}
