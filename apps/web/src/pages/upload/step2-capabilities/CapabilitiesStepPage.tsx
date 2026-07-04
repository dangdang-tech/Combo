// 能力页（PRD 2 步之第 2 步）——融合原「提取过程态 + 候选选择」为单页两态，接 3C 提取 API/SSE。
//
// 两态（结构坍缩：提取过程态不占独立路由，是本页的第一个阶段）：
//   1. extracting（过程态）：带 ?snapshotId= 进入 → 若无 extractJobId 先 createExtractJob 触发 → 订阅 job SSE，
//      复用 step2-extract 的 ExtractLoading（圆环进度 + 指标 + 已发现列表）。job 终态 → 拉候选进 ready。
//   2. ready：候选渲染成 PRD 单列能力行（名称 + 分类标签 + 一句话描述 + 来源 session 段数[信任背书] +
//      复选框[默认全选] + 「试用」真实入口）。底部「一键发布」为禁用占位（批量发布已整体下线，
//      2026-07-04 决策：发布流程重构中，本期暂不开放）。
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import type { CandidateView, DonePayload, ExtractDoneResult } from '@cb/shared';
import { ApiError, useSSE, type UseSSEState } from '../../../api/index.js';
import { ErrorState, LoadingState } from '../../../components/index.js';
import { useWizard } from '../../wizard/index.js';
import {
  ExtractLoading,
  createExtractJob,
  fetchCandidates,
  jobEventsUrl,
  nameText,
  categoryText,
  segmentText,
} from '../step2-extract/index.js';
import {
  createCapabilityForTrial,
  createRuntimeTrialSession,
  openRuntimeTrial,
  startStructureForTrial,
} from './trialApi.js';

type Phase = { kind: 'triggering' } | { kind: 'extracting'; jobId: string } | { kind: 'ready' };
type TrialLaunchPhase = 'creating' | 'structuring' | 'opening' | 'error';

interface TrialLaunchState {
  candidateId: string;
  candidateName: string;
  phase: TrialLaunchPhase;
  capabilityId?: string;
  versionId?: string;
  structureUrl?: string;
  error?: string;
}

const TRIAL_PHASE_LABEL: Record<TrialLaunchPhase, string> = {
  creating: '准备试用…',
  structuring: '生成试用能力…',
  opening: '打开试用…',
  error: '重试试用 →',
};

/** 发布禁用占位文案（批量发布整体下线，本期未开放先例风格）。 */
const PUBLISH_PENDING_HINT = '发布流程重构中，本期暂不开放';

function fallbackError(userMessage: string): ApiError {
  return new ApiError({ error: { userMessage, retriable: true, action: 'retry', traceId: '' } });
}

/** done.result → ExtractDoneResult（done.result 是 unknown，安全收窄；形态不符则 undefined）。 */
function doneResultOf(done: DonePayload | undefined): ExtractDoneResult | undefined {
  const r = done?.result;
  if (r && typeof r === 'object' && 'candidateCount' in r) return r as ExtractDoneResult;
  return undefined;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.userMessage;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function capabilitiesReturnTo(input: {
  pathname: string;
  search: string;
  hash: string;
  draftId?: string;
  snapshotId?: string;
  extractJobId?: string;
}): string {
  const params = new URLSearchParams(input.search);
  if (input.snapshotId && !params.has('snapshotId')) params.set('snapshotId', input.snapshotId);
  if (input.draftId && !params.has('draftId')) params.set('draftId', input.draftId);
  if (input.extractJobId && !params.has('extractJobId')) {
    params.set('extractJobId', input.extractJobId);
  }
  const query = params.toString();
  return `${input.pathname}${query ? `?${query}` : ''}${input.hash}`;
}

/** SSE 加载子组件：订阅萃取 job 流；done → 上抛 jobId 拉候选；失败上抛。key 控重订阅。 */
function ExtractJobStream({
  jobId,
  onDone,
  onError,
  onJobRetry,
}: {
  jobId: string;
  onDone: (jobId: string, done: DonePayload | undefined) => void;
  onError: () => void;
  onJobRetry: () => void;
}): ReactElement {
  const sse: UseSSEState = useSSE(jobEventsUrl(jobId), 'job');

  useEffect(() => {
    if (sse.status === 'done') onDone(jobId, sse.done);
  }, [sse.status, sse.done, jobId, onDone]);

  useEffect(() => {
    if (sse.status === 'error') onError();
  }, [sse.status, onError]);

  return <ExtractLoading state={sse} onJobRetry={onJobRetry} />;
}

export function CapabilitiesStepPage(): ReactElement {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const { draftId: ctxDraftId, snapshotId: ctxSnapshotId } = useWizard();

  // 来源优先级：URL ?snapshotId= / ?extractJobId=（上传自动带入或深链）→ 向导上下文回填。
  const snapshotId = searchParams.get('snapshotId') ?? ctxSnapshotId ?? undefined;
  const urlExtractJobId = searchParams.get('extractJobId') ?? undefined;
  const draftId = ctxDraftId ?? searchParams.get('draftId') ?? undefined;

  // 有 extractJobId → 直接连该流；否则触发新萃取。
  const [phase, setPhase] = useState<Phase>(
    urlExtractJobId ? { kind: 'extracting', jobId: urlExtractJobId } : { kind: 'triggering' },
  );
  const [candidates, setCandidates] = useState<CandidateView[]>([]);
  const [doneResult, setDoneResult] = useState<ExtractDoneResult | undefined>();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const failCountRef = useRef(0);

  const [trialLaunch, setTrialLaunch] = useState<TrialLaunchState | null>(null);

  // 触发幂等键带萃取策略版本：同一 snapshot 切到新版 session-mock 后要重新跑，不回放旧聚类结果。
  const triggerKey = useMemo(
    () =>
      snapshotId ? `extract:session-mock-v1:${draftId ?? 'nodraft'}:${snapshotId}` : undefined,
    [snapshotId, draftId],
  );

  // 触发萃取（仅 triggering 且有 snapshotId）。
  useEffect(() => {
    if (phase.kind !== 'triggering') return;
    if (!snapshotId || !triggerKey) {
      setError(fallbackError('没找到要提取的原始数据，回上一步重新导入。'));
      return;
    }
    let active = true;
    void (async () => {
      try {
        const accepted = await createExtractJob(snapshotId, triggerKey, draftId ? { draftId } : {});
        if (!active) return;
        setPhase({ kind: 'extracting', jobId: accepted.jobId });
      } catch (e) {
        if (!active) return;
        setError(e instanceof ApiError ? e : fallbackError('提取没能开始，请稍后重试。'));
      }
    })();
    return () => {
      active = false;
    };
  }, [phase.kind, snapshotId, triggerKey, draftId, attempt]);

  // SSE done → 拉全量候选 → 默认全选（ready 项）→ ready 态。
  const handleJobDone = useCallback((doneJobId: string, done: DonePayload | undefined): void => {
    setDoneResult(doneResultOf(done));
    void (async () => {
      try {
        const res = await fetchCandidates(doneJobId, { limit: 50 });
        failCountRef.current = 0;
        setCandidates(res.candidates);
        // 默认全选（仅 ready 可发布；失败项不入选）。
        setSelectedIds(
          new Set(res.candidates.filter((c) => c.status === 'ready').map((c) => c.id)),
        );
        setPhase({ kind: 'ready' });
      } catch (e) {
        setError(e instanceof ApiError ? e : fallbackError('候选加载失败，请稍后重试。'));
      }
    })();
  }, []);

  const handleJobError = useCallback((): void => {
    failCountRef.current += 1;
  }, []);

  const handleJobRetry = useCallback((): void => {
    failCountRef.current = 0;
    setAttempt((a) => a + 1);
  }, []);

  const handleToggle = useCallback((candidateId: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });
  }, []);

  const handleToggleAll = useCallback((): void => {
    setSelectedIds((prev) => {
      const readyIds = candidates.filter((c) => c.status === 'ready').map((c) => c.id);
      if (readyIds.length === 0) return prev;
      const allSelected = readyIds.every((id) => prev.has(id));
      return allSelected ? new Set() : new Set(readyIds);
    });
  }, [candidates]);

  const handleTrial = useCallback(
    (candidate: CandidateView): void => {
      if (trialLaunch && trialLaunch.phase !== 'error') return;
      const candidateName = nameText(candidate.name);
      const trialCapability = candidate.trialCapability;
      if (trialCapability) {
        setTrialLaunch({ candidateId: candidate.id, candidateName, phase: 'opening' });
        void (async () => {
          try {
            const created = await createRuntimeTrialSession({
              capabilityId: trialCapability.capabilityId,
              versionId: trialCapability.versionId,
              title: `${candidateName} 试用`,
            });
            const returnTo = encodeURIComponent(
              capabilitiesReturnTo({
                pathname: location.pathname,
                search: location.search,
                hash: location.hash,
                draftId,
                snapshotId,
                extractJobId: urlExtractJobId,
              }),
            );
            openRuntimeTrial(`/try/session/${created.session.id}?returnTo=${returnTo}`);
          } catch (e) {
            setTrialLaunch((current) =>
              current?.candidateId === candidate.id
                ? {
                    ...current,
                    phase: 'error',
                    error: errorMessage(e, '没能打开试用，请稍后重试。'),
                  }
                : current,
            );
          }
        })();
        return;
      }

      setTrialLaunch({ candidateId: candidate.id, candidateName, phase: 'creating' });
      void (async () => {
        try {
          const created = await createCapabilityForTrial(candidate.id);
          setTrialLaunch((current) =>
            current?.candidateId === candidate.id
              ? {
                  ...current,
                  phase: 'structuring',
                  capabilityId: created.capabilityId,
                  versionId: created.versionId,
                }
              : current,
          );
          const structure = await startStructureForTrial(created.versionId);
          setTrialLaunch((current) =>
            current?.candidateId === candidate.id
              ? {
                  ...current,
                  phase: 'structuring',
                  capabilityId: created.capabilityId,
                  versionId: created.versionId,
                  structureUrl: structure.eventsUrl,
                }
              : current,
          );
        } catch (e) {
          setTrialLaunch((current) =>
            current?.candidateId === candidate.id
              ? {
                  ...current,
                  phase: 'error',
                  error: errorMessage(e, '没能准备试用，请稍后重试。'),
                }
              : current,
          );
        }
      })();
    },
    [
      draftId,
      location.hash,
      location.pathname,
      location.search,
      snapshotId,
      trialLaunch,
      urlExtractJobId,
    ],
  );

  const trialSse = useSSE(trialLaunch?.structureUrl ?? null, 'structure', {
    enabled: Boolean(trialLaunch?.structureUrl),
  });

  useEffect(() => {
    if (
      !trialLaunch ||
      trialLaunch.phase !== 'structuring' ||
      !trialLaunch.capabilityId ||
      !trialLaunch.versionId
    ) {
      return;
    }
    if (trialSse.status === 'error') {
      setTrialLaunch((current) =>
        current?.candidateId === trialLaunch.candidateId
          ? {
              ...current,
              phase: 'error',
              error: trialSse.error?.userMessage ?? '生成试用能力失败，请稍后重试。',
            }
          : current,
      );
      return;
    }
    if (trialSse.status !== 'done') return;
    if (trialSse.done?.status !== 'completed') {
      setTrialLaunch((current) =>
        current?.candidateId === trialLaunch.candidateId
          ? {
              ...current,
              phase: 'error',
              error: trialSse.done?.error?.error.userMessage ?? '生成试用能力失败，请稍后重试。',
            }
          : current,
      );
      return;
    }

    const { candidateId, candidateName, capabilityId, versionId } = trialLaunch;
    setTrialLaunch((current) =>
      current?.candidateId === candidateId ? { ...current, phase: 'opening' } : current,
    );
    void (async () => {
      try {
        const created = await createRuntimeTrialSession({
          capabilityId,
          versionId,
          title: `${candidateName} 试用`,
        });
        const returnTo = encodeURIComponent(
          capabilitiesReturnTo({
            pathname: location.pathname,
            search: location.search,
            hash: location.hash,
            draftId,
            snapshotId,
            extractJobId: urlExtractJobId,
          }),
        );
        openRuntimeTrial(`/try/session/${created.session.id}?returnTo=${returnTo}`);
      } catch (e) {
        setTrialLaunch((current) =>
          current?.candidateId === candidateId
            ? {
                ...current,
                phase: 'error',
                error: errorMessage(e, '没能打开试用，请稍后重试。'),
              }
            : current,
        );
      }
    })();
  }, [
    draftId,
    location.hash,
    location.pathname,
    location.search,
    snapshotId,
    trialLaunch,
    trialSse.done,
    trialSse.error,
    trialSse.status,
    urlExtractJobId,
  ]);

  const readyCount = candidates.filter((c) => c.status === 'ready').length;
  const selectedCount = candidates.filter(
    (c) => c.status === 'ready' && selectedIds.has(c.id),
  ).length;

  // —— 渲染 ——
  if (error) {
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          setError(null);
          if (phase.kind === 'triggering') setAttempt((a) => a + 1);
          else handleJobRetry();
        }}
      />
    );
  }

  if (phase.kind === 'triggering') {
    return <LoadingState skeletonRows={4} label="正在准备提取" />;
  }

  if (phase.kind === 'extracting') {
    return (
      <ExtractJobStream
        key={`${phase.jobId}-${attempt}`}
        jobId={phase.jobId}
        onDone={handleJobDone}
        onError={handleJobError}
        onJobRetry={handleJobRetry}
      />
    );
  }

  const analyzed = doneResult?.analyzedSegments;
  const identified = doneResult?.candidateCount ?? candidates.length;
  const allReadySelected = readyCount > 0 && selectedCount === readyCount;

  return (
    <section className="cb-capabilities" aria-label="从对话历史提取出的能力">
      <header className="cb-capabilities__header">
        <p className="cb-capabilities__eyebrow">第二步 · 能力</p>
        <h1 className="cb-capabilities__title">你的能力，挑选后一键发布</h1>
        <p className="cb-capabilities__lead">
          我们从 sessions 里提取了这些能力，每条都能发成一个市集
          mini-app。点任意一项可直接打开「试用」跑一遍，确认后勾选、一键发布。
        </p>
      </header>

      {candidates.length === 0 ? (
        <p className="cb-capabilities__empty">
          没识别出可复用的能力。可以回上一步换个目录再导入，或多积累一些对话历史后再来。
        </p>
      ) : (
        <>
          <div className="cb-capabilities__toolbar">
            <span className="cb-capabilities__selected">
              已选 <strong>{selectedCount}</strong> / {readyCount} 项
              {typeof analyzed === 'number' && (
                <span className="cb-capabilities__analyzed">
                  · 已分析 {analyzed.toLocaleString('en-US')} 段 session
                </span>
              )}
              <span className="cb-capabilities__analyzed"> · 识别出 {identified} 项</span>
            </span>
            {readyCount > 0 && (
              <button
                type="button"
                className="cb-link cb-capabilities__select-all"
                onClick={handleToggleAll}
              >
                {allReadySelected ? '取消全选' : '全选'}
              </button>
            )}
          </div>

          <ul className="cb-capabilities__list" aria-label="能力卡列表">
            {candidates.map((c) => {
              const failed = c.status === 'failed';
              const checked = selectedIds.has(c.id);
              const trialForCard = trialLaunch?.candidateId === c.id ? trialLaunch : null;
              const trialDisabled = Boolean(trialLaunch && trialLaunch.phase !== 'error');
              return (
                <li
                  key={c.id}
                  className="cb-cap-card"
                  data-status={c.status}
                  data-selected={checked ? 'true' : 'false'}
                >
                  <div className="cb-cap-card__select">
                    {!failed ? (
                      <input
                        type="checkbox"
                        className="cb-cap-card__checkbox"
                        checked={checked}
                        onChange={() => handleToggle(c.id)}
                        aria-label={`选择能力「${nameText(c.name)}」`}
                      />
                    ) : (
                      <span className="cb-cap-card__failed-mark" aria-hidden="true">
                        !
                      </span>
                    )}
                  </div>

                  <div className="cb-cap-card__body">
                    <div className="cb-cap-card__head">
                      <span className="cb-cap-card__name">{nameText(c.name)}</span>
                      <span className="cb-cap-card__type">{categoryText(c)}</span>
                    </div>
                    {c.intent && <p className="cb-cap-card__intent">{c.intent}</p>}
                    <p className="cb-cap-card__segments">
                      来自 {segmentText(c.segmentCount)} session
                    </p>
                    {failed && (
                      <p className="cb-cap-card__fail">
                        {c.error?.userMessage ?? '这一项没能识别出来。'}
                      </p>
                    )}
                  </div>

                  <div className="cb-cap-card__actions">
                    {!failed && (
                      <button
                        type="button"
                        className="cb-cap-card__trial"
                        onClick={() => handleTrial(c)}
                        disabled={trialDisabled}
                        aria-disabled={trialDisabled}
                      >
                        {trialForCard ? TRIAL_PHASE_LABEL[trialForCard.phase] : '试用 →'}
                      </button>
                    )}

                    {trialForCard?.phase === 'error' && trialForCard.error && (
                      <span className="cb-cap-card__status-msg">{trialForCard.error}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* 底部动作区：发布入口为禁用占位（批量发布已整体下线，2026-07-04 决策；点击无动作）。 */}
      {readyCount > 0 && (
        <footer className="cb-capabilities__foot">
          <button
            type="button"
            className="cb-btn cb-btn--primary cb-capabilities__publish"
            disabled
            aria-disabled="true"
            title={PUBLISH_PENDING_HINT}
          >
            {PUBLISH_PENDING_HINT}
          </button>
        </footer>
      )}
    </section>
  );
}
