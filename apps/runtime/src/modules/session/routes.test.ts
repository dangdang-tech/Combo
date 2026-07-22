import Fastify from 'fastify';
import type { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeContext } from '../../bootstrap/context.js';
import type * as SessionRepoModule from './repo.js';
import type * as StudioRepoModule from '../studio/repo.js';

vi.mock('../../platform/http/auth.js', () => ({
  requireCreatorIdentity: vi.fn(),
  resolveRuntimeOwnerId: vi.fn(),
}));
vi.mock('../agent/compose-prompt.js', () => ({ composeSystemPrompt: vi.fn(() => 'system') }));
vi.mock('../capability/loader.js', () => ({
  getCreatorCapabilityVersionForStudioSource: vi.fn(),
  getCreatorCapabilityVersionForTrial: vi.fn(),
  getPublishedCapability: vi.fn(),
}));
vi.mock('./repo.js', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionRepoModule>();
  return {
    ...actual,
    archiveSession: vi.fn(),
    createSession: vi.fn(),
    findStudioTrialSessionForVersion: vi.fn(),
  };
});
vi.mock('../studio/repo.js', async (importOriginal) => {
  const actual = await importOriginal<typeof StudioRepoModule>();
  return { ...actual, forkLatestStudioRevision: vi.fn() };
});

import { requireCreatorIdentity } from '../../platform/http/auth.js';
import {
  getCreatorCapabilityVersionForStudioSource,
  getCreatorCapabilityVersionForTrial,
} from '../capability/loader.js';
import { forkLatestStudioRevision } from '../studio/repo.js';
import { archiveSession, createSession, findStudioTrialSessionForVersion } from './repo.js';
import { registerSessionRoutes } from './routes.js';

const capabilityId = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
const sourceVersionId = '33333333-3333-4333-8333-333333333333';
const sessionId = '44444444-4444-4444-8444-444444444444';

const session = {
  id: sessionId,
  capabilityId,
  slug: 'agent-one',
  version: '0.1.0',
  mode: 'trial' as const,
  title: 'Agent One 设计',
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
};

function loadedTarget(status: 'draft' | 'published' = 'draft') {
  return {
    view: {
      capabilityId,
      version: '0.1.0',
      status,
      manifestHash: 'current-hash',
    },
    publicView: { capabilityId, slug: 'agent-one', name: 'Agent One' },
  };
}

function context(): RuntimeContext {
  const client = {
    query: vi.fn(async () => ({ rows: [] })),
    release: vi.fn(),
  };
  return {
    env: {} as RuntimeContext['env'],
    pool: { connect: vi.fn(async () => client) } as unknown as Pool,
    runControls: new Map(),
  };
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await registerSessionRoutes(app, context());
  return app;
}

describe('POST /runtime/studio/trial-chains/:capabilityId/session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCreatorIdentity).mockResolvedValue({
      userId: 'creator-1',
      roles: ['creator'],
      account: 'creator',
    });
    vi.mocked(getCreatorCapabilityVersionForTrial).mockResolvedValue(loadedTarget() as never);
    vi.mocked(findStudioTrialSessionForVersion).mockResolvedValue(null);
    vi.mocked(createSession).mockResolvedValue(session);
    vi.mocked(forkLatestStudioRevision).mockResolvedValue(null);
    vi.mocked(archiveSession).mockResolvedValue(true);
  });

  it('resumes only the exact durable Studio returned by the Studio lookup', async () => {
    vi.mocked(findStudioTrialSessionForVersion).mockResolvedValue(session);
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: `/runtime/studio/trial-chains/${capabilityId}/session`,
      payload: { versionId },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      session,
      capability: loadedTarget().publicView,
    });
    expect(findStudioTrialSessionForVersion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ownerId: 'creator-1',
        capabilityId,
        version: '0.1.0',
        manifestHash: 'current-hash',
      }),
    );
    expect(createSession).not.toHaveBeenCalled();
    expect(forkLatestStudioRevision).not.toHaveBeenCalled();
  });

  it('creates the current snapshot and recovers the same semantic draft across manifest drift', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: `/runtime/studio/trial-chains/${capabilityId}/session`,
      payload: { versionId },
    });
    await app.close();

    expect(response.statusCode).toBe(201);
    expect(createSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ownerId: 'creator-1',
        capabilityId,
        version: '0.1.0',
        manifestHash: 'current-hash',
        mode: 'trial',
      }),
    );
    expect(forkLatestStudioRevision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        targetSessionId: sessionId,
        targetVersion: '0.1.0',
        targetManifestHash: 'current-hash',
        sourceVersion: '0.1.0',
      }),
    );
    expect(vi.mocked(forkLatestStudioRevision).mock.calls[0]?.[1]).not.toHaveProperty(
      'sourceManifestHash',
    );
  });

  it('falls back to the explicitly verified published source when the draft has no UI', async () => {
    vi.mocked(getCreatorCapabilityVersionForStudioSource).mockResolvedValue({
      view: {
        capabilityId,
        version: '0.0.9',
        status: 'published',
        manifestHash: 'published-hash',
      },
    } as never);
    vi.mocked(forkLatestStudioRevision).mockResolvedValueOnce(null).mockResolvedValueOnce({
      sourceSessionId: 'source-session',
      sourceRevisionId: 'source-revision',
      targetRevisionId: 'target-revision',
      targetRunId: 'target-run',
    });
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: `/runtime/studio/trial-chains/${capabilityId}/session`,
      payload: { versionId, sourceVersionId },
    });
    await app.close();

    expect(response.statusCode).toBe(201);
    expect(getCreatorCapabilityVersionForStudioSource).toHaveBeenCalledWith(expect.anything(), {
      capabilityId,
      versionId: sourceVersionId,
      creatorUserId: 'creator-1',
    });
    expect(forkLatestStudioRevision).toHaveBeenCalledTimes(2);
    expect(vi.mocked(forkLatestStudioRevision).mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        sourceVersion: '0.0.9',
        sourceManifestHash: 'published-hash',
      }),
    );
  });
});
