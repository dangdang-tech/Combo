// SSE 路由 handler 工厂（脊柱 §5 / §11.C，Codex#3）。
//   两条本期可调用 SSE 流共用：建流前 owner 校验（HTTP 失败、不走 error 帧）+ 真实 text/event-stream。
//   - job 流（/jobs/:jobId/events）：snapshot = jobs.progress 全量（kind=job）。
//   - structure 流（/versions/:versionId/structure/events）：snapshot = capability_versions.structure_state 全量（kind=structure）。
//   鉴权已由 requireSseAuth（同源 Cookie）前置；本 handler 只做 owner 校验 + 建流。
//   业务事件跟流（Redis Streams XADD）本期可空（协议为真）；DB 取不到资源 → 建流前 404/403 HTTP。
import type { FastifyReply, FastifyRequest, RouteHandlerMethod } from 'fastify';
import {
  buildError,
  ErrorCode,
  type ProgressView,
  type StateSnapshotPayload,
  type StructureState,
} from '@cb/shared';
import { startSseStream } from '../plugins/sse.js';
import { getLastEventId } from '../plugins/sse.js';

/** 建流前资源查找结果：owner 校验用。 */
interface OwnerLookup {
  found: boolean;
  ownerUserId?: string;
}

/** 建流前 404（资源不存在，HTTP 信封，不走 error 帧，脊柱 §11.C）。 */
function reply404(req: FastifyRequest, reply: FastifyReply): void {
  reply.code(404).send(buildError(ErrorCode.NOT_FOUND, req.id));
}

/** 建流前 403（非 owner，HTTP 信封，脊柱 §11.C / 10-auth §6.3）。 */
function reply403(req: FastifyRequest, reply: FastifyReply): void {
  reply
    .code(403)
    .send(buildError(ErrorCode.FORBIDDEN, req.id, { userMessage: '你没有权限查看这个内容。' }));
}

/** 建流前 500（依赖异常兜底，HTTP 信封；绝不裸露原始报错，脊柱 §11.B）。 */
function reply500(req: FastifyRequest, reply: FastifyReply): void {
  reply.code(500).send(buildError(ErrorCode.INTERNAL, req.id));
}

/**
 * job 流 SSE handler（脊柱 §5，kind=job）。
 *   建流前：查 jobs（owner=当前用户），缺则 404、非 owner 则 403（HTTP，脊柱 §11.C）；
 *   建流：首帧 state_snapshot = jobs.progress 全量（断点续传基座，硬规则①③）。
 */
export function jobSseHandler(): RouteHandlerMethod {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    const { jobId } = req.params as { jobId: string };
    const userId = req.auth?.userId;
    if (!userId) {
      // requireSseAuth 已保证有 auth；防御性兜底。
      reply.code(401).send(buildError(ErrorCode.UNAUTHENTICATED, req.id));
      return reply;
    }

    let row: { owner_user_id: string; progress: unknown } | undefined;
    try {
      const res = await req.server.infra.db.query<{ owner_user_id: string; progress: unknown }>(
        'SELECT owner_user_id, progress FROM jobs WHERE id = $1',
        [jobId],
      );
      row = res.rows[0];
    } catch {
      reply500(req, reply);
      return reply;
    }

    const lookup: OwnerLookup = row
      ? { found: true, ownerUserId: row.owner_user_id }
      : { found: false };
    if (!lookup.found) {
      reply404(req, reply);
      return reply;
    }
    if (lookup.ownerUserId !== userId) {
      reply403(req, reply);
      return reply;
    }

    // 建流（hijack 后由 startSseStream 接管 raw）。snapshot = jobs.progress（kind=job）。
    const progress = (row?.progress ?? {}) as Partial<ProgressView>;
    await startSseStream(req, reply, {
      kind: 'job',
      lastEventId: getLastEventId(req),
      loadSnapshot: async (): Promise<StateSnapshotPayload> => ({
        kind: 'job',
        progress: normalizeProgress(progress),
      }),
      // replaySince 未接 Redis Streams（业务事件源 Phase 3）：缺省 → 视为超窗、走 snapshot 重置（协议为真）。
    });
    return reply;
  };
}

/**
 * structure 流 SSE handler（脊柱 §5，kind=structure）。
 *   建流前：查 capability_versions JOIN capabilities（owner=creator_user_id），缺 404、非 owner 403；
 *   建流：首帧 state_snapshot = structure_state 全量（字段级断点续传，已生成字段不丢）。
 */
export function structureSseHandler(): RouteHandlerMethod {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    const { versionId } = req.params as { versionId: string };
    const userId = req.auth?.userId;
    if (!userId) {
      reply.code(401).send(buildError(ErrorCode.UNAUTHENTICATED, req.id));
      return reply;
    }

    let row: { creator_user_id: string; structure_state: unknown } | undefined;
    try {
      const res = await req.server.infra.db.query<{
        creator_user_id: string;
        structure_state: unknown;
      }>(
        `SELECT c.creator_user_id AS creator_user_id, v.structure_state AS structure_state
           FROM capability_versions v
           JOIN capabilities c ON c.id = v.capability_id
          WHERE v.id = $1`,
        [versionId],
      );
      row = res.rows[0];
    } catch {
      reply500(req, reply);
      return reply;
    }

    if (!row) {
      reply404(req, reply);
      return reply;
    }
    if (row.creator_user_id !== userId) {
      reply403(req, reply);
      return reply;
    }

    const structureState = (row.structure_state ?? {}) as Partial<StructureState>;
    await startSseStream(req, reply, {
      kind: 'structure',
      lastEventId: getLastEventId(req),
      loadSnapshot: async (): Promise<StateSnapshotPayload> => ({
        kind: 'structure',
        structureState: normalizeStructureState(versionId, structureState),
      }),
    });
    return reply;
  };
}

/** 把 jobs.progress（可能为 {} 或部分）规整成合法 ProgressView（永不裸转圈：至少给 0% + 子任务空清单）。 */
function normalizeProgress(p: Partial<ProgressView>): ProgressView {
  return {
    percent: typeof p.percent === 'number' ? p.percent : 0,
    phrase: typeof p.phrase === 'string' ? p.phrase : '正在准备…',
    ...(typeof p.done === 'number' ? { done: p.done } : {}),
    ...(typeof p.total === 'number' ? { total: p.total } : {}),
    ...(typeof p.unit === 'string' ? { unit: p.unit } : {}),
    subtasks: Array.isArray(p.subtasks) ? p.subtasks : [],
    ...(Array.isArray(p.items) ? { items: p.items } : {}),
    ...(typeof p.slow === 'boolean' ? { slow: p.slow } : {}),
  };
}

/** 把 structure_state（可能为 {} 或部分）规整成合法 StructureState（已生成字段原样回显）。 */
function normalizeStructureState(versionId: string, s: Partial<StructureState>): StructureState {
  const fields = Array.isArray(s.fields) ? s.fields : [];
  return {
    versionId,
    fields,
    doneCount: typeof s.doneCount === 'number' ? s.doneCount : 0,
    totalCount: typeof s.totalCount === 'number' ? s.totalCount : fields.length,
  };
}
