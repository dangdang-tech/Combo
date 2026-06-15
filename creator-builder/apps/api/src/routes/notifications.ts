// 70 · 通知域路由（B-14 NotifyConsumer 产物的读写，70-events-infra §通知）。本期 501 占位。
//   - 通知读 / 未读数：requireAuth + handler owner 校验（只看自己的通知）。
//   - 标已读 / 全部已读：requireAuth + requireIdempotency（写命令带 key）。
import type { FastifyInstance } from 'fastify';
import { IdempotencyScope } from '@cb/shared';
import { requireAuth } from '../middleware/auth.js';
import { requireIdempotency } from '../middleware/idempotency.js';
import { registerEndpoints, type EndpointDecl } from './_helpers.js';

export const NOTIFICATION_ENDPOINTS: EndpointDecl[] = [
  { method: 'GET', url: '/notifications', preHandlers: [requireAuth()] },
  {
    method: 'POST',
    url: '/notifications/:notificationId/read',
    preHandlers: [requireAuth(), requireIdempotency(IdempotencyScope.NOTIFICATION_READ)],
  },
  {
    method: 'POST',
    url: '/notifications/read-all',
    preHandlers: [requireAuth(), requireIdempotency(IdempotencyScope.NOTIFICATION_READ_ALL)],
  },
  { method: 'GET', url: '/notifications/unread-count', preHandlers: [requireAuth()] },
];

export async function registerNotificationRoutes(scoped: FastifyInstance): Promise<void> {
  registerEndpoints(scoped, NOTIFICATION_ENDPOINTS);
}
