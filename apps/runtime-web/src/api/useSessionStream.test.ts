import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribeSessionEvents } from './useSessionStream.js';

class MockEventSource {
  static readonly CLOSED = 2;
  static instances: MockEventSource[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(
    readonly url: string,
    readonly options: EventSourceInit,
  ) {
    MockEventSource.instances.push(this);
  }

  failClosed(): void {
    this.readyState = MockEventSource.CLOSED;
    this.onerror?.();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  MockEventSource.instances = [];
});

describe('runtime session EventSource fixed-session behavior', () => {
  it('uses the shared HttpOnly cookie and never calls a refresh endpoint', () => {
    vi.stubGlobal('EventSource', MockEventSource);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const onFatal = vi.fn();

    const stop = subscribeSessionEvents('/stream', { onMessage: vi.fn(), onFatal });
    const source = MockEventSource.instances[0]!;
    expect(source.options.withCredentials).toBe(true);

    source.failClosed();

    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(MockEventSource.instances).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    stop();
  });

  it('reports a closed stream only once and closes it during cleanup', () => {
    vi.stubGlobal('EventSource', MockEventSource);
    const onFatal = vi.fn();
    const stop = subscribeSessionEvents('/stream', { onMessage: vi.fn(), onFatal });
    const source = MockEventSource.instances[0]!;

    source.failClosed();
    source.failClosed();
    expect(onFatal).toHaveBeenCalledTimes(1);

    stop();
    expect(source.close).toHaveBeenCalled();
  });
});
