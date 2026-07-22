// 我的 Agent（F-07，接 GET /api/v1/dashboard/capabilities，60 域 §1.4）。
//
// Agent 项目列表（按状态筛选 + cursor 分页）：
//   - 复用 CapabilityTable 的 manage 模式，聚焦身份、状态、更新时间和真实创作动作。
//   - 完整草稿先恢复 latest trial session，缺省才创建，然后进入真实 UI Studio。
//   - 历史脏名称通过 manifest name regenerate + SSE 真正写回，不做显示层假别名。
//   - 加载用 4A 加载件（Skeleton），错误用 ErrorState（只 userMessage + action）。
//   - 空态友好（区分「确实没有」与「该筛选下没有」），不裸转圈、不空白。
//   - 渲染在 4A Shell 主区（侧栏「我的 Agent」对应项），页面自身不重搭外壳。
//
// 分页用 useInfiniteQuery（cursor 原生累积，外壳首页-11）：点「加载更多」翻下一页 → 真追加，旧行不被替换。
// 多页累积后按 capabilityId 去重（防后端重叠返回时同一能力出现两行），保留首次出现（旧行口径不被覆盖）。
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  IdempotencyScope,
  type CreateCapabilityResult,
  type DashboardCapabilityRow,
  type Meta,
  type PageMeta,
  type Range,
  type RegenerateFieldResult,
} from '@cb/shared';
import { apiGetEnvelope, apiPost } from '../../api/index.js';
import { useSSE } from '../../api/useSSE.js';
import { ErrorState, LoadingState } from '../../components/index.js';
import { CapabilityTable } from '../dashboard/CapabilityTable.js';
import { dedupeByCapabilityId } from '../dashboard/dedupe.js';
import {
  createRuntimeTrialSession,
  fetchLatestRuntimeTrialSession,
  openRuntimeTrial,
  resolveTrialAuthenticationError,
  startStructureForTrial,
} from '../upload/step2-capabilities/trialApi.js';

/** 状态筛选档（与后端 DashboardCapabilitiesQuery.status 一致）。 */
export type CapabilityStatusFilter =
  | 'all'
  | 'alpha_pending'
  | 'published'
  | 'review_rejected'
  | 'draft';

const STATUS_FILTERS: ReadonlyArray<{ key: CapabilityStatusFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'published', label: '已上架' },
  { key: 'draft', label: '草稿' },
  { key: 'review_rejected', label: '已退回' },
];

interface CapabilitiesPageResult {
  rows: DashboardCapabilityRow[];
  page: PageMeta;
  meta: Meta;
}

interface StudioVersionTarget {
  capabilityId: string;
  versionId: string;
  sourceVersionId?: string;
  title: string;
  returnPath: string;
}

async function launchStudioVersion(target: StudioVersionTarget): Promise<void> {
  const latest = await fetchLatestRuntimeTrialSession({
    capabilityId: target.capabilityId,
    versionId: target.versionId,
  });
  const session =
    latest.session ??
    (
      await createRuntimeTrialSession({
        capabilityId: target.capabilityId,
        versionId: target.versionId,
        ...(target.sourceVersionId ? { sourceVersionId: target.sourceVersionId } : {}),
        title: target.title,
      })
    ).session;
  openRuntimeTrial(
    `/try/session/${encodeURIComponent(session.id)}?returnTo=${encodeURIComponent(target.returnPath)}`,
  );
}

const EMPTY_PAGE: PageMeta = { nextCursor: null, hasMore: false, limit: 20, order: 'desc' };

/**
 * 拉一页能力体（带 status 筛选 + cursor 分页）。
 * 工作台共享 fetchCapabilities 不含 status 维度（其列表不筛选），故本页特有的状态筛选直调 typed client，
 * 但行渲染复用工作台 CapabilityTable，不重复造轮子。
 */
async function fetchCapabilitiesPage(params: {
  status: CapabilityStatusFilter;
  cursor: string | undefined;
  range: Range;
  signal: AbortSignal | undefined;
}): Promise<CapabilitiesPageResult> {
  const { data, meta } = await apiGetEnvelope<DashboardCapabilityRow[]>('/dashboard/capabilities', {
    query: {
      status: params.status,
      range: params.range,
      limit: 20,
      ...(params.cursor !== undefined ? { cursor: params.cursor } : {}),
    },
    ...(params.signal !== undefined ? { signal: params.signal } : {}),
  });
  return { rows: data, page: meta?.page ?? EMPTY_PAGE, meta: meta ?? {} };
}

export function CapabilitiesPage(): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState<CapabilityStatusFilter>('all');
  const [openingCapabilityId, setOpeningCapabilityId] = useState<string | null>(null);
  const [renamingCapabilityId, setRenamingCapabilityId] = useState<string | null>(null);
  const [renameTask, setRenameTask] = useState<{
    capabilityId: string;
    jobId: string;
    eventsUrl: string;
  } | null>(null);
  const [studioTask, setStudioTask] = useState<
    (StudioVersionTarget & { jobId: string; eventsUrl: string }) | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const renameObservedJobRef = useRef<string | null>(null);
  const studioObservedJobRef = useRef<string | null>(null);
  const actionLockRef = useRef(false);
  const range: Range = '30d';

  const query = useInfiniteQuery<CapabilitiesPageResult, Error>({
    // 换筛选即换 queryKey → 新口径独立累积（旧筛选累积页不串台，cursor 自然回第一页，60 §1.6）。
    queryKey: ['capabilities-page', status, range],
    queryFn: ({ pageParam, signal }) =>
      fetchCapabilitiesPage({
        status,
        cursor: pageParam as string | undefined,
        range,
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
  });
  const pages = query.data?.pages ?? [];
  // 真追加：摊平所有已翻页 → 去重（旧行不被替换）。最近一页 meta 作 usage 占位/分页源。
  const rows = useMemo(() => dedupeByCapabilityId(pages.flatMap((p) => p.rows)), [pages]);
  const lastPage = pages.length > 0 ? pages[pages.length - 1] : undefined;
  const lastMeta = lastPage?.meta ?? {};
  const renameSse = useSSE(renameTask?.eventsUrl ?? null, 'structure', {
    enabled: renameTask !== null,
  });
  const studioSse = useSSE(studioTask?.eventsUrl ?? null, 'structure', {
    enabled: studioTask !== null,
  });

  useEffect(() => {
    if (!renameTask) return;
    if (['connecting', 'open', 'reconnecting'].includes(renameSse.status)) {
      renameObservedJobRef.current = renameTask.jobId;
    }
    if (renameObservedJobRef.current !== renameTask.jobId) return;
    if (renameSse.status === 'error') {
      setActionError(renameSse.error?.userMessage ?? '名称没有整理成功，请稍后重试。');
      setRenameTask(null);
      setRenamingCapabilityId(null);
      actionLockRef.current = false;
      return;
    }
    if (renameSse.status !== 'done') return;
    if (renameSse.done?.status !== 'completed') {
      setActionError(renameSse.done?.error?.error.userMessage ?? '名称没有整理成功，请稍后重试。');
      setRenameTask(null);
      setRenamingCapabilityId(null);
      actionLockRef.current = false;
      return;
    }
    setRenameTask(null);
    setRenamingCapabilityId(null);
    actionLockRef.current = false;
    void query.refetch();
  }, [query, renameSse.done, renameSse.error?.userMessage, renameSse.status, renameTask]);

  useEffect(() => {
    if (!studioTask) return;
    if (['connecting', 'open', 'reconnecting'].includes(studioSse.status)) {
      studioObservedJobRef.current = studioTask.jobId;
    }
    if (studioObservedJobRef.current !== studioTask.jobId) return;
    if (studioSse.status === 'error') {
      setActionError(studioSse.error?.userMessage ?? 'UI 没有准备成功，请稍后重试。');
      setStudioTask(null);
      setOpeningCapabilityId(null);
      actionLockRef.current = false;
      return;
    }
    if (studioSse.status !== 'done') return;
    if (studioSse.done?.status !== 'completed') {
      setActionError(studioSse.done?.error?.error.userMessage ?? 'UI 没有准备成功，请稍后重试。');
      setStudioTask(null);
      setOpeningCapabilityId(null);
      actionLockRef.current = false;
      return;
    }

    const target = studioTask;
    setStudioTask(null);
    void (async () => {
      try {
        await launchStudioVersion(target);
      } catch (error) {
        const resolution = await resolveTrialAuthenticationError(error, target.returnPath);
        if (resolution.kind === 'render') {
          setActionError(
            resolution.error instanceof Error
              ? resolution.error.message
              : '暂时没能打开 UI Studio，请稍后重试。',
          );
        }
      } finally {
        setOpeningCapabilityId(null);
        actionLockRef.current = false;
      }
    })();
  }, [studioSse.done, studioSse.error?.userMessage, studioSse.status, studioTask]);

  function changeFilter(next: CapabilityStatusFilter): void {
    setStatus(next); // queryKey 变化即重取第一页，旧累积弃用（换筛选回第一页，60 §1.6）。
  }

  async function createEditableDraft(row: DashboardCapabilityRow): Promise<CreateCapabilityResult> {
    if (row.retryEditable && row.retryVersionId) {
      return apiPost<CreateCapabilityResult>(
        '/capabilities',
        { fromVersionId: row.retryVersionId },
        {
          scope: IdempotencyScope.CAPABILITY_CREATE,
          idempotencyKey: `studio:retry:${row.capabilityId}:${row.retryVersionId}`,
        },
      );
    }
    return apiPost<CreateCapabilityResult>(
      '/capabilities',
      { capabilityId: row.capabilityId },
      {
        scope: IdempotencyScope.CAPABILITY_CREATE,
        idempotencyKey: `studio:draft:${row.capabilityId}:${row.versionId}`,
      },
    );
  }

  async function openStudio(row: DashboardCapabilityRow): Promise<void> {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setActionError(null);
    setOpeningCapabilityId(row.capabilityId);
    const returnPath = `${location.pathname}${location.search}${location.hash}`;
    const sourceVersionId = row.studioSourceVersionId ?? undefined;
    let actionContinuesInSse = false;
    try {
      let versionId = row.versionId;
      let title = `${row.name} 页面设计`;
      if (!row.studioAvailable && (row.studioDraftable || row.retryEditable)) {
        const draft = await createEditableDraft(row);
        versionId = draft.versionId;
        title = `${draft.manifest.name || row.name} 页面设计`;
      }
      if (!row.studioAvailable && row.reviewStatus === 'draft') {
        const structure = await startStructureForTrial(versionId);
        setStudioTask({
          capabilityId: row.capabilityId,
          versionId,
          ...(sourceVersionId ? { sourceVersionId } : {}),
          title,
          returnPath,
          jobId: structure.jobId,
          eventsUrl: structure.eventsUrl,
        });
        actionContinuesInSse = true;
        return;
      }
      await launchStudioVersion({
        capabilityId: row.capabilityId,
        versionId,
        ...(sourceVersionId ? { sourceVersionId } : {}),
        title,
        returnPath,
      });
    } catch (error) {
      const resolution = await resolveTrialAuthenticationError(error, returnPath);
      if (resolution.kind === 'render') {
        setActionError(
          resolution.error instanceof Error
            ? resolution.error.message
            : '暂时没能打开设计界面，请稍后重试。',
        );
      }
    } finally {
      if (!actionContinuesInSse) {
        actionLockRef.current = false;
        setOpeningCapabilityId(null);
      }
    }
  }

  async function regenerateName(row: DashboardCapabilityRow): Promise<void> {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setActionError(null);
    setRenamingCapabilityId(row.capabilityId);
    try {
      let versionId = row.versionId;
      if (!row.studioAvailable && (row.studioDraftable || row.retryEditable)) {
        const draft = await createEditableDraft(row);
        versionId = draft.versionId;
      }
      const result = await apiPost<RegenerateFieldResult>(
        `/versions/${encodeURIComponent(versionId)}/manifest/fields/name/regenerate`,
        { reason: 'manual' },
        {
          scope: IdempotencyScope.MANIFEST_REGENERATE_FIELD,
          idempotencyKey: `manifest:rename:${versionId}:${Date.now()}`,
        },
      );
      setRenameTask({
        capabilityId: row.capabilityId,
        jobId: result.jobId,
        eventsUrl: result.eventsUrl,
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '名称没有整理成功，请稍后重试。');
      setRenamingCapabilityId(null);
      actionLockRef.current = false;
    }
  }

  const hasFilter = status !== 'all';
  const hasLoaded = query.data !== undefined;

  return (
    <section className="cb-page cb-capabilities" aria-labelledby="cb-capabilities-title">
      <header className="cb-page__head cb-page__head--split">
        <div className="cb-page__head-copy">
          <h2 className="cb-page__title" id="cb-capabilities-title">
            我的 Agent
          </h2>
          <p className="cb-page__lead">
            进入设计空间修改页面、交互与视觉效果；已发布 Agent 会从当前页面创建一个新版本。
          </p>
        </div>
        <button
          type="button"
          className="cb-btn cb-btn--primary"
          onClick={() => navigate('/create/import')}
        >
          创建 Agent
        </button>
      </header>

      {/* 状态筛选段控（当前档有选中标识）。 */}
      <div className="cb-capabilities__filters" role="group" aria-label="按状态筛选">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`cb-filter-chip${status === f.key ? ' cb-filter-chip--active' : ''}`}
            aria-pressed={status === f.key}
            onClick={() => changeFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {actionError && (
        <div className="cb-capabilities__action-error" role="alert">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)}>
            关闭
          </button>
        </div>
      )}

      {/* 首屏加载（无任何已渲染数据）→ 骨架，永不裸转圈。 */}
      {query.isPending ? (
        <LoadingState skeletonRows={5} label="Agent 列表加载中" />
      ) : query.isError && !hasLoaded ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : hasLoaded && rows.length === 0 ? (
        <div className="cb-empty" role="status">
          <p className="cb-empty__title">{hasFilter ? '该筛选下还没有 Agent' : '还没有 Agent'}</p>
          <p className="cb-empty__hint">
            {hasFilter
              ? '换一个状态筛选，或创建你的第一个 Agent。'
              : '从「创建 Agent」开始，导入工作记录并生成你的第一个 Agent。'}
          </p>
          {hasFilter && (
            <button type="button" className="cb-empty__action" onClick={() => changeFilter('all')}>
              查看全部
            </button>
          )}
        </div>
      ) : hasLoaded ? (
        <>
          <CapabilityTable
            rows={rows}
            meta={lastMeta}
            mode="manage"
            onOpenStudio={(row) => void openStudio(row)}
            onRegenerateName={(row) => void regenerateName(row)}
            openingCapabilityId={openingCapabilityId}
            renamingCapabilityId={renamingCapabilityId}
            actionsBusy={Boolean(openingCapabilityId || renamingCapabilityId)}
          />

          {/* 翻页：cursor 分页，hasMore 时给「加载更多」（追加，不替换；不做 total）。 */}
          {query.hasNextPage && (
            <div className="cb-capabilities__pager">
              <button
                type="button"
                className="cb-pager__more"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage ? '加载中…' : '加载更多'}
              </button>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
