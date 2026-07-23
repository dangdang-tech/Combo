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
  prompt: string;
  outputText: string;
  error: string | null;
  testSessionId: string | null;
  revisionId: string | null;
  runId: string | null;
  run: (revisionId: string, prompt: string) => boolean;
  interrupt: (fallbackRunId?: string) => boolean;
}

export function useStudioTestRun(studioSessionId: string | undefined): StudioTestRunState {
  const qc = useQueryClient();
  const sourceRef = useRef<EventSource | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [outputText, setOutputText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [testSessionId, setTestSessionId] = useState<string | null>(null);
  const [revisionId, setRevisionId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const studioSessionRef = useRef(studioSessionId);
  const busyRef = useRef(false);
  const attemptRef = useRef(0);

  useEffect(() => {
    attemptRef.current += 1;
    studioSessionRef.current = studioSessionId;
    sourceRef.current?.close();
    sourceRef.current = null;
    busyRef.current = false;
    setIsRunning(false);
    setPrompt('');
    setOutputText('');
    setError(null);
    setTestSessionId(null);
    setRevisionId(null);
    setRunId(null);
    return () => {
      attemptRef.current += 1;
      sourceRef.current?.close();
    };
  }, [studioSessionId]);

  const isCurrentAttempt = (attempt: number, expectedStudioSessionId: string): boolean =>
    attemptRef.current === attempt && studioSessionRef.current === expectedStudioSessionId;

  const finish = (
    source: EventSource,
    expectedStudioSessionId: string,
    finishedTestSessionId: string,
    attempt: number,
  ): void => {
    source.close();
    if (sourceRef.current !== source) return;
    sourceRef.current = null;
    if (!isCurrentAttempt(attempt, expectedStudioSessionId)) return;
    busyRef.current = false;
    setIsRunning(false);
    setRunId(null);
    void qc.invalidateQueries({ queryKey: ['studio', expectedStudioSessionId] });
    void qc.invalidateQueries({ queryKey: ['session', finishedTestSessionId] });
  };

  const attach = (
    result: CreateStudioTestResult,
    expectedStudioSessionId: string,
    attempt: number,
  ): void => {
    if (!isCurrentAttempt(attempt, expectedStudioSessionId)) return;
    const source = new EventSource(result.eventsUrl, { withCredentials: true });
    if (!isCurrentAttempt(attempt, expectedStudioSessionId)) {
      source.close();
      return;
    }
    sourceRef.current = source;
    source.onmessage = (event) => {
      if (sourceRef.current !== source || !isCurrentAttempt(attempt, expectedStudioSessionId)) {
        source.close();
        return;
      }
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
        finish(source, expectedStudioSessionId, result.test.testSessionId, attempt);
      } else if (frame.type === EventType.RUN_FINISHED) {
        finish(source, expectedStudioSessionId, result.test.testSessionId, attempt);
      }
    };
    source.onerror = () => {
      if (sourceRef.current !== source || !isCurrentAttempt(attempt, expectedStudioSessionId)) {
        source.close();
        return;
      }
      setError('试用连接中断，结果完成后仍会保存在这里。');
      finish(source, expectedStudioSessionId, result.test.testSessionId, attempt);
    };
  };

  const run = (revisionId: string, prompt: string): boolean => {
    const normalizedPrompt = prompt.trim();
    if (!studioSessionId || busyRef.current || !normalizedPrompt) return false;
    const attempt = ++attemptRef.current;
    busyRef.current = true;
    sourceRef.current?.close();
    sourceRef.current = null;
    setIsRunning(true);
    setOutputText('');
    setError(null);
    setPrompt(normalizedPrompt);
    setTestSessionId(null);
    setRevisionId(revisionId);
    setRunId(null);
    const expectedStudioSessionId = studioSessionId;
    void apiPost<CreateStudioTestResult>(`/runtime/studio/sessions/${studioSessionId}/tests`, {
      revisionId,
      prompt: normalizedPrompt,
    })
      .then((result) => {
        if (!isCurrentAttempt(attempt, expectedStudioSessionId)) return;
        setTestSessionId(result.test.testSessionId);
        setRunId(result.run.id);
        attach(result, expectedStudioSessionId, attempt);
      })
      .catch(() => {
        if (!isCurrentAttempt(attempt, expectedStudioSessionId)) return;
        busyRef.current = false;
        setIsRunning(false);
        setRunId(null);
        setError('无法开始真实试用，请稍后重试。');
      });
    return true;
  };

  const interrupt = (fallbackRunId?: string): boolean => {
    const activeRunId = runId ?? fallbackRunId;
    if (!activeRunId) return false;
    if (activeRunId === runId) setRunId(null);
    void apiPost(`/runtime/runs/${activeRunId}/interrupt`).catch(() => undefined);
    return true;
  };

  return {
    isRunning,
    prompt,
    outputText,
    error,
    testSessionId,
    revisionId,
    runId,
    run,
    interrupt,
  };
}
