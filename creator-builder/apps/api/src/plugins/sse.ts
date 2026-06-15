// B-12 · SSE 插件（脊柱 §5）。永不裸转圈的核心机制（Codex#3）。
//   真实 text/event-stream 流：握手 + 连接即 state_snapshot + 心跳 + Last-Event-ID 恢复协议。
//   - 帧格式：id:（= Redis Stream entry id，Last-Event-ID 用）/ event: / data:（脊柱 §5.3）。
//   - 连接首帧（脊柱 §5.2 / §5.4）：
//       · Last-Event-ID 仍在窗口内 → 从该 id 之后补发增量（不重推 snapshot）；
//       · 超窗 / 无 Last-Event-ID → 先推 state_snapshot（按 kind 三型）重置，再续流。
//   - 心跳默认 15s（SSE_HEARTBEAT_INTERVAL_MS，脊柱 §5.5）：发【具名 heartbeat 帧】+ data:{ts}（Codex#5），
//     不是不可观测的 SSE comment（: hb）——前端 EventSource 收得到具名事件、watchdog 据此复位，空业务流不再反复重连。
//   - 鉴权统一同源 Cookie、建流前 HTTP 失败（脊柱 §11.C）——由路由 requireSseAuth preHandler 守，不在本插件。
//   业务事件跟流（Redis Streams XADD 桥接）本期可空：协议为真，业务事件源 Phase 3 接 redisHot.xread。
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  SSE_HEARTBEAT_INTERVAL_MS,
  type SSEEventType,
  type SSEFrame,
  type SSEStreamKind,
  type StateSnapshotPayload,
} from '@cb/shared';

/** 取 Last-Event-ID（脊柱 §5.4：fetch-event-source 重连自动带此头）。 */
export function getLastEventId(req: FastifyRequest): string | undefined {
  const h = req.headers['last-event-id'];
  if (typeof h === 'string' && h.length > 0) return h;
  if (Array.isArray(h) && h.length > 0) return h[0];
  return undefined;
}

/** 单帧写入：遵脊柱 §5.3 标准 SSE 格式（id/event/data）。 */
export function writeSseFrame(
  reply: FastifyReply,
  frame: { id?: string; event: SSEEventType; payload: unknown },
): void {
  const lines: string[] = [];
  if (frame.id) lines.push(`id: ${frame.id}`);
  lines.push(`event: ${frame.event}`);
  lines.push(`data: ${JSON.stringify(frame.payload)}`);
  lines.push('', ''); // 帧间空行
  reply.raw.write(lines.join('\n'));
}

/**
 * 具名 heartbeat 帧（脊柱 §5.5 / Codex#5）：`event: heartbeat` + `data: {ts}`。
 *   前端 EventSource addEventListener('heartbeat') 收得到 → watchdog 复位（空业务流不再 30s 反复重连）。
 *   不带 id（不进 Last-Event-ID 续传序，纯探活），不裸用 SSE comment（: hb 不可观测）。
 */
function writeHeartbeat(reply: FastifyReply): void {
  writeSseFrame(reply, { event: 'heartbeat', payload: { ts: Date.now() } });
}

/**
 * Last-Event-ID 窗口补发结果（脊柱 §5.4）。
 *   - inWindow=true：id 仍在 Stream 窗口内，frames 是该 id 之后的增量（不重推 snapshot）。
 *   - inWindow=false：超窗（id 已被裁剪）或无 Last-Event-ID → 调用方先推 snapshot 再续流。
 */
export interface ReplayResult {
  inWindow: boolean;
  frames: SSEFrame[];
}

/** 建流入参：kind + 首帧 snapshot 取数 + 可选 Last-Event-ID 窗口补发（脊柱 §5.2/§5.4）。 */
export interface SseStreamOptions {
  kind: SSEStreamKind;
  /** 计算首帧 state_snapshot 全量（脊柱 §5.2）。 */
  loadSnapshot: () => Promise<StateSnapshotPayload>;
  /** Last-Event-ID（重连补发用，脊柱 §5.4）。 */
  lastEventId?: string;
  /**
   * Last-Event-ID 窗口补发（脊柱 §5.4）：给了 lastEventId 时调用，
   * 返回是否在窗口内 + 窗口内增量帧。缺省（未接 Redis Streams）= 视为超窗（走 snapshot 重置）。
   */
  replaySince?: (lastEventId: string) => Promise<ReplayResult>;
  /** 心跳间隔覆盖（默认 SSE_HEARTBEAT_INTERVAL_MS）。 */
  heartbeatMs?: number;
}

/** 已建立的 SSE 流句柄：可继续推业务帧（Phase 3 跟流用）+ 停止。 */
export interface SseStreamHandle {
  /** 推一帧业务事件（progress/item-appended/error/done…）。 */
  push: (frame: { id?: string; event: SSEEventType; payload: unknown }) => void;
  stop: () => void;
}

/**
 * 启动一条 SSE 流：写 SSE 响应头 → 按 Last-Event-ID 协议下发首帧 → 启心跳 → 返回句柄。
 *   - 有 Last-Event-ID 且 replaySince 判定在窗口内 → 直接补发增量（不重推 snapshot，脊柱 §5.4）。
 *   - 否则（无 id / 超窗 / 未接 Streams）→ 先推 state_snapshot 重置（脊柱 §5.2），再续流。
 * 鉴权/owner 校验须在调用前由路由 requireSseAuth preHandler + handler 完成（建流前 HTTP 失败，脊柱 §11.C）。
 */
export async function startSseStream(
  req: FastifyRequest,
  reply: FastifyReply,
  opts: SseStreamOptions,
): Promise<SseStreamHandle> {
  // SSE 响应头：text/event-stream、关代理缓冲、长连（脊柱 §5.1）。
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx 关缓冲（脊柱 §5.1）
  });
  // 防止 fastify 继续接管这个已 hijack 的响应。
  reply.hijack();

  // —— 首帧协议（脊柱 §5.2 / §5.4）——
  let resumedInWindow = false;
  if (opts.lastEventId && opts.replaySince) {
    // 尝试窗口内补发增量（不重推 snapshot）。
    const replay = await opts.replaySince(opts.lastEventId);
    if (replay.inWindow) {
      resumedInWindow = true;
      for (const f of replay.frames) {
        writeSseFrame(reply, { id: f.id, event: f.event, payload: f.payload });
      }
    }
  }
  if (!resumedInWindow) {
    // 超窗 / 无 Last-Event-ID / 未接 Streams → 先 state_snapshot 重置（硬规则①③，刷新/重连不打回从头）。
    const snapshot = await opts.loadSnapshot();
    writeSseFrame(reply, { event: 'state_snapshot', payload: snapshot });
  }

  // 心跳（脊柱 §5.5）。
  const interval = opts.heartbeatMs ?? SSE_HEARTBEAT_INTERVAL_MS;
  const heartbeat = setInterval(() => {
    if (!reply.raw.writableEnded) writeHeartbeat(reply);
  }, interval);
  // 心跳定时器不应阻止进程退出（worker/优雅关闭）。
  if (typeof heartbeat.unref === 'function') heartbeat.unref();

  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearInterval(heartbeat);
    if (!reply.raw.writableEnded) reply.raw.end();
  };

  const push = (frame: { id?: string; event: SSEEventType; payload: unknown }): void => {
    if (stopped || reply.raw.writableEnded) return;
    writeSseFrame(reply, frame);
  };

  // 客户端断开 → 清理（防泄漏）。
  req.raw.on('close', stop);

  return { push, stop };
}
