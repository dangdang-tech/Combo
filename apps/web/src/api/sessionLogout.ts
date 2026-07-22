import { API_PREFIX, LogoutResponseSchema, type LogoutResult } from '@cb/shared';

/** 后端幂等登出入口：撤销可识别会话并清除同一枚 HttpOnly Cookie。 */
export const AUTH_LOGOUT_PATH = `${API_PREFIX}/auth/logout`;

/**
 * 清理当前浏览器会话。失败返回 null，调用方保留菜单并提供可重试的人话错误。
 * 端点要求严格 JSON `{}`，不经过业务请求重放逻辑。
 */
export async function logoutSession(): Promise<LogoutResult | null> {
  try {
    const response = await fetch(AUTH_LOGOUT_PATH, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (!response.ok) return null;
    return LogoutResponseSchema.parse((await response.json()) as unknown).data;
  } catch {
    return null;
  }
}

/** 登出成功后整页回站内登录页，清掉当前前端内存中的身份与业务缓存。 */
export function completeLogout(
  _result: LogoutResult,
  navigate: (url: string) => void = (url) => window.location.assign(url),
): void {
  navigate('/login');
}
