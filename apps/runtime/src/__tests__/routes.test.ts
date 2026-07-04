// 路由注册自检 + session 端点 owner 守卫（非本人与不存在同样 404，不暴露存在性）。
import { describe, expect, it } from 'vitest';
import type { FastifyReply, FastifyRequest, RouteHandlerMethod } from 'fastify';
import { ALL_ENDPOINTS } from '../bootstrap/routes.js';
import {
  getSessionDetailHandler,
  interruptHandler,
  sendMessageHandler,
} from '../modules/session/handlers.js';
import { artifactContentHandler } from '../modules/artifact/handlers.js';
import { createSession } from '../modules/session/repo.js';
import { createTurnRunner } from '../modules/agent/run-turn.js';
import { createSessionEventBus } from '../platform/infra/event-bus.js';
import { FakeDb, FakeObjectStore, makeFakeAgentFactory, silentLog } from './fakes.js';

const ME = 'user-me';
const OTHER = 'user-other';

describe('route registry self-check', () => {
  it('registers exactly 8 endpoints (capability 1 + session 6 + artifact 1)', () => {
    expect(ALL_ENDPOINTS).toHaveLength(8);
  });

  it('no duplicate (method,url) pairs', () => {
    const seen = new Set<string>();
    for (const ep of ALL_ENDPOINTS) {
      const key = `${String(ep.method)} ${ep.url}`;
      expect(seen.has(key), `duplicate route: ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('所有端点都带鉴权守卫（runtime 无匿名路径）', () => {
    for (const ep of ALL_ENDPOINTS) {
      expect(
        (ep.preHandlers ?? []).length,
        `${String(ep.method)} ${ep.url} 缺守卫`,
      ).toBeGreaterThan(0);
    }
  });
});

// ───────────────────────────── handler 级 owner 守卫 ─────────────────────────────

interface Captured {
  statusCode: number;
  body: unknown;
}

function makeReply(): FastifyReply & Captured {
  const reply = {
    statusCode: 0,
    body: undefined as unknown,
    code(n: number) {
      this.statusCode = n;
      return this;
    },
    send(b: unknown) {
      this.body = b;
      return this;
    },
    type() {
      return this;
    },
  };
  return reply as unknown as FastifyReply & Captured;
}

function makeReq(input: {
  db: FakeDb;
  objectStore?: FakeObjectStore;
  userId: string;
  params?: Record<string, string>;
  body?: unknown;
}): FastifyRequest {
  const turns = createTurnRunner({
    db: input.db,
    objectStore: input.objectStore ?? new FakeObjectStore(),
    bus: createSessionEventBus(),
    agentFactory: makeFakeAgentFactory().factory,
  });
  return {
    id: 'trace-test',
    auth: { userId: input.userId, account: 'tester', roles: ['creator'] },
    params: input.params ?? {},
    body: input.body,
    log: { ...silentLog, info: () => undefined, warn: () => undefined },
    server: {
      infra: { db: input.db, objectStore: input.objectStore ?? new FakeObjectStore() },
      turns,
    },
  } as unknown as FastifyRequest;
}

async function call(
  handler: RouteHandlerMethod,
  req: FastifyRequest,
): Promise<FastifyReply & Captured> {
  const reply = makeReply();
  await (handler as unknown as (rq: FastifyRequest, rp: FastifyReply) => Promise<unknown>)(
    req,
    reply,
  );
  return reply;
}

async function seedOwnedSession(db: FakeDb, owner: string): Promise<string> {
  const cap = db.seedCapability({ owner_user_id: owner });
  const session = await createSession(db, { capabilityId: cap.id, ownerUserId: owner });
  return session.id;
}

describe('session 端点 owner 守卫', () => {
  it('GET /runtime/sessions/:id：本人 200，非本人 404', async () => {
    const db = new FakeDb();
    const sessionId = await seedOwnedSession(db, ME);

    const mine = await call(
      getSessionDetailHandler(),
      makeReq({ db, userId: ME, params: { id: sessionId } }),
    );
    expect(mine.statusCode).toBe(200);

    const theirs = await call(
      getSessionDetailHandler(),
      makeReq({ db, userId: OTHER, params: { id: sessionId } }),
    );
    expect(theirs.statusCode).toBe(404);
    // 404 也是完整 ErrorEnvelope（无 code 字段）。
    const body = theirs.body as { error?: Record<string, unknown> };
    expect(body.error?.userMessage).toBeTruthy();
    expect(body.error && 'code' in body.error).toBe(false);
  });

  it('POST /runtime/sessions/:id/messages：非本人 404，且不落 user 消息', async () => {
    const db = new FakeDb();
    const sessionId = await seedOwnedSession(db, ME);
    const reply = await call(
      sendMessageHandler(),
      makeReq({ db, userId: OTHER, params: { id: sessionId }, body: { text: '你好' } }),
    );
    expect(reply.statusCode).toBe(404);
    expect(db.messages).toHaveLength(0);
  });

  it('POST /runtime/sessions/:id/interrupt：非本人 404', async () => {
    const db = new FakeDb();
    const sessionId = await seedOwnedSession(db, ME);
    const reply = await call(
      interruptHandler(),
      makeReq({ db, userId: OTHER, params: { id: sessionId } }),
    );
    expect(reply.statusCode).toBe(404);
  });

  it('GET /runtime/artifacts/:id/content：非本人 404', async () => {
    const db = new FakeDb();
    const store = new FakeObjectStore();
    const sessionId = await seedOwnedSession(db, ME);
    db.artifacts.set('art-1', {
      id: 'art-1',
      session_id: sessionId,
      kind: 'html',
      title: 'demo',
      storage_key: `artifacts/${sessionId}/art-1`,
      meta: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    store.seedText('agora-artifacts', `artifacts/${sessionId}/art-1`, '<!doctype html>');

    const theirs = await call(
      artifactContentHandler(),
      makeReq({ db, objectStore: store, userId: OTHER, params: { id: 'art-1' } }),
    );
    expect(theirs.statusCode).toBe(404);

    const mine = await call(
      artifactContentHandler(),
      makeReq({ db, objectStore: store, userId: ME, params: { id: 'art-1' } }),
    );
    expect(mine.statusCode).toBe(200);
    expect(mine.body).toBe('<!doctype html>');
  });
});
