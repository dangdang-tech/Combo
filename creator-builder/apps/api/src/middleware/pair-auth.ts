// B-21 · PairAuth 中间件（20-step1-import §3.3/§6.4，独立于 Logto JWT，脊柱 10-auth §2，Codex#5）。
//   本机助手直传（POST /import/connect/upload）走独立 PairAuth：
//   请求带表单字段/query pairId + Authorization: Bearer <pairingCode>（pairingCode 是一次性配对码，非 Logto JWT、无 token exchange）。
//   服务端按 pairId 定位 import_pairings 行，timing-safe 比对 pairing_code_hash；失败计数按 pairId 成立。
//   校验链（20 §3.3 / §15）：phase ∈ {waiting,uploading} + 未过期(expires_at>now) + 未用尽(attempt_count<max_attempts) + 码 hash 匹配。
//   失败只出 ErrorEnvelope（绝不裸露内部 code / DB 报错，脊柱 §11.B）；失败计数原子 +1（防暴力）。
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { buildError, ErrorCode } from '@cb/shared';

/** PairAuth 解出的上下文（注入 req.pairAuth）。 */
export interface PairAuthContext {
  pairId: string;
  /** 配对绑定的创作者（导入产物归属，20 §6.4）。 */
  ownerUserId: string;
}

/**
 * 配对码 hash（唯一真源）：SHA-256(code) hex。铸码端（POST /import/connect/pair，Phase 3）
 * 与本校验端共用此函数，保证「只存哈希、明文返一次」可比对（20 §6.3）。
 */
export function hashPairingCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

/** timing-safe 比对两个 hex 摘要（防时序侧信道；长度不等直接 false）。 */
function safeHexEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}

/** 从请求取 pairId（表单字段或 query）+ pairingCode（Bearer 头）。 */
function extractPairCredentials(
  req: FastifyRequest,
): { pairId: string; pairingCode: string } | null {
  const authz = req.headers.authorization;
  if (!authz || !authz.startsWith('Bearer ')) return null;
  const pairingCode = authz.slice('Bearer '.length).trim();
  // pairId 来自 multipart 表单字段或 query。
  const body = req.body as { pairId?: string } | undefined;
  const query = req.query as { pairId?: string } | undefined;
  const pairId = body?.pairId ?? query?.pairId;
  if (!pairId || !pairingCode) return null;
  return { pairId, pairingCode };
}

/** import_pairings 校验所需列。 */
interface PairingRow {
  owner_user_id: string;
  pairing_code_hash: string;
  phase: string;
  attempt_count: number;
  max_attempts: number;
  expired: boolean; // expires_at <= now()（在 SQL 算，避免时钟漂移）
  used: boolean; // used_at IS NOT NULL
}

/**
 * 校验配对码（20 §3.3 / §15）：按 pairId 定位 import_pairings，逐条校验后 timing-safe 比对 hash。
 *   - 行不存在 / 已用 / 已过期 / phase 非 waiting|uploading / 尝试次数用尽 → null（鉴权失败）。
 *   - 码 hash 不匹配 → 原子 attempt_count +1（按 pairId，§11.A 受保护写入：UPDATE 带 WHERE 防越界）后 null。
 *   - 全通过 → 返回 ownerUserId。
 * DB 异常 catch 收口为 null（绝不裸露原始报错，脊柱 §11.B）；上层据 null 出人话信封。
 */
async function verifyPairing(
  pairId: string,
  pairingCode: string,
  req: FastifyRequest,
): Promise<PairAuthContext | null> {
  const db = req.server.infra.db;
  try {
    const res = await db.query<PairingRow>(
      `SELECT owner_user_id,
              pairing_code_hash,
              phase,
              attempt_count,
              max_attempts,
              (expires_at <= now())   AS expired,
              (used_at IS NOT NULL)   AS used
         FROM import_pairings
        WHERE id = $1`,
      [pairId],
    );
    const row = res.rows[0];
    if (!row) return null; // 配对不存在
    if (row.used || row.expired) return null; // 已用 / 已过期
    if (row.phase !== 'waiting' && row.phase !== 'uploading') return null; // phase 不在可上传态
    if (row.attempt_count >= row.max_attempts) return null; // 尝试次数已用尽（已锁定）

    const incoming = hashPairingCode(pairingCode);
    if (!safeHexEqual(incoming, row.pairing_code_hash)) {
      // 码错：失败计数原子 +1（按 pairId，仍在可计数态才加，防越界，§11.A）。
      await db
        .query(
          `UPDATE import_pairings
              SET attempt_count = attempt_count + 1, updated_at = now()
            WHERE id = $1
              AND used_at IS NULL
              AND phase IN ('waiting','uploading')
              AND attempt_count < max_attempts`,
          [pairId],
        )
        .catch(() => undefined); // 计数写失败不改变「鉴权失败」结论
      return null;
    }

    return { pairId, ownerUserId: row.owner_user_id };
  } catch {
    // DB 异常：视为鉴权失败（不裸露原始报错）。
    return null;
  }
}

/** PairAuth 守卫：校验失败 → 401（人话，绝不裸露内部 code）。 */
export function requirePairAuth(): preHandlerHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const fail = (): FastifyReply =>
      reply.code(401).send(
        buildError(ErrorCode.UNAUTHENTICATED, req.id, {
          userMessage: '配对失效了，请回到网页重新生成连接码。',
          action: 'change_input',
        }),
      );

    const creds = extractPairCredentials(req);
    if (!creds) return fail();
    const ctx = await verifyPairing(creds.pairId, creds.pairingCode, req);
    if (!ctx) return fail();
    req.pairAuth = ctx;
  };
}
