import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../platform/config/env.js';
import type { InfraContext } from '../platform/infra/index.js';
import { corsOriginPolicy, requireTrustedMutationOrigin } from '../platform/http/browser-origin.js';

const env = {
  NODE_ENV: 'production',
  PUBLIC_APP_ORIGIN: 'https://combo.example',
} as Env;
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('runtime browser origin boundary', () => {
  it('reflects credentials only to the exact public app origin', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(cors, { origin: corsOriginPolicy(env), credentials: true });
    app.get('/probe', async () => ({ ok: true }));

    const exact = await app.inject({
      method: 'OPTIONS',
      url: '/probe',
      headers: {
        origin: 'https://combo.example',
        'access-control-request-method': 'GET',
      },
    });
    expect(exact.headers['access-control-allow-origin']).toBe('https://combo.example');

    const sibling = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { origin: 'https://admin.combo.example' },
    });
    expect(sibling.headers['access-control-allow-origin']).toBeUndefined();

    const siblingPreflight = await app.inject({
      method: 'OPTIONS',
      url: '/probe',
      headers: {
        origin: 'https://admin.combo.example',
        'access-control-request-method': 'GET',
      },
    });
    expect(siblingPreflight.statusCode).toBeGreaterThanOrEqual(400);
    expect(siblingPreflight.statusCode).toBeLessThan(500);
    expect(siblingPreflight.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects a valid Cookie from a same-site sibling before any write handler runs', async () => {
    const write = vi.fn();
    const app = Fastify({ logger: false });
    apps.push(app);
    app.decorate('infra', { env } as InfraContext);
    app.post('/mutate', { preHandler: requireTrustedMutationOrigin() }, async (_request, reply) => {
      write();
      return reply.code(204).send();
    });

    const response = await app.inject({
      method: 'POST',
      url: '/mutate',
      headers: {
        cookie: `cb_session=s1.${'A'.repeat(43)}`,
        origin: 'https://admin.combo.example',
        'sec-fetch-site': 'same-site',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(write).not.toHaveBeenCalled();
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect((response.json() as { error: Record<string, unknown> }).error).not.toHaveProperty(
      'code',
    );
  });
});
