import { useEffect, useRef, useState } from 'react';
import { EventType } from '@ag-ui/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateStudioTestResult, StudioState } from '@cb/shared';
import { apiGet, apiPost } from './client.js';

export function useStudioState(sessionId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['studio', sessionId],
    queryFn: () => apiGet<StudioState>(`/runtime/studio/sessions/${sessionId}`),
    enabled: enabled && Boolean(sessionId),
    refetchInterval: (query) => {
      const state = query.state.data;
      return state?.activeDesignRunId || state?.latestTest?.status === 'running' ? 1200 : false;
    },
  });
}

export interface StudioTestRunState {
  isRunning: boolean;
  outputText: string;
  error: string | null;
  testSessionId: string | null;
  revisionId: string | null;
  run: (revisionId: string, prompt: string) => void;
}

export function useStudioTestRun(studioSessionId: string | undefined): StudioTestRunState {
  const qc = useQueryClient();
  const sourceRef = useRef<EventSource | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [outputText, setOutputText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [testSessionId, setTestSessionId] = useState<string | null>(null);
  const [revisionId, setRevisionId] = useState<string | null>(null);
  const studioSessionRef = useRef(studioSessionId);

  useEffect(() => {
    studioSessionRef.current = studioSessionId;
    sourceRef.current?.close();
    sourceRef.current = null;
    setIsRunning(false);
    setOutputText('');
    setError(null);
    setTestSessionId(null);
    setRevisionId(null);
    return () => {
      sourceRef.current?.close();
    };
  }, [studioSessionId]);

  const finish = (
    source: EventSource,
    expectedStudioSessionId: string,
    finishedTestSessionId: string,
  ): void => {
    source.close();
    if (sourceRef.current === source) sourceRef.current = null;
    if (studioSessionRef.current !== expectedStudioSessionId) return;
    setIsRunning(false);
    void qc.invalidateQueries({ queryKey: ['studio', expectedStudioSessionId] });
    void qc.invalidateQueries({ queryKey: ['session', finishedTestSessionId] });
  };

  const attach = (result: CreateStudioTestResult, expectedStudioSessionId: string): void => {
    const source = new EventSource(result.eventsUrl, { withCredentials: true });
    sourceRef.current = source;
    source.onmessage = (event) => {
      let frame: { type?: string; delta?: unknown; message?: string };
      try {
        frame = JSON.parse(event.data) as typeof frame;
      } catch {
        return;
      }
      if (frame.type === EventType.TEXT_MESSAGE_CONTENT && typeof frame.delta === 'string') {
        setOutputText((current) => `${current}${frame.delta}`);
      } else if (frame.type === EventType.RUN_ERROR) {
        setError(frame.message ?? '真实试用失败，请调整输入后重试。');
        finish(source, expectedStudioSessionId, result.test.testSessionId);
      } else if (frame.type === EventType.RUN_FINISHED) {
        finish(source, expectedStudioSessionId, result.test.testSessionId);
      }
    };
    source.onerror = () => {
      if (studioSessionRef.current !== expectedStudioSessionId) {
        source.close();
        return;
      }
      setError('试用连接中断，结果完成后仍会保存在这里。');
      finish(source, expectedStudioSessionId, result.test.testSessionId);
    };
  };

  const run = (revisionId: string, prompt: string): void => {
    if (!studioSessionId || isRunning || !prompt.trim()) return;
    sourceRef.current?.close();
    setIsRunning(true);
    setOutputText('');
    setError(null);
    setRevisionId(revisionId);
    const expectedStudioSessionId = studioSessionId;
    void apiPost<CreateStudioTestResult>(`/runtime/studio/sessions/${studioSessionId}/tests`, {
      revisionId,
      prompt: prompt.trim(),
    })
      .then((result) => {
        if (studioSessionRef.current !== expectedStudioSessionId) return;
        setTestSessionId(result.test.testSessionId);
        attach(result, expectedStudioSessionId);
      })
      .catch(() => {
        if (studioSessionRef.current !== expectedStudioSessionId) return;
        setIsRunning(false);
        setError('无法开始真实试用，请稍后重试。');
      });
  };

  return { isRunning, outputText, error, testSessionId, revisionId, run };
}
