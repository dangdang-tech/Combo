// 10 · Auth / Logto 域路由（B-08，10-auth §3）。本期 501 占位，鉴权/方法/路径与契约一致。
//   GET  /auth/login    发起登录（302 跳 Logto）—— 无鉴权
//   GET  /auth/callback OIDC 回调换会话（302 回站内，失败带 opaque failureId）—— 无鉴权（GET，OAuth code/state 自带一次性）
//   POST /auth/logout   登出（10-auth §3.3：鉴权 Opt——已登录清会话/未登录幂等返成功，不被 401 拦）
//                       —— optionalAuth；脊柱 §4.1 唯一豁免 Idempotency-Key（会话销毁、无产物）
//   GET  /me            当前登录用户（10-auth §3.4）—— requireAuth
import type { FastifyInstance } from 'fastify';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { registerEndpoints, type EndpointDecl } from './_helpers.js';

export const AUTH_ENDPOINTS: EndpointDecl[] = [
  { method: 'GET', url: '/auth/login' }, // 无鉴权
  { method: 'GET', url: '/auth/callback' }, // 无鉴权（GET 回调）
  // logout = Opt 鉴权（10-auth §3.3/:145/:153）：未登录也应幂等命中 logout 语义、绝不先被 401 拦。
  { method: 'POST', url: '/auth/logout', preHandlers: [optionalAuth()] }, // Idempotency 豁免（§4.1）
  { method: 'GET', url: '/me', preHandlers: [requireAuth()] },
];

export async function registerAuthRoutes(scoped: FastifyInstance): Promise<void> {
  registerEndpoints(scoped, AUTH_ENDPOINTS);
}
