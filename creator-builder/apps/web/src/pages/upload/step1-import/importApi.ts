// STEP① 导入数据层（F-10）——本机助手直传路径（铸码 / 轮询）+ 取消 + 快照统计/会话列表。
//
// 端点真源（20 §1 端点清单）；全部走 4A typed client（写命令自动注入 Idempotency-Key + scope）。
// 本期前端「主推」本机助手路径（铸一次性配对码 → 终端跑助手脚本 → 助手凭码全量直传 → 自动建 Job →
//   网页轮询拿 jobId → 转 SSE）。直传路径（presign 浏览器分批 PUT）属上传引擎细节，本模块不在 UI 起整套
//   分批 PUT（诚实推迟：见模块 README/总结），故 importApi 只暴露「铸码 / 轮询 / 取消 / 快照查询」最小集。
import {
  IdempotencyScope,
  API_PREFIX,
  type PairResult,
  type PairStatusView,
  type SnapshotView,
  type SnapshotSegmentView,
} from '@cb/shared';
import {
  apiPost,
  apiGet,
  apiGetEnvelope,
  type RequestOptions,
  type WriteOptions,
} from '../../../api/index.js';

/** 铸配对码端点路径（20 §3.1，写命令 scope=import.connect.pair）。 */
export function pairPath(): string {
  return '/import/connect/pair';
}

/** 轮询配对/上传状态端点路径（20 §3.4）。 */
export function pairStatusPath(pairId: string): string {
  return `/import/connect/pair/${encodeURIComponent(pairId)}`;
}

/** 取消导入 Job 端点路径（脊柱 §6.1 / 20 §4.4，写命令 scope=job.cancel）。 */
export function cancelJobPath(jobId: string): string {
  return `/jobs/${encodeURIComponent(jobId)}/cancel`;
}

/** 快照统计 + 去敏报告端点路径（20 §5.1）。 */
export function snapshotPath(snapshotId: string): string {
  return `/snapshots/${encodeURIComponent(snapshotId)}`;
}

/** 快照会话节选列表端点路径（20 §5.2，只读 cursor 分页）。 */
export function snapshotSegmentsPath(snapshotId: string): string {
  return `/snapshots/${encodeURIComponent(snapshotId)}/segments`;
}

/**
 * 铸一次性配对码（20 §3.1）。写命令必带 Idempotency-Key（client 自动）+ scope=import.connect.pair。
 *   重复点「生成命令」/刷新复用同一 idempotencyKey → 回放首次结果（同 pairId+同码，不重复铸行，硬规则③）。
 *   续传草稿可挂接 draftId（20 §3.1 body）。
 */
export async function createPair(
  params: { draftId?: string | undefined; idempotencyKey?: string | undefined } = {},
  opts: RequestOptions = {},
): Promise<PairResult> {
  const body = params.draftId ? { draftId: params.draftId } : {};
  const write: WriteOptions = {
    ...opts,
    scope: IdempotencyScope.IMPORT_CONNECT_PAIR,
    ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
  };
  return apiPost<PairResult>(pairPath(), body, write);
}

/**
 * 轮询配对/上传状态（20 §3.4，建议 2s 一次）。phase=job_created 时返 jobId + eventsUrl，前端停轮询转 SSE。
 *   读，天然幂等。expired 是态（非错误），上层给「配对码已过期，重新生成」引导。
 */
export async function fetchPairStatus(
  pairId: string,
  opts: RequestOptions = {},
): Promise<PairStatusView> {
  return apiGet<PairStatusView>(pairStatusPath(pairId), opts);
}

/**
 * 取消导入 Job（脊柱 §6.1 / 20 §4.4）。写命令必带 Idempotency-Key（client 自动）+ scope=job.cancel。
 *   取消后保留已完成段（硬规则③，导入-35）；重复取消同 key 回放首次结果。
 */
export async function cancelImportJob(
  jobId: string,
  idempotencyKey?: string,
  opts: RequestOptions = {},
): Promise<void> {
  await apiPost<unknown>(
    cancelJobPath(jobId),
    {},
    {
      ...opts,
      scope: IdempotencyScope.JOB_CANCEL,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    },
  );
}

/** 取快照统计四格 + 去敏报告（完成态用；20 §5.1）。 */
export async function fetchSnapshot(
  snapshotId: string,
  opts: RequestOptions = {},
): Promise<SnapshotView> {
  return apiGet<SnapshotView>(snapshotPath(snapshotId), opts);
}

export interface SnapshotSegmentsResult {
  segments: SnapshotSegmentView[];
  nextCursor: string | undefined;
  hasMore: boolean;
}

/** 取快照会话节选列表（完成态只读列表；20 §5.2，desc 默认最新在前）。 */
export async function fetchSnapshotSegments(
  snapshotId: string,
  params: { cursor?: string | undefined; limit?: number | undefined } = {},
  opts: RequestOptions = {},
): Promise<SnapshotSegmentsResult> {
  const res = await apiGetEnvelope<SnapshotSegmentView[]>(snapshotSegmentsPath(snapshotId), {
    ...opts,
    query: { cursor: params.cursor, limit: params.limit },
  });
  return {
    segments: res.data,
    nextCursor: res.meta?.page?.nextCursor ?? undefined,
    hasMore: res.meta?.page?.hasMore ?? false,
  };
}

/** 导入 Job 的 SSE 端点（kind=job；脊柱 §5 / 20 §4.1）。 */
export function importJobEventsUrl(jobId: string): string {
  return `${API_PREFIX}/jobs/${encodeURIComponent(jobId)}/events`;
}
