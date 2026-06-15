// 30 · 提取域路由（B-22/B-23，30-step2-extract §3）。本期 501 占位。
//   - extract / candidate.retry：requireRole('creator') + requireIdempotency。
//   - candidate 读：requireAuth + handler owner 校验。
import type { FastifyInstance } from 'fastify';
import { IdempotencyScope } from '@cb/shared';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { requireIdempotency } from '../middleware/idempotency.js';
import { registerEndpoints, type EndpointDecl } from './_helpers.js';

export const EXTRACT_ENDPOINTS: EndpointDecl[] = [
  {
    method: 'POST',
    url: '/snapshots/:snapshotId/extract',
    preHandlers: [requireRole('creator'), requireIdempotency(IdempotencyScope.EXTRACT_CREATE)],
  },
  { method: 'GET', url: '/extract-jobs/:jobId/candidates', preHandlers: [requireAuth()] },
  { method: 'GET', url: '/candidates/:candidateId', preHandlers: [requireAuth()] },
  { method: 'GET', url: '/candidates/:candidateId/evidence', preHandlers: [requireAuth()] },
  {
    method: 'POST',
    url: '/candidates/:candidateId/retry',
    preHandlers: [requireRole('creator'), requireIdempotency(IdempotencyScope.CANDIDATE_RETRY)],
  },
];

export async function registerExtractRoutes(scoped: FastifyInstance): Promise<void> {
  registerEndpoints(scoped, EXTRACT_ENDPOINTS);
}
