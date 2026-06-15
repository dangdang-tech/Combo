// Typed API client（F-01）——消费 @cb/shared 的契约真源。
//
// 三条硬规则在客户端层的落地：
//   1. 绝不裸露错误码：所有非 2xx → 解析为 ErrorEnvelope，UI 只读 userMessage + action（见 ApiError）。
//   2. 永不裸转圈：本层只负责取数与抛错；加载态/进度由组件层（components/）承担。
//   3. 已生成内容不丢：写命令统一注入 Idempotency-Key（幂等可安全重放），scope 取自 shared 常量表。
//
// 轻包络 { data, meta }（脊柱 §2）：成功解包 data，meta 经 requestEnvelope 暴露给需要分页/占位语义的调用方。
import {
  API_PREFIX,
  type Envelope,
  type Meta,
  type ErrorEnvelope,
  type ErrorBody,
  type IdempotencyScopeValue,
  type IdempotencyOptionalScopeValue,
} from '@cb/shared';

/** 写命令注入的 Idempotency scope（必带 22 项之一，或带体只读 POST 的可选 scope）。 */
export type IdempotencyScopeInput = IdempotencyScopeValue | IdempotencyOptionalScopeValue;

/**
 * 统一前端错误：内部承载完整对外 ErrorEnvelope（D1：不含 code），UI 只暴露人话 + action。
 * 渲染层应只读 `userMessage` / `action` / `retriable`；`traceId` 仅作「反馈代码」展示（非错误码）。
 */
export class ApiError extends Error {
  readonly envelope: ErrorEnvelope;

  constructor(envelope: ErrorEnvelope) {
    super(envelope.error.userMessage);
    this.name = 'ApiError';
    this.envelope = envelope;
  }

  /** 唯一可对 UI 渲染的人话。 */
  get userMessage(): string {
    return this.envelope.error.userMessage;
  }

  /** 退路动作：retry | change_input | escalate | wait | none。 */
  get action(): ErrorBody['action'] {
    return this.envelope.error.action;
  }

  get retriable(): boolean {
    return this.envelope.error.retriable;
  }

  /** 关联日志 / Sentry，可作「反馈代码」展示——但它不是错误码，永不当主文案。 */
  get traceId(): string {
    return this.envelope.error.traceId;
  }
}

/**
 * 兜底信封：当后端未按契约返回（网络断、HTML 错误页、JSON 解析失败）时仍给人话 + 退路。
 * 对外信封形态（D1）：不含 code —— 内部 code 仅日志侧存在，客户端兜底无 code 可言。
 */
function fallbackEnvelope(userMessage: string): ErrorEnvelope {
  return {
    error: {
      userMessage,
      retriable: true,
      action: 'retry',
      traceId: 'client-local',
    },
  };
}

/** 判断 body 是否形如 ErrorEnvelope（容错后端偶发非契约响应）。 */
function isErrorEnvelope(body: unknown): body is ErrorEnvelope {
  if (typeof body !== 'object' || body === null) return false;
  const err = (body as { error?: unknown }).error;
  if (typeof err !== 'object' || err === null) return false;
  return typeof (err as { userMessage?: unknown }).userMessage === 'string';
}

export interface RequestOptions {
  /** 查询参数（自动 URL 编码，undefined 值跳过）。 */
  query?: Record<string, string | number | boolean | undefined>;
  /** 写命令幂等 scope；提供即注入 Idempotency-Key 头（key 自动生成或用 idempotencyKey 覆盖）。 */
  scope?: IdempotencyScopeInput;
  /** 覆盖自动生成的幂等键（断点续传/重放同一逻辑操作时复用同一 key，保证「已生成内容不丢」）。 */
  idempotencyKey?: string;
  /** AbortSignal（组件卸载/取消请求）。 */
  signal?: AbortSignal;
  /** 额外请求头。 */
  headers?: Record<string, string>;
}

interface RawRequestOptions extends RequestOptions {
  method: string;
  body?: unknown;
}

/** 生成幂等键：优先 crypto.randomUUID，降级时间戳+随机（仅本地兜底）。 */
function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const base = path.startsWith('/api/') ? path : `${API_PREFIX}${path}`;
  if (!query) return base;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** 底层请求：解包 { data, meta }；非 2xx 统一抛 ApiError（永远带人话 + 退路）。 */
async function request<T>(path: string, opts: RawRequestOptions): Promise<Envelope<T>> {
  const headers: Record<string, string> = { ...opts.headers };
  const hasBody = opts.body !== undefined;
  if (hasBody) headers['Content-Type'] = 'application/json';

  // 写命令注入幂等键（脊柱 §4）：scope 决定 (scope,key) 唯一性；DELETE 不豁免。
  if (opts.scope) {
    headers['Idempotency-Key'] = opts.idempotencyKey ?? newIdempotencyKey();
    headers['X-Idempotency-Scope'] = opts.scope;
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method,
      credentials: 'include',
      headers,
      ...(hasBody ? { body: JSON.stringify(opts.body) } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (cause) {
    // 网络层失败（断网/被 abort）：abort 透传，其余包成人话信封。
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(fallbackEnvelope('网络好像不太稳，检查连接后重试。'));
  }

  // 204 / 空体：直接返回空 data 包络。
  if (res.status === 204) return { data: undefined as T };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    if (!res.ok) throw new ApiError(fallbackEnvelope('服务暂时没有正确响应，请稍后重试。'));
    return { data: undefined as T };
  }

  if (!res.ok) {
    if (isErrorEnvelope(body)) throw new ApiError(body);
    // 后端没按契约出信封时也绝不裸露状态码：兜底人话。
    throw new ApiError(fallbackEnvelope('服务开小差了，请稍后重试。'));
  }

  return body as Envelope<T>;
}

// ---------- 公共方法：默认解包 data；需要 meta（分页/占位）时用 *Envelope 版本 ----------

export async function apiGet<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  return (await request<T>(path, { ...opts, method: 'GET' })).data;
}

export async function apiGetEnvelope<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<{ data: T; meta?: Meta }> {
  return request<T>(path, { ...opts, method: 'GET' });
}

export async function apiPost<T>(
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  return (await request<T>(path, { ...opts, method: 'POST', body })).data;
}

export async function apiPatch<T>(
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  return (await request<T>(path, { ...opts, method: 'PATCH', body })).data;
}

export async function apiDelete<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  return (await request<T>(path, { ...opts, method: 'DELETE' })).data;
}
