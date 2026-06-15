// logout 改 Opt 鉴权自检（10-auth §3.3/:145/:153，Codex r3）：
//   POST /auth/logout 契约是 Opt——未登录也应幂等命中 logout 语义，绝不先被 401 拦。
//   无真实 Logto/PG：mock verifyLogtoJwt + provisionUser，取 AUTH_ENDPOINTS 里 logout 的 preHandler，
//   用无 token 的 mock req 驱动它，断言【不发 401 信封、放行】（= optionalAuth 行为，非 requireAuth）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';

const verifyMock = vi.fn();
const provisionMock = vi.fn();
vi.mock('../infra/logto.js', () => ({
  verifyLogtoJwt: (...args: unknown[]) => verifyMock(...args),
}));
vi.mock('../infra/users-repo.js', () => ({
  provisionUser: (...args: unknown[]) => provisionMock(...args),
}));

const { AUTH_ENDPOINTS } = await import('../routes/auth.js');

function logoutPreHandler() {
  const ep = AUTH_ENDPOINTS.find((e) => e.method === 'POST' && e.url === '/auth/logout');
  if (!ep) throw new Error('logout endpoint not registered');
  const handlers = ep.preHandlers ?? [];
  expect(handlers.length).toBeGreaterThan(0); // 仍带守卫（写命令守卫链不破，routes.test 守门一致）
  return handlers[0];
}

function makeReq(opts: { bearer?: boolean } = {}): FastifyRequest {
  return {
    id: 'trace-logout',
    headers: opts.bearer ? { authorization: 'Bearer good.jwt' } : {},
    cookies: {},
    params: {},
    query: {},
    server: { infra: { db: { query: vi.fn() }, env: {} } },
  } as unknown as FastifyRequest;
}

function makeReply(): { reply: FastifyReply; sent: { code?: number; body?: unknown } } {
  const sent: { code?: number; body?: unknown } = {};
  const reply = {
    code: vi.fn(function (this: unknown, c: number) {
      sent.code = c;
      return this;
    }),
    send: vi.fn((b: unknown) => {
      sent.body = b;
      return reply;
    }),
  } as unknown as FastifyReply;
  return { reply, sent };
}

beforeEach(() => {
  verifyMock.mockReset();
  provisionMock.mockReset();
});

describe('POST /auth/logout = Opt 鉴权（Codex r3）', () => {
  it('无 token 调 logout → 不被 401 拦、放行进 handler 语义（幂等成功）', async () => {
    const pre = logoutPreHandler();
    const req = makeReq({ bearer: false }); // 无 token
    const { reply, sent } = makeReply();
    await pre(req, reply, () => {});
    expect(sent.code).toBeUndefined(); // 关键：绝不发 401（optionalAuth 不拦无 token）
    expect(req.auth).toBeUndefined(); // 未登录降级匿名（无 AuthContext）
    expect(verifyMock).not.toHaveBeenCalled(); // 无 token 不进验签
  });

  it('已登录调 logout → 解析 AuthContext 并放行（清会话语义可拿到 userId）', async () => {
    verifyMock.mockResolvedValue({
      kind: 'ok',
      token: { sub: 'sub-logout', roles: ['creator'], account: 'w', email: null },
    });
    provisionMock.mockResolvedValue({
      id: 'uuid-logout',
      status: 'active',
      roles: ['creator'],
      account: 'w',
    });
    const pre = logoutPreHandler();
    const req = makeReq({ bearer: true });
    const { reply, sent } = makeReply();
    await pre(req, reply, () => {});
    expect(sent.code).toBeUndefined(); // 放行
    expect(req.auth?.userId).toBe('uuid-logout');
  });
});
