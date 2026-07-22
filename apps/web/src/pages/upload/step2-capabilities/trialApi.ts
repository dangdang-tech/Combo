import {
  IdempotencyScope,
  LatestTrialSessionResultSchema,
  SessionDetailSchema,
  type CreateCapabilityResult,
  type LatestTrialSessionResult,
  type PublicCapabilityView,
  type RuntimeSessionMeta,
  type SessionDetail,
  type StartStructureResult,
} from '@cb/shared';
import { apiPost } from '../../../api/index.js';
import { fetchMe, loginUrl } from '../../../shell/auth.js';

export interface CreateTrialSessionResult {
  session: RuntimeSessionMeta;
  capability: PublicCapabilityView;
}

let openTrialUrl = (url: string): void => window.location.assign(url);
let openTrialLoginUrl = (url: string): void => window.location.assign(url);

/**
 * Runtime trial 的 401 不是可重试的业务失败：用独立类型把它与 403/5xx 分开，
 * 让结果页跳转登录并保留当前创作深链，而不是把“登录态失效”当成 Agent 试用错误就地渲染。
 */
export class TrialAuthenticationRequiredError extends Error {
  constructor(message = '需要重新登录后继续试用。') {
    super(message);
    this.name = 'TrialAuthenticationRequiredError';
  }
}

/** Authoring 仍已登录、但 Runtime 不认会话时的安全降级；不能再跳登录造成循环。 */
export class TrialAuthenticationServiceError extends Error {
  constructor() {
    super('试用服务暂时无法确认登录状态，请稍后重试。');
    this.name = 'TrialAuthenticationServiceError';
  }
}

export type TrialAuthenticationResolution =
  | { kind: 'redirected' }
  | { kind: 'render'; error: unknown };

export function openRuntimeTrial(url: string): void {
  openTrialUrl(url);
}

export function __setOpenRuntimeTrialForTests(fn: (url: string) => void): () => void {
  const previous = openTrialUrl;
  openTrialUrl = fn;
  return () => {
    openTrialUrl = previous;
  };
}

/**
 * Runtime 返 401 后先以 Authoring `/me` 作会话真源复核：
 *   - `/me` 也是 401：真会话过期，跳登录并带回创作深链；
 *   - `/me` 仍已登录或无法确认：是服务间鉴权分裂/异常，绝不再跳登录造成循环。
 */
export async function resolveTrialAuthenticationError(
  error: unknown,
  returnTo: string,
): Promise<TrialAuthenticationResolution> {
  if (!(error instanceof TrialAuthenticationRequiredError)) return { kind: 'render', error };
  const me = await fetchMe();
  if (me.status === 'anon') {
    openTrialLoginUrl(loginUrl(returnTo));
    return { kind: 'redirected' };
  }
  return { kind: 'render', error: new TrialAuthenticationServiceError() };
}

export function __setOpenTrialLoginForTests(fn: (url: string) => void): () => void {
  const previous = openTrialLoginUrl;
  openTrialLoginUrl = fn;
  return () => {
    openTrialLoginUrl = previous;
  };
}

export function createCapabilityForTrial(
  candidateId: string,
  draftId?: string,
): Promise<CreateCapabilityResult> {
  return apiPost<CreateCapabilityResult>(
    '/capabilities',
    { sourceCandidateId: candidateId, ...(draftId ? { draftId } : {}) },
    {
      scope: IdempotencyScope.CAPABILITY_CREATE,
      idempotencyKey: `trial:create:v2:${draftId ?? 'nodraft'}:${candidateId}`,
    },
  );
}

export function startStructureForTrial(versionId: string): Promise<StartStructureResult> {
  return apiPost<StartStructureResult>(
    `/versions/${encodeURIComponent(versionId)}/structure`,
    {},
    {
      scope: IdempotencyScope.STRUCTURE_START,
      idempotencyKey: `trial:structure:${versionId}`,
    },
  );
}

export async function createRuntimeTrialSession(input: {
  capabilityId: string;
  versionId: string;
  sourceVersionId?: string;
  title: string;
}): Promise<CreateTrialSessionResult> {
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/runtime/trial-chains/${encodeURIComponent(input.capabilityId)}/sessions`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          versionId: input.versionId,
          ...(input.sourceVersionId ? { sourceVersionId: input.sourceVersionId } : {}),
          title: input.title,
        }),
      },
    );
  } catch {
    throw new Error('网络好像不太稳，检查连接后重试。');
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }

  if (!res.ok) {
    const userMessage =
      body &&
      typeof body === 'object' &&
      'error' in body &&
      typeof (body as { error?: { userMessage?: unknown } }).error?.userMessage === 'string'
        ? (body as { error: { userMessage: string } }).error.userMessage
        : '没能打开试用，请稍后重试。';
    if (res.status === 401) throw new TrialAuthenticationRequiredError(userMessage);
    throw new Error(userMessage);
  }

  return body as CreateTrialSessionResult;
}

/**
 * Runtime 的详情端点返回裸 SessionDetail（不是 authoring 的 {data} 包络），因此这里走专用 raw fetch。
 * 保留给需要完整消息/产物的兼容调用；结果页恢复只取 latest-session 的轻量 SessionMeta。
 */
export async function fetchRuntimeTrialSession(sessionId: string): Promise<SessionDetail> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/runtime/sessions/${encodeURIComponent(sessionId)}`, {
      credentials: 'include',
    });
  } catch {
    throw new Error('网络好像不太稳，暂时无法确认试用结果。');
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }

  if (!res.ok) {
    const userMessage =
      body &&
      typeof body === 'object' &&
      'error' in body &&
      typeof (body as { error?: { userMessage?: unknown } }).error?.userMessage === 'string'
        ? (body as { error: { userMessage: string } }).error.userMessage
        : '暂时无法确认试用结果，请稍后重试。';
    if (res.status === 401) throw new TrialAuthenticationRequiredError(userMessage);
    throw new Error(userMessage);
  }

  const parsed = SessionDetailSchema.safeParse(body);
  if (!parsed.success) throw new Error('试用结果还没有准备完整，请稍后重试。');
  return parsed.data;
}

/**
 * 读取某个候选版本最近可继续的试用。Runtime 同时返回 verified，表示服务端已核对
 * owner、精确版本/manifest、completed run 与有效 assistant 输出。这里只取轻量 SessionMeta，
 * 避免结果页为了恢复入口下载完整 messages/artifacts。
 */
export async function fetchLatestRuntimeTrialSession(input: {
  capabilityId: string;
  versionId: string;
  sessionId?: string;
}): Promise<LatestTrialSessionResult> {
  const params = new URLSearchParams({ versionId: input.versionId });
  if (input.sessionId) params.set('sessionId', input.sessionId);

  let res: Response;
  try {
    res = await fetch(
      `/api/v1/runtime/trial-chains/${encodeURIComponent(input.capabilityId)}/latest-session?${params.toString()}`,
      { credentials: 'include' },
    );
  } catch {
    throw new Error('网络好像不太稳，暂时无法恢复试用记录。');
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }

  if (!res.ok) {
    const userMessage =
      body &&
      typeof body === 'object' &&
      'error' in body &&
      typeof (body as { error?: { userMessage?: unknown } }).error?.userMessage === 'string'
        ? (body as { error: { userMessage: string } }).error.userMessage
        : '暂时无法恢复试用记录，请稍后重试。';
    if (res.status === 401) throw new TrialAuthenticationRequiredError(userMessage);
    throw new Error(userMessage);
  }

  const parsed = LatestTrialSessionResultSchema.safeParse(body);
  if (!parsed.success) throw new Error('试用记录还没有准备完整，请稍后重试。');
  return parsed.data;
}
