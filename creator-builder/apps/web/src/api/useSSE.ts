// useSSE（F-02）——按 @cb/shared SSE 帧协议（脊柱 §5）消费事件流。
//
// 核心契约落地：
//   - 首帧 state_snapshot 初始化全量态（kind=job → ProgressView；kind=structure → StructureState）。
//   - Last-Event-ID 重连：记录每帧 id（= Redis Stream entry id），断线自动重连续传，超窗后端重发 state_snapshot。
//   - 心跳：heartbeat 帧用于探活，超过 2× 间隔无任何帧 → 主动重连。
//   - error 帧：完整对外 ErrorEnvelope（`{ error: {...} }`，Codex#2 / D1，不含 code），
//     与非 2xx HTTP body 同形态；解包出内层 ErrorBody，UI 只读 userMessage + action。
//   - done 帧：终止信号；命中后停止重连。
//
// 注意：结构化 SSE 走同源 Cookie（脊柱 §11.C，禁 query/header token）。浏览器原生 EventSource 不带
// Last-Event-ID 之外的自定义头，但它在重连时会自动回传 Last-Event-ID——正合协议。鉴权靠同源 Cookie。
import { useEffect, useReducer, useRef } from 'react';
import {
  SSE_HEARTBEAT_INTERVAL_MS,
  type SSEEventType,
  type SSEStreamKind,
  type StateSnapshotPayload,
  type ProgressView,
  type StructureState,
  type ProgressPayload,
  type FieldStuckPayload,
  type SlowHintPayload,
  type DonePayload,
  type ErrorBody,
  type ErrorFramePayload,
} from '@cb/shared';

/** 连接级状态机：UI 据此区分「连接中 / 流动中 / 已完成 / 错误 / 重连中」，永不裸转圈。 */
export type SSEConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'done' | 'error';

export interface UseSSEState {
  kind: SSEStreamKind;
  status: SSEConnectionStatus;
  /** kind=job 全量进度真源（state_snapshot + progress 帧合并）。 */
  progress?: ProgressView;
  /** kind=structure 字段级真源（state_snapshot + field_* 帧合并）。 */
  structureState?: StructureState;
  /** field_stuck：字段卡住三退路（continue/regen/wait）。 */
  stuck?: FieldStuckPayload;
  /** slow_hint：慢提示文案（不报错，只安抚）。 */
  slowHint?: SlowHintPayload;
  /** done 帧 payload（终止状态 + 结果/错误）。 */
  done?: DonePayload;
  /** error 帧或建流失败的完整人话信封；UI 只读 userMessage + action。 */
  error?: ErrorBody;
  /** 最近收到的帧 id（= Last-Event-ID，重连续传锚点）。 */
  lastEventId?: string;
  /** 边生成边显示：item-appended 累积的追加项（kind=job）。 */
  items: unknown[];
}

type Action =
  | { type: 'connecting' }
  | { type: 'open' }
  | { type: 'reconnecting' }
  | { type: 'frame'; event: SSEEventType; id: string; payload: unknown }
  | { type: 'localError'; error: ErrorBody };

/**
 * 从 error 帧 / done.error 的完整对外 ErrorEnvelope（Codex#2：`{ error: {...} }`）解包内层 ErrorBody。
 * 容错：若后端偶发发来裸 ErrorBody（带 userMessage），也认；都不像则给本地兜底人话（永不裸转圈/裸错）。
 */
function unwrapErrorBody(payload: unknown): ErrorBody {
  if (typeof payload === 'object' && payload !== null) {
    const env = payload as Partial<ErrorFramePayload> & { userMessage?: unknown };
    // 标准形态：完整 ErrorEnvelope。
    if (
      typeof env.error === 'object' &&
      env.error !== null &&
      typeof (env.error as { userMessage?: unknown }).userMessage === 'string'
    ) {
      return env.error as ErrorBody;
    }
    // 容错：裸 ErrorBody（非契约，但仍可安全展示人话）。
    if (typeof env.userMessage === 'string') {
      return payload as ErrorBody;
    }
  }
  return {
    userMessage: '出了点小问题，请重试。',
    retriable: true,
    action: 'retry',
    traceId: 'client-local',
  };
}

function reducer(state: UseSSEState, action: Action): UseSSEState {
  switch (action.type) {
    case 'connecting':
      return { ...state, status: 'connecting' };
    case 'open':
      // 重连成功后回到 open（done 已终止则保持 done）。
      return state.status === 'done' ? state : { ...state, status: 'open' };
    case 'reconnecting':
      return state.status === 'done' ? state : { ...state, status: 'reconnecting' };
    case 'localError':
      return { ...state, status: 'error', error: action.error };
    case 'frame': {
      const next: UseSSEState = { ...state, lastEventId: action.id };
      switch (action.event) {
        case 'state_snapshot': {
          // 全量重置：首帧或重连超窗。覆盖 progress/structureState，清掉过期的瞬时态。
          const p = action.payload as StateSnapshotPayload;
          next.status = 'open';
          if (p.progress) next.progress = p.progress;
          if (p.structureState) next.structureState = p.structureState;
          next.stuck = undefined;
          return next;
        }
        case 'progress': {
          const p = action.payload as ProgressPayload;
          const prev = state.progress;
          next.progress = {
            percent: p.percent,
            phrase: p.phrase,
            ...(p.done !== undefined ? { done: p.done } : {}),
            ...(p.total !== undefined ? { total: p.total } : {}),
            ...(p.unit !== undefined ? { unit: p.unit } : {}),
            subtasks: prev?.subtasks ?? [],
            ...(prev?.items !== undefined ? { items: prev.items } : {}),
          };
          next.slowHint = undefined;
          return next;
        }
        case 'subtask': {
          // subtask 帧增量更新子任务清单（按 key 合并），无 progress 则忽略。
          const sub = action.payload as { key: string; label: string; status: string };
          if (next.progress) {
            const subtasks = next.progress.subtasks.slice();
            const idx = subtasks.findIndex((s) => s.key === sub.key);
            const entry = {
              key: sub.key,
              label: sub.label,
              status: sub.status as ProgressView['subtasks'][number]['status'],
            };
            if (idx >= 0) subtasks[idx] = entry;
            else subtasks.push(entry);
            next.progress = { ...next.progress, subtasks };
          }
          return next;
        }
        case 'item-appended': {
          // 边生成边显示：累积追加项。
          next.items = [...state.items, action.payload];
          return next;
        }
        case 'field_start':
        case 'field_delta':
        case 'field_done': {
          // 字段流：按 field 合并进 structureState.fields（断点续传回显由 state_snapshot 兜底）。
          const f = action.payload as { field: string; status?: string; value?: unknown };
          const ss = state.structureState;
          if (ss) {
            const fields = ss.fields.slice();
            const idx = fields.findIndex((x) => x.field === f.field);
            const status = (
              action.event === 'field_done'
                ? 'done'
                : action.event === 'field_start'
                  ? 'generating'
                  : (f.status ?? fields[idx]?.status ?? 'generating')
            ) as StructureState['fields'][number]['status'];
            const entry: StructureState['fields'][number] = {
              field: f.field,
              status,
              ...(f.value !== undefined
                ? { value: f.value }
                : idx >= 0 && fields[idx]?.value !== undefined
                  ? { value: fields[idx]!.value }
                  : {}),
            };
            if (idx >= 0) fields[idx] = entry;
            else fields.push(entry);
            const doneCount = fields.filter(
              (x) => x.status === 'done' || x.status === 'locked',
            ).length;
            next.structureState = { ...ss, fields, doneCount };
          }
          if (action.event !== 'field_delta') next.stuck = undefined;
          return next;
        }
        case 'field_stuck': {
          next.stuck = action.payload as FieldStuckPayload;
          return next;
        }
        case 'slow_hint': {
          next.slowHint = action.payload as SlowHintPayload;
          return next;
        }
        case 'error': {
          // error 帧 = 完整对外 ErrorEnvelope（Codex#2：`{ error: {...} }`，不含 code）。
          // 解包出内层 ErrorBody；UI 只读 userMessage + action。
          next.status = 'error';
          next.error = unwrapErrorBody(action.payload);
          return next;
        }
        case 'done': {
          // done 帧 = 终止信号。失败终态时 payload.error 携完整对外 ErrorEnvelope（Codex#2，不含 code），
          // 解包进 state.error 让统一错误态一处通吃（HTTP / error 帧 / done 失败同一渲染路径）。
          const d = action.payload as DonePayload;
          next.done = d;
          if (d.error) {
            next.status = 'error';
            next.error = unwrapErrorBody(d.error);
          } else {
            next.status = 'done';
          }
          return next;
        }
        case 'heartbeat':
          // 探活帧：不改业务态，仅刷新 lastEventId（已在上面做）+ 看门狗在 effect 里复位。
          return next;
        default:
          return next;
      }
    }
    default:
      return state;
  }
}

export interface UseSSEOptions {
  /** false 时不建流（如 jobId 尚未就绪）。 */
  enabled?: boolean;
}

/** 全部 12 帧类型（监听器逐个 addEventListener；EventSource 默认 message 不覆盖具名事件）。 */
const SSE_LISTEN_EVENTS: SSEEventType[] = [
  'state_snapshot',
  'progress',
  'subtask',
  'item-appended',
  'field_start',
  'field_delta',
  'field_done',
  'field_stuck',
  'slow_hint',
  'error',
  'done',
  'heartbeat',
];

/**
 * 订阅一条 SSE 流（job 或 structure）。
 * @param url   SSE 端点（用 shared 的 SSE_ROUTES.jobEvents / structureEvents 构造）。
 * @param kind  流类型，决定 state_snapshot 解析哪一型。
 */
export function useSSE(
  url: string | null,
  kind: SSEStreamKind,
  options: UseSSEOptions = {},
): UseSSEState {
  const enabled = options.enabled !== false && !!url;

  const [state, dispatch] = useReducer(reducer, {
    kind,
    status: 'connecting',
    items: [],
  } satisfies UseSSEState);

  // 看门狗：超过 2× 心跳间隔无任何帧 → 强制重连（EventSource 自身重连不可靠时兜底）。
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!enabled || !url) return;

    doneRef.current = false;
    let es: EventSource | null = null;
    let closed = false;

    const armWatchdog = () => {
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      watchdogRef.current = setTimeout(() => {
        if (closed || doneRef.current) return;
        // 超时无帧：主动重建（EventSource.close + 新建，触发服务端按 Last-Event-ID 续传）。
        dispatch({ type: 'reconnecting' });
        reconnect();
      }, SSE_HEARTBEAT_INTERVAL_MS * 2);
    };

    const open = () => {
      // withCredentials：同源 Cookie 鉴权（脊柱 §11.C）。
      es = new EventSource(url, { withCredentials: true });
      dispatch({ type: 'connecting' });

      es.onopen = () => {
        dispatch({ type: 'open' });
        armWatchdog();
      };

      es.onerror = () => {
        if (closed || doneRef.current) return;
        // 浏览器会自动按 Last-Event-ID 重连；标记 UI 为 reconnecting（永不裸转圈）。
        dispatch({ type: 'reconnecting' });
        armWatchdog();
      };

      for (const evt of SSE_LISTEN_EVENTS) {
        es.addEventListener(evt, (e: MessageEvent) => {
          armWatchdog();
          let payload: unknown = e.data;
          try {
            payload = e.data ? JSON.parse(e.data as string) : undefined;
          } catch {
            // 非 JSON data（理论上不应发生）：保留原始字符串，不致命。
          }
          dispatch({ type: 'frame', event: evt, id: e.lastEventId, payload });
          if (evt === 'done') {
            doneRef.current = true;
            cleanup();
          }
        });
      }
    };

    const reconnect = () => {
      if (es) es.close();
      es = null;
      open();
    };

    const cleanup = () => {
      closed = true;
      if (watchdogRef.current) {
        clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
      }
      if (es) {
        es.close();
        es = null;
      }
    };

    open();
    return cleanup;
  }, [url, enabled]);

  return state;
}
