// 会话身份 / 登录守卫（B-08 接入）——接 GET /api/v1/me（requireAuth；匿名 401）。
//
// 四态收敛（永不裸转圈 / 绝不裸露错误码）：
//   loading → 「正在确认登录状态…」诚实加载文案（非工作台骨架、非 Wayne 外壳）。
//   anon    → 裸登录闸门（无创作者外壳/侧栏/账号）：人话 + 「去登录」（跳后端登录端点，带 returnTo）。
//   error   → 登录服务暂时不可用（503/500/403/网络）≠「请先登录」：人话 ErrorState + 「重试」重拉 /me，
//             绝不伪装成 anon 给错误的去登录动作，也绝不把 HTTP/状态码渲染到 UI（D1）。
//   authed  → 放行 <Outlet/>，且把真实 MeView 喂给外壳账号区（不再是 persona Wayne）。
//
// 401 与其它错误的区分只在内部按 HTTP status 判定：apiGet 抛的 ApiError 丢弃了 status，故这里用专用
// fetchMe()（fetch + credentials:'include' + 同 API_PREFIX）直接读 res.status，绝不把 status 漏到 UI。
//
// 登录是整页跳转：正式环境走后端 OIDC 端点；Cloud Review 走隔离的预览身份 bootstrap，
// 避免把评审用户送到生产 Logto，也避免 preview client 配置异常时裸露 OIDC JSON 错误页。
import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { API_PREFIX, MeViewSchema, envelopeSchema, type MeView } from '@cb/shared';
import { ComboWordmark } from './brand.js';

/** /me 200 包络 schema：与后端一致返回 Envelope<MeView>（{ data, meta? }），解析后读 .data。 */
const MeEnvelopeSchema = envelopeSchema(MeViewSchema);

/** 后端登录入口（302 跳 Logto）。非 SPA 路由：用 window.location.assign 整页跳转。 */
export const AUTH_LOGIN_PATH = '/api/v1/auth/login';

/** Cloud Review 受访问闸保护的预览身份入口；只在 preview 构建中使用。 */
export const REVIEW_BOOTSTRAP_PATH = '/__review/bootstrap';

/** 构建环境判定保持为函数，便于测试覆盖，也避免主环境误走预览身份。 */
export function isCloudReviewEnvironment(): boolean {
  return import.meta.env.VITE_DEPLOY_ENV?.trim().toLowerCase() === 'preview';
}

/**
 * 拼后端登录 URL：给了 returnTo（站内相对路径）则带 ?returnTo=<encoded>，否则裸路径。
 * 后端对 returnTo 做开放重定向防护 / 站内白名单（缺省回 /creator），前端只负责诚实携带当前访问上下文，
 * 让登录后回到原页（深链 /create/...?draftId=... 不丢、公开/个人页不被默认踢回 /creator）。
 */
export function loginUrl(returnTo?: string): string {
  const entryPath = isCloudReviewEnvironment() ? REVIEW_BOOTSTRAP_PATH : AUTH_LOGIN_PATH;
  // 仅接受同站相对路径（单个 / 开头）：挡掉绝对 http(s):// 与协议相对 //（前端侧第一道开放重定向防护，
  // 后端仍做白名单兜底）。非法 returnTo 直接丢弃，回裸登录路径而非把不可信跳转目标带给后端。
  if (!returnTo || !returnTo.startsWith('/') || returnTo.startsWith('//')) return entryPath;
  return `${entryPath}?returnTo=${encodeURIComponent(returnTo)}`;
}

/** 跳转后端登录端点（整页重定向；非 react-router 导航）。可带 returnTo 站内回跳路径。 */
export function goToLogin(returnTo?: string): void {
  window.location.assign(loginUrl(returnTo));
}

/** 登录后回跳的「当前位置」：path + query（站内相对，后端再做开放重定向防护）。 */
function currentReturnTo(): string {
  return window.location.pathname + window.location.search;
}

/** /me 探针结果：按 HTTP status 收敛的四态之一（status 只在内部用，绝不渲染到 UI）。 */
export type MeProbe = { status: 'authed'; me: MeView } | { status: 'anon' } | { status: 'error' };

/**
 * 专用 /me 探针：直接读 res.status 区分 401（anon）与其它错误（error），apiGet 的 ApiError 会丢 status 故不用。
 *   200 → authed（按 shared schema 解析 MeView；解析失败按 error 处理，不当成已登录）。
 *   401 → anon（真·未登录 / 会话过期，唯一该给「去登录」的情形）。
 *   其它（403 disabled / 500 / 503 登录服务不可用 / 网络）→ error（人话 + 重试，绝非「请先登录」）。
 * 与 client.ts 一致：同 API_PREFIX、credentials:'include'。status 只在本函数内消费，外部只见四态。
 */
export async function fetchMe(signal?: AbortSignal): Promise<MeProbe> {
  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}/me`, {
      method: 'GET',
      credentials: 'include',
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    // 网络层失败 / abort：abort 透传给 react-query（不当成 error 态），其余按 error 收敛。
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    return { status: 'error' };
  }
  if (res.status === 401) return { status: 'anon' };
  if (!res.ok) return { status: 'error' };
  try {
    // 后端 /me 返回轻包络 Envelope<MeView>（{ data, meta? }，见 auth-handlers.ts），先解包再校验，读 .data。
    const body = (await res.json()) as unknown;
    return { status: 'authed', me: MeEnvelopeSchema.parse(body).data };
  } catch {
    // 200 但 body 不是合法 Envelope<MeView>：不冒充已登录，按 error 收敛（给重试，不给去登录）。
    return { status: 'error' };
  }
}

/**
 * /me 拉取：探针自身把 401/其它错误收敛成 MeProbe（不抛），故任一结果都是「成功 resolve 一个态」。
 * retry:false——单次尝试即定四态，绝不裸自旋（401/其它错误都不该重试探针）。身份变更不频繁，缓存几分钟。
 */
export function useMe(): ReturnType<typeof useQuery<MeProbe>> {
  return useQuery<MeProbe>({
    queryKey: ['me'],
    queryFn: ({ signal }) => fetchMe(signal),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export type AuthStatus = 'loading' | 'authed' | 'anon' | 'error';

export interface AuthState {
  status: AuthStatus;
  me: MeView | null;
  /** 重拉 /me（error 态「重试」用；非去登录——它不是认证失败）。 */
  refetch: () => void;
}

const AuthContext = createContext<AuthState>({
  status: 'loading',
  me: null,
  refetch: () => {},
});

/** 全局会话身份 Provider：把 /me 探针四态收敛成 {status, me}，供守卫与外壳消费。 */
export function AuthProvider({ children }: { children: ReactNode }): ReactElement {
  const q = useMe();
  const refetch = (): void => {
    void q.refetch();
  };
  // 探针不抛错（abort 除外），故四态来自 isPending + probe.status；isError 极罕见（abort 等）按 error 兜底。
  const state: AuthState = q.isPending
    ? { status: 'loading', me: null, refetch }
    : q.isError || !q.data
      ? { status: 'error', me: null, refetch }
      : q.data.status === 'authed'
        ? { status: 'authed', me: q.data.me, refetch }
        : { status: q.data.status, me: null, refetch };
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

/** 加载态：诚实文案（非工作台骨架、非 Wayne 外壳），有限态、不裸转圈。 */
function AuthGateFrame({
  message,
  role,
  children,
  live,
}: {
  message: string;
  role: 'status' | 'alert';
  children?: ReactNode;
  live?: 'polite';
}): ReactElement {
  return (
    <div className="cb-auth-gate" role={role} aria-live={live}>
      <section className="cb-auth-gate__panel" aria-label="登录状态">
        <div className="cb-auth-gate__brand" aria-hidden="true">
          <ComboWordmark className="cb-auth-gate__brand-word" />
        </div>
        <p className="cb-auth-gate__eyebrow">COMBO · CREATOR</p>
        <p className="cb-auth-gate__msg">{message}</p>
        {children ? <div className="cb-auth-gate__actions">{children}</div> : null}
      </section>
    </div>
  );
}

function AuthLoading(): ReactElement {
  return <AuthGateFrame role="status" live="polite" message="正在确认登录状态…" />;
}

/** 匿名闸门：裸页（无创作者外壳/侧栏/账号），人话 + 「去登录」（带 returnTo 回当前页）。 */
function AuthLoginGate(): ReactElement {
  const isCloudReview = isCloudReviewEnvironment();
  return (
    <AuthGateFrame
      role="alert"
      message={
        isCloudReview ? '预览身份已失效，请重新进入云端评审。' : '请先登录后进入创作者中心。'
      }
    >
      <button
        type="button"
        className="cb-auth-gate__action"
        onClick={() => goToLogin(currentReturnTo())}
      >
        {isCloudReview ? '重新进入预览' : '去登录'}
      </button>
    </AuthGateFrame>
  );
}

/**
 * 错误闸门：登录状态暂时确认不了（登录服务不可用 / 后端异常 / 网络）——不是「请先登录」。
 * 人话 + 「重试」重拉 /me（非去登录 CTA），绝不裸露 HTTP/状态码（D1）。
 */
function AuthErrorGate({ onRetry }: { onRetry: () => void }): ReactElement {
  return (
    <AuthGateFrame role="alert" message="暂时无法确认登录状态，请稍后重试。">
      <button type="button" className="cb-auth-gate__action" onClick={onRetry}>
        重试
      </button>
    </AuthGateFrame>
  );
}

/**
 * 路由守卫元素：authed → <Outlet/>；loading → 诚实加载页；anon → 登录闸门；error → 错误闸门（重试，非去登录）。
 * 仅放行已登录用户进创作者外壳——一举堵住未登录看到 Wayne 外壳 / 仪表盘 401 裸转圈 / 受保护页直达 /
 * /create 未登录自动 POST 草稿（向导根本不挂载）。登录服务故障时不再被伪装成「请先登录」。
 */
export function RequireAuth(): ReactElement {
  const { status, refetch } = useAuth();
  if (status === 'loading') return <AuthLoading />;
  if (status === 'anon') return <AuthLoginGate />;
  if (status === 'error') return <AuthErrorGate onRetry={refetch} />;
  return <Outlet />;
}
