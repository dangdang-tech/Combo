// 60 · 工作台 + 个人主页 + 社交域路由（B-30~B-35，60-dashboard-profile §3）。本期 501 占位。
//   - dashboard/*：requireAuth + handler owner 校验（私有经营数据，只对本人可见，10-auth §6.3）。
//   - creators/:id/profile + 公开读：optionalAuth（访客看公开名片不强制登录，主页-13）。
//   - 社交写（follow/like 及 DELETE 取消）：requireAuth（任意已登录用户，脊柱 §11.F）+ requireIdempotency。
import type { FastifyInstance } from 'fastify';
import { IdempotencyScope } from '@cb/shared';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { requireIdempotency } from '../middleware/idempotency.js';
import { registerEndpoints, type EndpointDecl } from './_helpers.js';

export const DASHBOARD_ENDPOINTS: EndpointDecl[] = [
  // 工作台（私有，requireAuth + owner）。
  { method: 'GET', url: '/dashboard/summary', preHandlers: [requireAuth()] },
  { method: 'GET', url: '/dashboard/metrics', preHandlers: [requireAuth()] },
  { method: 'GET', url: '/dashboard/token-trend', preHandlers: [requireAuth()] },
  { method: 'GET', url: '/dashboard/capabilities', preHandlers: [requireAuth()] },
  { method: 'GET', url: '/dashboard/drafts', preHandlers: [requireAuth()] },
  // 公开主页（optionalAuth，访客可看公开字段）。
  { method: 'GET', url: '/creators/:creatorId/profile', preHandlers: [optionalAuth()] },
  { method: 'GET', url: '/creators/:creatorId/capabilities', preHandlers: [optionalAuth()] },
  { method: 'GET', url: '/creators/:creatorId/heatmap', preHandlers: [optionalAuth()] },
  { method: 'GET', url: '/creators/:creatorId/network', preHandlers: [optionalAuth()] },
  { method: 'GET', url: '/creators/:creatorId/works', preHandlers: [optionalAuth()] },
  // 社交写：requireAuth（任意登录用户，脊柱 §11.F）+ Idempotency（POST/DELETE 都带 key）。
  {
    method: 'POST',
    url: '/creators/:creatorId/follows',
    preHandlers: [requireAuth(), requireIdempotency(IdempotencyScope.SOCIAL_FOLLOW)],
  },
  {
    method: 'DELETE',
    url: '/creators/:creatorId/follows',
    preHandlers: [requireAuth(), requireIdempotency(IdempotencyScope.SOCIAL_UNFOLLOW)],
  },
  {
    method: 'POST',
    url: '/capabilities/:capabilityId/likes',
    preHandlers: [requireAuth(), requireIdempotency(IdempotencyScope.SOCIAL_LIKE)],
  },
  {
    method: 'DELETE',
    url: '/capabilities/:capabilityId/likes',
    preHandlers: [requireAuth(), requireIdempotency(IdempotencyScope.SOCIAL_UNLIKE)],
  },
];

export async function registerDashboardRoutes(scoped: FastifyInstance): Promise<void> {
  registerEndpoints(scoped, DASHBOARD_ENDPOINTS);
}
