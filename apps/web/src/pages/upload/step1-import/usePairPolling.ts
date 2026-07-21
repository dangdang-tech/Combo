// 配对状态轮询 hook（F-10）——铸码后按 2s 节奏轮询 /import/connect/pair/{id}，拿到 jobId 即停。
//
// 永不裸转圈：轮询期 status 持续暴露给 CommandBox 渲染会话状态（waiting/uploading）；
//   phase=job_created 停轮询并回 jobId（上层转 SSE）；expired 停轮询给「重新生成」引导；
//   瞬断保留上次 status 并显示重连；登录失效 / 任务不存在等确定性错误则停止空转。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PairStatusView } from '@cb/shared';
import { ApiError } from '../../../api/index.js';
import { fetchPairStatus } from './importApi.js';

/** 轮询间隔（20 §3.4 建议 2s）。 */
export const PAIR_POLL_INTERVAL_MS = 2_000;

export interface UsePairPollingResult {
  /** 最新轮询到的状态（首拍前为 undefined，CommandBox 按 waiting 渲染）。 */
  status: PairStatusView | undefined;
  /** phase=job_created 时给出 jobId（上层转 SSE）。 */
  jobId: string | undefined;
  /** 最近一次轮询错误；瞬断会保留任务并继续自动重连。 */
  error: ApiError | undefined;
  /** true 表示当前是可恢复的网络/服务瞬断，不应把用户踢出上传页。 */
  reconnecting: boolean;
  /** 立即重试状态请求（用于确定性错误的显式退路）。 */
  retry: () => void;
}

function pollingFallbackError(): ApiError {
  return new ApiError({
    error: {
      userMessage: '暂时没连上这次上传，我们正在重试。',
      retriable: true,
      action: 'retry',
      traceId: '',
    },
  });
}

/**
 * 轮询某配对会话状态。pairId 为 undefined（未铸码）时不轮询。
 * 命中 job_created / expired 即停（终态，不再无意义轮询）。
 */
export function usePairPolling(pairId: string | undefined): UsePairPollingResult {
  const [status, setStatus] = useState<PairStatusView | undefined>(undefined);
  const [jobId, setJobId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<ApiError | undefined>(undefined);
  const [reconnecting, setReconnecting] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const retry = useCallback((): void => setRetryNonce((value) => value + 1), []);

  useEffect(() => {
    // pairId 更换时先清空上一条任务的终态，避免 p1 expired/jobId 短暂污染 p2。
    setStatus(undefined);
    setJobId(undefined);
    setError(undefined);
    setReconnecting(false);
    if (!pairId) {
      return;
    }
    let active = true;
    const ctrl = new AbortController();

    const clear = (): void => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const tick = async (): Promise<void> => {
      try {
        const next = await fetchPairStatus(pairId, { signal: ctrl.signal });
        if (!active) return;
        setStatus(next);
        setError(undefined);
        setReconnecting(false);
        if (next.phase === 'job_created' && next.jobId) {
          setJobId(next.jobId);
          return; // 终态：停轮询，上层转 SSE。
        }
        if (next.phase === 'expired') return; // 终态：停轮询，给重新生成引导。
      } catch (e) {
        // 瞬断容忍，但不再静默：可重试错误继续下一拍并暴露「正在重连」；
        // 登录失效 / 任务不存在等确定性错误停止空转，交给页面显式给退路。
        if (e instanceof DOMException && e.name === 'AbortError') return;
        if (!active) return;
        const nextError = e instanceof ApiError ? e : pollingFallbackError();
        setError(nextError);
        if (!nextError.retriable) {
          setReconnecting(false);
          return;
        }
        setReconnecting(true);
      }
      timerRef.current = setTimeout(() => void tick(), PAIR_POLL_INTERVAL_MS);
    };

    void tick();
    return () => {
      active = false;
      ctrl.abort();
      clear();
    };
  }, [pairId, retryNonce]);

  return { status, jobId, error, reconnecting, retry };
}
