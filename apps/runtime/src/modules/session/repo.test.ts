import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  findEmptyTrialSession,
  findTrialSessionForVersion,
  getSessionMode,
  getSessionRow,
} from './repo.js';

describe('findEmptyTrialSession', () => {
  it('scopes empty trial reuse by capability, version and manifest hash', async () => {
    let captured:
      | {
          sql: string;
          params: unknown[];
        }
      | undefined;
    const pool = {
      query: async (sql: string, params: unknown[]) => {
        captured = { sql, params };
        return { rows: [] };
      },
    } as unknown as Pool;

    await findEmptyTrialSession(pool, {
      ownerId: 'user-1',
      capabilityId: 'cap-1',
      version: '0.1.0',
      manifestHash: 'manifest-1',
    });

    expect(captured?.sql).toContain('s.version = $3');
    expect(captured?.sql).toContain('s.manifest_hash = $4');
    expect(captured?.params).toEqual(['user-1', 'cap-1', '0.1.0', 'manifest-1']);
  });
});

describe('findTrialSessionForVersion', () => {
  it('scopes recovery to owner, capability, semantic version and manifest hash', async () => {
    let captured:
      | {
          sql: string;
          params: unknown[];
        }
      | undefined;
    const pool = {
      query: async (sql: string, params: unknown[]) => {
        captured = { sql, params };
        return { rows: [] };
      },
    } as unknown as Pool;

    await expect(
      findTrialSessionForVersion(pool, {
        ownerId: 'creator-1',
        capabilityId: 'cap-1',
        version: '0.1.0',
        manifestHash: 'manifest-1',
      }),
    ).resolves.toBeNull();

    expect(captured?.sql).toContain(`s.owner_id = $1`);
    expect(captured?.sql).toContain(`s.capability_id = $2`);
    expect(captured?.sql).toContain(`s.version = $3`);
    expect(captured?.sql).toContain(`s.manifest_hash = $4`);
    expect(captured?.sql).toContain(`s.mode = 'trial'`);
    expect(captured?.sql).toContain(`r.status = 'completed'`);
    expect(captured?.sql).toContain(`r.owner_id = s.owner_id`);
    expect(captured?.sql).toContain(`ORDER BY s.updated_at DESC, s.id DESC`);
    expect(captured?.sql).not.toContain(`ORDER BY trial_verified DESC`);
    expect(captured?.params).toEqual(['creator-1', 'cap-1', '0.1.0', 'manifest-1']);
  });

  it('optionally pins recovery to the runtime return session', async () => {
    let captured:
      | {
          sql: string;
          params: unknown[];
        }
      | undefined;
    const pool = {
      query: async (sql: string, params: unknown[]) => {
        captured = { sql, params };
        return { rows: [] };
      },
    } as unknown as Pool;

    await findTrialSessionForVersion(pool, {
      ownerId: 'creator-1',
      capabilityId: 'cap-1',
      version: '0.1.0',
      manifestHash: 'manifest-1',
      sessionId: 'session-1',
    });

    expect(captured?.sql).toContain(`s.id = $5`);
    expect(captured?.params).toEqual(['creator-1', 'cap-1', '0.1.0', 'manifest-1', 'session-1']);
  });
});

describe('getSessionRow', () => {
  it('only returns active sessions for an owner-scoped read', async () => {
    let captured:
      | {
          sql: string;
          params: unknown[];
        }
      | undefined;
    const pool = {
      query: async (sql: string, params: unknown[]) => {
        captured = { sql, params };
        return { rows: [] };
      },
    } as unknown as Pool;

    await getSessionRow(pool, 'session-1', 'owner-1');

    expect(captured?.sql).toContain(`status = 'active'`);
    expect(captured?.params).toEqual(['session-1', 'owner-1']);
  });
});

describe('getSessionMode', () => {
  it('reads only the mode of an active session before selecting the auth strategy', async () => {
    let captured:
      | {
          sql: string;
          params: unknown[];
        }
      | undefined;
    const pool = {
      query: async (sql: string, params: unknown[]) => {
        captured = { sql, params };
        return { rows: [{ mode: 'trial' }] };
      },
    } as unknown as Pool;

    await expect(getSessionMode(pool, 'session-1')).resolves.toBe('trial');
    expect(captured?.sql).toContain('SELECT mode');
    expect(captured?.sql).toContain(`status = 'active'`);
    expect(captured?.params).toEqual(['session-1']);
  });
});
