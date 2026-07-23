import type { PropsWithChildren } from 'react';
import { EventType } from '@ag-ui/core';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CreateStudioTestResult } from '@cb/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiPostMock = vi.hoisted(() => vi.fn());

vi.mock('./client.js', () => ({
  apiGet: vi.fn(),
  apiPost: apiPostMock,
}));

import { useStudioTestRun } from './useStudioSession.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  readonly withCredentials: boolean;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(url: string | URL, init?: EventSourceInit) {
    this.url = String(url);
    this.withCredentials = init?.withCredentials ?? false;
    FakeEventSource.instances.push(this);
  }

  emit(frame: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent<string>);
  }

  fail(): void {
    this.onerror?.();
  }
}

function createStudioTestResult(
  testSessionId: string,
  revisionId: string,
  eventsUrl: string,
): CreateStudioTestResult {
  return {
    test: {
      id: '33333333-3333-4333-8333-333333333333',
      revisionId,
      revisionNo: 1,
      testSessionId,
      runId: '44444444-4444-4444-8444-444444444444',
      status: 'running',
      createdAt: '2026-07-23T08:00:00.000Z',
      completedAt: null,
    },
    run: {
      id: '44444444-4444-4444-8444-444444444444',
      sessionId: testSessionId,
      status: 'running',
      createdAt: '2026-07-23T08:00:00.000Z',
      updatedAt: '2026-07-23T08:00:00.000Z',
      completedAt: null,
    },
    eventsUrl,
  };
}

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useStudioTestRun', () => {
  beforeEach(() => {
    apiPostMock.mockReset();
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts only one test while the first request is starting', () => {
    apiPostMock.mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => useStudioTestRun('11111111-1111-4111-8111-111111111111'), {
      wrapper: createWrapper(),
    });

    act(() => {
      expect(result.current.run('22222222-2222-4222-8222-222222222222', '真实任务一')).toBe(true);
      expect(result.current.run('22222222-2222-4222-8222-222222222222', '真实任务二')).toBe(false);
    });

    expect(apiPostMock).toHaveBeenCalledTimes(1);
    expect(result.current.prompt).toBe('真实任务一');
  });

  it('ignores late frames from an EventSource after a newer test starts', async () => {
    const studioSessionId = '11111111-1111-4111-8111-111111111111';
    const revisionId = '22222222-2222-4222-8222-222222222222';
    apiPostMock
      .mockResolvedValueOnce(
        createStudioTestResult('55555555-5555-4555-8555-555555555555', revisionId, '/events/first'),
      )
      .mockResolvedValueOnce(
        createStudioTestResult(
          '66666666-6666-4666-8666-666666666666',
          revisionId,
          '/events/second',
        ),
      );
    const { result } = renderHook(() => useStudioTestRun(studioSessionId), {
      wrapper: createWrapper(),
    });

    act(() => {
      expect(result.current.run(revisionId, '第一次试用')).toBe(true);
    });
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const firstSource = FakeEventSource.instances[0]!;

    act(() => {
      firstSource.emit({ type: EventType.RUN_FINISHED });
    });
    await waitFor(() => expect(result.current.isRunning).toBe(false));

    act(() => {
      expect(result.current.run(revisionId, '第二次试用')).toBe(true);
    });
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    const secondSource = FakeEventSource.instances[1]!;
    await waitFor(() =>
      expect(result.current.testSessionId).toBe('66666666-6666-4666-8666-666666666666'),
    );

    act(() => {
      firstSource.emit({ type: EventType.TEXT_MESSAGE_CONTENT, delta: '过期结果' });
      firstSource.fail();
    });

    expect(firstSource.close).toHaveBeenCalled();
    expect(secondSource.close).not.toHaveBeenCalled();
    expect(result.current.isRunning).toBe(true);
    expect(result.current.outputText).toBe('');
    expect(result.current.error).toBeNull();
    expect(result.current.prompt).toBe('第二次试用');
  });

  it('interrupts the active real-task run', async () => {
    const studioSessionId = '11111111-1111-4111-8111-111111111111';
    const revisionId = '22222222-2222-4222-8222-222222222222';
    apiPostMock
      .mockResolvedValueOnce(
        createStudioTestResult(
          '55555555-5555-4555-8555-555555555555',
          revisionId,
          '/events/current',
        ),
      )
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useStudioTestRun(studioSessionId), {
      wrapper: createWrapper(),
    });

    act(() => {
      expect(result.current.interrupt()).toBe(false);
      expect(result.current.run(revisionId, '需要停止的试用')).toBe(true);
    });
    await waitFor(() => expect(result.current.runId).toBe('44444444-4444-4444-8444-444444444444'));

    act(() => {
      expect(result.current.interrupt()).toBe(true);
    });

    expect(apiPostMock).toHaveBeenLastCalledWith(
      '/runtime/runs/44444444-4444-4444-8444-444444444444/interrupt',
    );
  });

  it('can interrupt a restored real-task run by its persisted id', () => {
    apiPostMock.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useStudioTestRun('11111111-1111-4111-8111-111111111111'), {
      wrapper: createWrapper(),
    });

    act(() => {
      expect(result.current.interrupt('77777777-7777-4777-8777-777777777777')).toBe(true);
    });

    expect(apiPostMock).toHaveBeenCalledWith(
      '/runtime/runs/77777777-7777-4777-8777-777777777777/interrupt',
    );
  });

  it('ignores an old pending POST after the session changes A to B to A', async () => {
    const sessionA = '11111111-1111-4111-8111-111111111111';
    const sessionB = '88888888-8888-4888-8888-888888888888';
    const revisionId = '22222222-2222-4222-8222-222222222222';
    const oldAttempt = deferred<CreateStudioTestResult>();
    const currentAttempt = deferred<CreateStudioTestResult>();
    apiPostMock
      .mockImplementationOnce(() => oldAttempt.promise)
      .mockImplementationOnce(() => currentAttempt.promise);
    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useStudioTestRun(sessionId),
      {
        initialProps: { sessionId: sessionA },
        wrapper: createWrapper(),
      },
    );

    act(() => {
      expect(result.current.run(revisionId, '旧 A 请求')).toBe(true);
    });
    rerender({ sessionId: sessionB });
    rerender({ sessionId: sessionA });
    act(() => {
      expect(result.current.run(revisionId, '新 A 请求')).toBe(true);
    });

    await act(async () => {
      currentAttempt.resolve(
        createStudioTestResult(
          '99999999-9999-4999-8999-999999999999',
          revisionId,
          '/events/current-a',
        ),
      );
      await Promise.resolve();
    });
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(result.current.testSessionId).toBe('99999999-9999-4999-8999-999999999999');
    expect(result.current.prompt).toBe('新 A 请求');

    await act(async () => {
      oldAttempt.resolve(
        createStudioTestResult('55555555-5555-4555-8555-555555555555', revisionId, '/events/old-a'),
      );
      await Promise.resolve();
    });

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]?.url).toBe('/events/current-a');
    expect(result.current.testSessionId).toBe('99999999-9999-4999-8999-999999999999');
    expect(result.current.prompt).toBe('新 A 请求');
    expect(result.current.error).toBeNull();
  });
});
