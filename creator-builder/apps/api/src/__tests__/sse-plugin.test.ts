// SSE 协议自检（脊柱 §5 / Codex#3）：握手 + 连接即 state_snapshot + Last-Event-ID 恢复 + 帧格式。
//   用最小 mock reply/req（捕获 raw.write）验证真协议，无需真实 socket。
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  startSseStream,
  writeSseFrame,
  getLastEventId,
  type ReplayResult,
} from '../plugins/sse.js';
import type { StateSnapshotPayload } from '@cb/shared';

/** 捕获写入的最小 raw stream。 */
function makeRaw() {
  const writes: string[] = [];
  return {
    writes,
    writableEnded: false,
    writeHead: vi.fn(),
    write: vi.fn((chunk: string) => {
      writes.push(chunk);
      return true;
    }),
    end: vi.fn(function (this: { writableEnded: boolean }) {
      this.writableEnded = true;
    }),
  };
}

function makeReplyReq() {
  const raw = makeRaw();
  const reqRaw = new EventEmitter();
  const reply = { raw, hijack: vi.fn() } as unknown as Parameters<typeof startSseStream>[1];
  const req = { raw: reqRaw } as unknown as Parameters<typeof startSseStream>[0];
  return { reply, req, raw, reqRaw };
}

const jobSnapshot: StateSnapshotPayload = {
  kind: 'job',
  progress: { percent: 0, phrase: '正在准备…', subtasks: [] },
};

describe('SSE frame format (脊柱 §5.3)', () => {
  it('writeSseFrame emits id/event/data with trailing blank line', () => {
    const raw = makeRaw();
    writeSseFrame({ raw } as never, {
      id: '1718-0',
      event: 'progress',
      payload: { percent: 42 },
    });
    const out = raw.writes.join('');
    expect(out).toContain('id: 1718-0');
    expect(out).toContain('event: progress');
    expect(out).toContain('data: {"percent":42}');
    expect(out.endsWith('\n\n')).toBe(true);
  });
});

describe('getLastEventId (脊柱 §5.4)', () => {
  it('reads last-event-id header', () => {
    expect(getLastEventId({ headers: { 'last-event-id': 'abc' } } as never)).toBe('abc');
    expect(getLastEventId({ headers: {} } as never)).toBeUndefined();
  });
});

describe('startSseStream handshake (脊柱 §5.2 / §5.4)', () => {
  it('writes SSE headers + hijacks + first frame = state_snapshot when no Last-Event-ID', async () => {
    const { reply, req, raw } = makeReplyReq();
    const handle = await startSseStream(req, reply, {
      kind: 'job',
      loadSnapshot: async () => jobSnapshot,
    });
    expect(raw.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ 'Content-Type': 'text/event-stream' }),
    );
    const out = raw.writes.join('');
    expect(out).toContain('event: state_snapshot');
    expect(out).toContain('"kind":"job"');
    handle.stop();
  });

  it('Last-Event-ID in window → replays increments, NO snapshot (脊柱 §5.4)', async () => {
    const { reply, req, raw } = makeReplyReq();
    const replaySince = async (): Promise<ReplayResult> => ({
      inWindow: true,
      frames: [{ id: '10-0', event: 'progress', payload: { percent: 80 } }],
    });
    const handle = await startSseStream(req, reply, {
      kind: 'job',
      lastEventId: '9-0',
      replaySince,
      loadSnapshot: async () => jobSnapshot,
    });
    const out = raw.writes.join('');
    expect(out).toContain('event: progress');
    expect(out).toContain('id: 10-0');
    // 在窗口内续传：不重推 snapshot。
    expect(out).not.toContain('event: state_snapshot');
    handle.stop();
  });

  it('Last-Event-ID out of window → falls back to state_snapshot (脊柱 §5.4)', async () => {
    const { reply, req, raw } = makeReplyReq();
    const replaySince = async (): Promise<ReplayResult> => ({ inWindow: false, frames: [] });
    const handle = await startSseStream(req, reply, {
      kind: 'job',
      lastEventId: 'ancient-0',
      replaySince,
      loadSnapshot: async () => jobSnapshot,
    });
    const out = raw.writes.join('');
    expect(out).toContain('event: state_snapshot');
    handle.stop();
  });

  it('client disconnect (req close) stops the stream', async () => {
    const { reply, req, raw, reqRaw } = makeReplyReq();
    await startSseStream(req, reply, { kind: 'job', loadSnapshot: async () => jobSnapshot });
    reqRaw.emit('close');
    expect(raw.end).toHaveBeenCalled();
  });

  it('push after stop is a no-op (no write to closed stream)', async () => {
    const { reply, req, raw } = makeReplyReq();
    const handle = await startSseStream(req, reply, {
      kind: 'job',
      loadSnapshot: async () => jobSnapshot,
    });
    const before = raw.writes.length;
    handle.stop();
    handle.push({ event: 'progress', payload: { percent: 100 } });
    expect(raw.writes.length).toBe(before);
  });

  it('心跳发【具名 heartbeat 帧】+ data:{ts}（不是 SSE comment : hb，Codex#5）', async () => {
    vi.useFakeTimers();
    try {
      const { reply, req, raw } = makeReplyReq();
      const handle = await startSseStream(req, reply, {
        kind: 'job',
        loadSnapshot: async () => jobSnapshot,
        heartbeatMs: 1000,
      });
      // 推进一个心跳周期。
      await vi.advanceTimersByTimeAsync(1000);
      const out = raw.writes.join('');
      expect(out).toContain('event: heartbeat'); // 具名事件，前端 EventSource 收得到
      expect(out).toMatch(/data: \{"ts":\d+\}/); // 带 {ts} payload
      expect(out).not.toContain(': hb'); // 不再用不可观测的 SSE comment
      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
