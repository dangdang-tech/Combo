import { sanitizeAuthReturnTo } from '@cb/shared';

/** 同站 React 登录页；authoring 在该页签发 authoring 与 runtime 共用的 HttpOnly Cookie。 */
export const AUTH_LOGIN_PATH = '/login';

/**
 * 未登录时整页进入自定义登录页，并只携带共享白名单允许的 runtime 深链。
 * 可注入 returnTo 便于单测；生产默认读取当前 path 与 query。
 */
export function loginUrl(returnTo?: string): string {
  const current = returnTo ?? `${window.location.pathname}${window.location.search}`;
  const target = sanitizeAuthReturnTo(current);
  return `${AUTH_LOGIN_PATH}?returnTo=${encodeURIComponent(target)}`;
}

/** 单次写请求收到 401 时整页进入自定义登录页，不重放原请求。 */
export function goToLogin(
  returnTo?: string,
  navigate: (url: string) => void = (url) => window.location.assign(url),
): void {
  navigate(loginUrl(returnTo));
}
