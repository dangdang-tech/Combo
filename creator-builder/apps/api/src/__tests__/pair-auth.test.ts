// PairAuth 自检（20 §3.3 / Codex#5）：配对码 hash 真源确定性 + 缺凭据 401（建库依赖不可用，仅测纯逻辑/边界）。
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { hashPairingCode } from '../middleware/pair-auth.js';

describe('hashPairingCode (20 §6.3 唯一真源)', () => {
  it('is deterministic SHA-256 hex (64 chars)', () => {
    const h1 = hashPairingCode('ABCD-1234');
    const h2 = hashPairingCode('ABCD-1234');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different codes → different hashes', () => {
    expect(hashPairingCode('ABCD-1234')).not.toBe(hashPairingCode('ABCD-1235'));
  });
});

describe('PairAuth guard wiring (无凭据 → 401)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('connect/upload without Bearer pairing code → 401 ErrorEnvelope (no code, D1)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/import/connect/upload',
      headers: { 'idempotency-key': 'k1' },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: Record<string, unknown> };
    expect(body.error).not.toHaveProperty('code');
    expect(body.error.userMessage).toBeTruthy();
  });
});
