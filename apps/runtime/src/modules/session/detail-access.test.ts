import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../platform/config/env.js';
import type { RuntimeAuthIdentity } from '../../platform/http/auth.js';
import { resolveSessionDetailAccess } from './detail-access.js';

const repoMocks = vi.hoisted(() => ({ getSessionMode: vi.fn() }));
const authMocks = vi.hoisted(() => ({
  requireCreatorIdentity: vi.fn(),
  resolveRuntimeOwnerId: vi.fn(),
}));

vi.mock('./repo.js', () => repoMocks);
vi.mock('../../platform/http/auth.js', () => authMocks);

const req = {} as FastifyRequest;
const reply = {} as FastifyReply;
const pool = {} as Pool;
const env = { NODE_ENV: 'test' } as Env;

describe('resolveSessionDetailAccess', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires creator identity for trial detail and never falls back to anonymous owner', async () => {
    repoMocks.getSessionMode.mockResolvedValue('trial');
    authMocks.requireCreatorIdentity.mockResolvedValue(null);

    await expect(resolveSessionDetailAccess(req, reply, pool, env, 'trial-1')).resolves.toEqual({
      kind: 'replied',
    });
    expect(authMocks.requireCreatorIdentity).toHaveBeenCalledWith(req, reply, pool, env);
    expect(authMocks.resolveRuntimeOwnerId).not.toHaveBeenCalled();
  });

  it('uses the authenticated creator owner for trial detail', async () => {
    repoMocks.getSessionMode.mockResolvedValue('trial');
    authMocks.requireCreatorIdentity.mockResolvedValue({
      userId: 'creator-1',
      roles: ['creator'],
      account: 'creator',
    } satisfies RuntimeAuthIdentity);

    await expect(resolveSessionDetailAccess(req, reply, pool, env, 'trial-1')).resolves.toEqual({
      kind: 'owner',
      ownerId: 'creator-1',
    });
  });

  it('keeps anonymous owner fallback for consume session detail', async () => {
    repoMocks.getSessionMode.mockResolvedValue('consume');
    authMocks.resolveRuntimeOwnerId.mockResolvedValue('anonymous-owner');

    await expect(resolveSessionDetailAccess(req, reply, pool, env, 'consume-1')).resolves.toEqual({
      kind: 'owner',
      ownerId: 'anonymous-owner',
    });
    expect(authMocks.requireCreatorIdentity).not.toHaveBeenCalled();
  });

  it('returns not_found before selecting an auth strategy for an unknown session', async () => {
    repoMocks.getSessionMode.mockResolvedValue(null);

    await expect(resolveSessionDetailAccess(req, reply, pool, env, 'missing')).resolves.toEqual({
      kind: 'not_found',
    });
    expect(authMocks.requireCreatorIdentity).not.toHaveBeenCalled();
    expect(authMocks.resolveRuntimeOwnerId).not.toHaveBeenCalled();
  });
});
