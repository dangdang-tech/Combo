// 脊柱通用 · jobs SSE 流 + 取消（脊柱 §5/§6）。
//   - GET /jobs/:jobId/events SSE：requireSseAuth（同源 Cookie，禁 Authorization/query token，脊柱 §11.C）
//     + 建流前 owner 校验（jobSseHandler 内查库，缺 404/非 owner 403）。真实 text/event-stream：
//     首帧 state_snapshot + 15s 心跳 + Last-Event-ID 恢复协议；业务事件源 Phase 3 接 Redis Streams。
//   - POST /jobs/:jobId/cancel：requireAuth + requireIdempotency（标 cancelled + 换 fence，脊柱 §6.1）。本期 501 占位。
import type { FastifyInstance } from 'fastify';
import { IdempotencyScope } from '@cb/shared';
import { requireAuth, requireSseAuth } from '../middleware/auth.js';
import { requireIdempotency } from '../middleware/idempotency.js';
import { registerEndpoints, type EndpointDecl } from './_helpers.js';
import { jobSseHandler } from './_sse.js';

export const JOB_ENDPOINTS: EndpointDecl[] = [
  // SSE job 流：建流前 HTTP 鉴权（脊柱 §11.C，同源 Cookie、禁 query/Authorization token）+ owner 校验。
  {
    method: 'GET',
    url: '/jobs/:jobId/events',
    preHandlers: [requireSseAuth()],
    handler: jobSseHandler(),
  },
  {
    method: 'POST',
    url: '/jobs/:jobId/cancel',
    preHandlers: [requireAuth(), requireIdempotency(IdempotencyScope.JOB_CANCEL)],
  },
];

export async function registerJobRoutes(scoped: FastifyInstance): Promise<void> {
  registerEndpoints(scoped, JOB_ENDPOINTS);
}
