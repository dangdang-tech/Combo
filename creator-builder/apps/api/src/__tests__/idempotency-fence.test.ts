// 幂等租约 fence 自检（脊柱 §4.2，Codex#4）：无 PG，用 mock DB 验「持租 token 匹配」防旧覆盖新。
//   场景：旧请求取租约 → 超时被新请求 steal（换 lease_token）→ 旧请求返回时落库，
//         UPDATE 带 WHERE … AND lease_token=<旧 token> → 匹配 0 行 → 绝不覆盖新持有者的 response_ref。
import { describe, it, expect, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { requireIdempotency, persistIdempotencyResponse } from '../middleware/idempotency.js';
import { IdempotencyScope } from '@cb/shared';

interface QueryCall {
  sql: string;
  params: unknown[];
}

/** mock fastify req（带可脚本化的 infra.db），onSend payload 走 persistIdempotencyResponse。 */
function makeReq(
  responses: Array<{ rows: unknown[] }>,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): { req: FastifyRequest; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  let i = 0;
  const db = {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      const r = responses[i++] ?? { rows: [] };
      return r;
    }),
  };
  const req = {
    id: 'trace-1',
    method: opts.method ?? 'POST',
    url: '/api/v1/versions/v1/publish',
    body: opts.body ?? { a: 1 },
    headers: opts.headers ?? { 'idempotency-key': 'key-123' },
    server: { infra: { db } },
  } as unknown as FastifyRequest;
  return { req, calls };
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

describe('idempotency lease fence (Codex#4)', () => {
  it('取得新租约 → 注入 leaseToken 到上下文（INSERT 带 lease_token 列）', async () => {
    // INSERT … ON CONFLICT DO NOTHING RETURNING key → 返回一行 = 取得租约。
    const { req, calls } = makeReq([{ rows: [{ key: 'key-123' }] }]);
    const { reply } = makeReply();
    const guard = requireIdempotency(IdempotencyScope.PUBLISH_VERSION);
    await guard(req, reply);
    expect(req.idempotency?.leaseAcquired).toBe(true);
    expect(typeof req.idempotency?.leaseToken).toBe('string');
    expect(req.idempotency?.leaseToken).toBeTruthy();
    // INSERT 写入了 lease_token 列 + 把生成的 token 作为参数传入。
    expect(calls[0]!.sql).toContain('lease_token');
    expect(calls[0]!.params).toContain(req.idempotency!.leaseToken);
  });

  it('夺租约（steal 过期行）→ 换新 lease_token（UPDATE steal 带 lease_token=新token）', async () => {
    // 现行 = locked 且 expired，且 request_hash 与本请求一致（同 key 同 body 重试）→ 走 steal 分支。
    // 先用 INSERT-成功路径取一次 hash？不便。改为：让 SELECT 返回的 request_hash 等于 guard 计算值——
    //   通过先以同一 req 触发一次「取得新租约」拿不到 hash。这里直接用同 body 算法可重现：
    //   guard computeRequestHash 只依赖 method/url/body，固定后 hash 稳定。
    // 第一次调用 guard 取得 hash：用 INSERT 成功路径，记下 requestHash。
    const probe = makeReq([{ rows: [{ key: 'key-123' }] }]);
    const probeReply = makeReply();
    await requireIdempotency(IdempotencyScope.PUBLISH_VERSION)(probe.req, probeReply.reply);
    const knownHash = probe.req.idempotency!.requestHash;

    // 正式 steal 场景：INSERT 0 行 → SELECT 现行(locked+expired, hash 同) → UPDATE steal 返回一行。
    const { req, calls } = makeReq([
      { rows: [] },
      {
        rows: [{ request_hash: knownHash, response_ref: null, status: 'locked', expired: true }],
      },
      { rows: [{ key: 'key-123' }] },
    ]);
    const { reply } = makeReply();
    await requireIdempotency(IdempotencyScope.PUBLISH_VERSION)(req, reply);
    expect(req.idempotency?.leaseAcquired).toBe(true);
    const newToken = req.idempotency!.leaseToken!;
    // 第 3 条是 steal 的 UPDATE：换新 lease_token + 清 response_ref。
    const stealUpd = calls[2]!;
    expect(stealUpd.sql).toContain('lease_token = $5');
    expect(stealUpd.sql).toContain('response_ref = NULL');
    expect(stealUpd.params).toContain(newToken);
  });

  it('完成落库 UPDATE 必须带 fence（WHERE … AND lease_token=?），防旧覆盖新', async () => {
    // 模拟旧请求持有的 leaseToken；steal 后该 token 已失效 → UPDATE 匹配 0 行（rowCount 0）。
    const { req, calls } = makeReq([{ rows: [], rowCount: 0 } as { rows: unknown[] }]);
    req.idempotency = {
      scope: IdempotencyScope.PUBLISH_VERSION,
      key: 'key-123',
      requestHash: 'h',
      leaseAcquired: true,
      leaseToken: 'old-stale-token',
    };
    await persistIdempotencyResponse(req, 200, JSON.stringify({ ok: true }));
    expect(calls).toHaveLength(1);
    const upd = calls[0]!;
    // 完成 UPDATE 带 fence 子句 + 旧 token 作参数（steal 后匹配 0 行，不覆盖新持有者）。
    expect(upd.sql).toContain('AND lease_token =');
    expect(upd.sql).toContain("status = 'completed'");
    expect(upd.params).toContain('old-stale-token');
  });

  it('失败落库 UPDATE 同样带 fence（只标自己持有的租约 failed）', async () => {
    const { req, calls } = makeReq([{ rows: [], rowCount: 0 } as { rows: unknown[] }]);
    req.idempotency = {
      scope: IdempotencyScope.PUBLISH_VERSION,
      key: 'key-123',
      requestHash: 'h',
      leaseAcquired: true,
      leaseToken: 'my-token',
    };
    await persistIdempotencyResponse(req, 500, JSON.stringify({ error: {} }));
    const upd = calls[0]!;
    expect(upd.sql).toContain("status = 'failed'");
    expect(upd.sql).toContain('AND lease_token =');
    expect(upd.params).toContain('my-token');
  });

  it('未取得租约（leaseAcquired=false / 无 leaseToken）→ 不落库', async () => {
    const { req, calls } = makeReq([]);
    req.idempotency = {
      scope: IdempotencyScope.PUBLISH_VERSION,
      key: 'key-123',
      requestHash: 'h',
      leaseAcquired: false,
    };
    await persistIdempotencyResponse(req, 200, '{}');
    expect(calls).toHaveLength(0);
  });
});
