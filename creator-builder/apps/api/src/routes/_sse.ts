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
  isTerminalJobStatus,
  type ErrorBody,
  type JobStatus,
  type ProgressView,
  type StateSnapshotPayload,
  type StructureState,
} from '@cb/shared';
import { startSseStream } from '../plugins/sse.js';
import { getLastEventId } from '../plugins/sse.js';
import { RedisEventStream } from '../sse/event-stream.js';

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

    // —— 建流前 owner 校验：只读 owner 字段（不读 progress/status，避免与下方 snapshot 取数耦合，
    //    且让 owner 校验是最便宜的一跳；Codex P0-1）。缺则 404、非 owner 则 403（HTTP，脊柱 §11.C）。——
    let ownerRow: { owner_user_id: string } | undefined;
    try {
      const res = await req.server.infra.db.query<{ owner_user_id: string }>(
        'SELECT owner_user_id FROM jobs WHERE id = $1',
        [jobId],
      );
      ownerRow = res.rows[0];
    } catch {
      reply500(req, reply);
      return reply;
    }

    const lookup: OwnerLookup = ownerRow
      ? { found: true, ownerUserId: ownerRow.owner_user_id }
      : { found: false };
    if (!lookup.found) {
      reply404(req, reply);
      return reply;
    }
    if (lookup.ownerUserId !== userId) {
      reply403(req, reply);
      return reply;
    }

    const stream = new RedisEventStream(req.server.infra.redisHot);

    // —— TOCTOU 消除（Codex P0-1）：**先取 stream latest id（订阅锚点），再读最新 job snapshot/status**。
    //    顺序反过来保证 snapshot 不早于 latestId 锚点：worker 在「读 snapshot」之后 XADD 的帧，其 id 必 >
    //    latestId，会被从 latestId 起的持续订阅捕获（不漏）；snapshot 已含的进展，订阅重叠一两帧由前端按
    //    percent/状态幂等吸收（不重不卡）。若先读 snapshot 再取 latestId，则两者间 XADD 的 progress/done
    //    会两头漏（不在 snapshot、也不在 latestId 之后），done 漏掉会让连接只剩心跳、不关流。
    const subscribeFromId = await stream.latestId(jobId).catch(() => '0-0');

    // snapshot/status 取数：在 latestId 锚点【之后】读，保证 snapshot 不早于锚点（gap-free 衔接）。
    let snapRow: { status: string; progress: unknown; result: unknown; error: unknown } | undefined;
    try {
      const res = await req.server.infra.db.query<{
        status: string;
        progress: unknown;
        result: unknown;
        error: unknown;
      }>('SELECT status, progress, result, error FROM jobs WHERE id = $1', [jobId]);
      snapRow = res.rows[0];
    } catch {
      reply500(req, reply);
      return reply;
    }
    // 取 snapshot 时 job 已被删（极少）→ 404（仍未建流）。
    if (!snapRow) {
      reply404(req, reply);
      return reply;
    }

    const progress = (snapRow.progress ?? {}) as Partial<ProgressView>;
    const status = snapRow.status as JobStatus;

    // 建流（hijack 后由 startSseStream 接管 raw）。snapshot = jobs.progress（kind=job）。
    // Last-Event-ID 窗口补发接 redis_hot Streams（B-12）：窗口内补增量、超窗走 snapshot 重置（脊柱 §5.4）。
    //
    // —— 终态编排全部交给 startSseStream（Codex P0-1 集中编排，杜绝双 done）——
    //   route 不再在建流后无条件 handle.push 终态帧：
    //     · replay 命中 done/error → 插件内 push 触发关流、不再订阅；
    //     · snapshot 阶段 DB 已终态 → 插件用 terminalFrames() 补一次终态帧并关流、不订阅；
    //     · running → snapshot + 从锚点 live subscribe，收到 done 即关流。
    //   终态帧只发一次、无重复、无悬挂；snapshot 已锚定在 latestId 之后，故终态判定与首帧一致。
    await startSseStream(req, reply, {
      kind: 'job',
      lastEventId: getLastEventId(req),
      loadSnapshot: async (): Promise<StateSnapshotPayload> => ({
        kind: 'job',
        progress: normalizeProgress(progress),
      }),
      replaySince: (lastEventId) => stream.replaySince(jobId, lastEventId),
      // 建流后持续订阅 events:job:{jobId}：把 worker 后续帧实时 push 给在线连接；
      // 断开 / done 终态由 startSseStream abort signal 清理 reader、断独立连接（Codex P0-1）。
      subscribeFromId,
      subscribe: ({ fromId, onFrame, signal }) => stream.subscribe(jobId, fromId, onFrame, signal),
      // 建流瞬间 job 已终态：返回对应终态帧（completed→done；failed→error+done；cancelled→done），
      //   由 startSseStream 在 snapshot 后一次性补发并关流（不留只剩心跳的悬挂连接）。非终态返回空。
      terminalFrames: () =>
        isTerminalJobStatus(status) ? terminalFrames(status, snapRow.result, snapRow.error) : [],
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

/**
 * 建流瞬间 job 已终态时补发的终态帧（Codex P0-1）。与 runner 落终态时推的帧同形态（脊柱 §5.3）：
 *   - completed → done(status, result)。
 *   - failed    → 先 error(完整 ErrorEnvelope) 再 done(status, error)（失败先 error 后 done）。
 *     jobs.error 存的是 ErrorBody（= JobView.error），故包成 { error: body } 形成对外 ErrorEnvelope。
 *   - cancelled → done(status)。
 * done 帧经 startSseStream.push 触发关流（不留只剩心跳的悬挂连接）。
 */
function terminalFrames(
  status: JobStatus,
  result: unknown,
  error: unknown,
): Array<{ event: 'error' | 'done'; payload: unknown }> {
  if (status === 'completed') {
    return [{ event: 'done', payload: { status, result: result ?? null } }];
  }
  if (status === 'failed') {
    const envelope = { error: (error ?? {}) as ErrorBody };
    return [
      { event: 'error', payload: envelope },
      { event: 'done', payload: { status, error: envelope } },
    ];
  }
  // cancelled（及理论上其它终态）：只发 done。
  return [{ event: 'done', payload: { status } }];
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
