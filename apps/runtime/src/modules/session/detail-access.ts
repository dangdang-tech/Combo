import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { Env } from '../../platform/config/env.js';
import { requireCreatorIdentity, resolveRuntimeOwnerId } from '../../platform/http/auth.js';
import { getSessionMode } from './repo.js';

export type SessionDetailAccess =
  | { kind: 'owner'; ownerId: string }
  | { kind: 'not_found' }
  | { kind: 'replied' };

/**
 * Session detail serves both anonymous consume sessions and creator-only trials.
 * Resolve the immutable mode first so an expired creator cookie cannot silently
 * fall back to an anonymous owner and turn an authentication failure into a 404.
 */
export async function resolveSessionDetailAccess(
  req: FastifyRequest,
  reply: FastifyReply,
  pool: Pool,
  env: Env,
  sessionId: string,
): Promise<SessionDetailAccess> {
  const mode = await getSessionMode(pool, sessionId);
  if (!mode) return { kind: 'not_found' };

  if (mode === 'trial') {
    const identity = await requireCreatorIdentity(req, reply, pool, env);
    return identity ? { kind: 'owner', ownerId: identity.userId } : { kind: 'replied' };
  }

  return {
    kind: 'owner',
    ownerId: await resolveRuntimeOwnerId(req, reply, pool, env),
  };
}
