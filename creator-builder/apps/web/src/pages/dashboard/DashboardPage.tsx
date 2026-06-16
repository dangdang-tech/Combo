// 工作台页（F-05，开工总纲 §三）——渲染在 4A Shell 主区（外壳恒定 D14）。
//
// 组装 5 个聚合区块（外壳首页-08/09/10/11/16），每区块各自 loading/error/retry（拆 5 端点取舍）：
//   ① 页头摘要（SummaryHeader）         ← /dashboard/summary
//   ② 四张大数字卡（MetricCards）        ← /dashboard/metrics（usage 3 卡占位）
//   ③ token 趋势（TokenTrendChart）      ← /dashboard/token-trend（usage 占位 + 双口径切换）
//   ④ 能力体列表（CapabilityTable）      ← /dashboard/capabilities（cursor 分页 + usage 列占位）
//   ⑤ 草稿条（DraftStrip）               ← /dashboard/drafts（真实数据）
// 时间范围切换（近7/近30/全部）作用于 summary/metrics/trend/capabilities 的 query key。
// 加载用 4A 加载件（Skeleton / ChartSkeleton），错误用 ErrorState（只 userMessage + action，无 code）。
import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Range, DashboardCapabilityRow, DraftView } from '@cb/shared';
import {
  ErrorState,
  LoadingState,
  TokenTrendChart,
  ChartSkeleton,
  type TrendMetric,
} from '../../components/index.js';
import { CREATE_STEPS } from '../../shell/routes.js';
import { RangeSwitch } from './RangeSwitch.js';
import { SummaryHeader } from './SummaryHeader.js';
import { MetricCards } from './MetricCards.js';
import {
  CapabilityTable,
  TrialNotice,
  useTrialNotice,
  MoreMenu,
  useMoreMenu,
} from './CapabilityTable.js';
import { DraftStrip } from './DraftStrip.js';
import { useSummary, useMetrics, useTokenTrend, useCapabilities, useDrafts } from './hooks.js';

const CREATE_ENTRY = CREATE_STEPS[0]?.path ?? '/create/import';

export function DashboardPage(): ReactElement {
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>('30d');
  const [trendMetric, setTrendMetric] = useState<TrendMetric>('tokens');
  const trial = useTrialNotice();
  const more = useMoreMenu();

  const summaryQ = useSummary(range);
  const metricsQ = useMetrics(range);
  const trendQ = useTokenTrend(range, trendMetric);
  const caps = useCapabilities(range);
  const drafts = useDrafts();

  // 「+ 上传新能力」/「编辑」/草稿恢复 → 五步上传流程（4C 接；本期路由占位）。
  const goCreate = (): void => navigate(CREATE_ENTRY);
  const goEdit = (row: DashboardCapabilityRow): void =>
    navigate(`${CREATE_ENTRY}?capabilityId=${row.capabilityId}`);
  // 「查看公开页」→ 对外只读公开页路由占位（不进编辑/管理；公开页 /a/{slug} 由后续接，本期落 probe 路由）。
  const goView = (row: DashboardCapabilityRow): void => {
    more.closeMore();
    navigate(`/a/${row.slug}`);
  };
  const resumeDraft = (_draft: DraftView, path: string): void => navigate(path);

  return (
    <section className="cb-page cb-dashboard" aria-label="工作台">
      {/* ① 页头摘要 + 时间范围切换 + 上传主按钮 */}
      <div className="cb-dashboard__topline">
        {summaryQ.isLoading ? (
          <LoadingState skeletonRows={2} label="摘要加载中" />
        ) : summaryQ.isError ? (
          <ErrorState error={summaryQ.error} onRetry={() => void summaryQ.refetch()} />
        ) : summaryQ.data ? (
          <SummaryHeader
            summary={summaryQ.data.data}
            meta={summaryQ.data.meta}
            onCreate={goCreate}
          />
        ) : null}
        <RangeSwitch value={range} onChange={setRange} />
      </div>

      {/* ② 四张大数字卡 */}
      <section className="cb-dashboard__metrics" aria-label="核心指标">
        {metricsQ.isLoading ? (
          <LoadingState skeletonRows={1} label="指标加载中" />
        ) : metricsQ.isError ? (
          <ErrorState error={metricsQ.error} onRetry={() => void metricsQ.refetch()} />
        ) : metricsQ.data ? (
          <MetricCards metrics={metricsQ.data.data} meta={metricsQ.data.meta} />
        ) : null}
      </section>

      {/* ③ 每日 token 消耗趋势（usage 占位 + 双口径切换） */}
      <section className="cb-dashboard__trend" aria-label="每日 token 消耗趋势">
        <h3 className="cb-dashboard__section-title">每日 token 消耗趋势</h3>
        {trendQ.isError ? (
          <ErrorState error={trendQ.error} onRetry={() => void trendQ.refetch()} />
        ) : trendQ.isLoading ? (
          <ChartSkeleton height={260} label="趋势加载中" />
        ) : (
          <TokenTrendChart
            trend={trendQ.data?.data ?? null}
            meta={trendQ.data?.meta}
            metric={trendMetric}
            onMetricChange={setTrendMetric}
          />
        )}
      </section>

      {/* ④ 我的能力体列表 */}
      <section className="cb-dashboard__capabilities" aria-label="我的能力体">
        <div className="cb-dashboard__section-head">
          <h3 className="cb-dashboard__section-title">我的能力体</h3>
          <button type="button" className="cb-btn cb-btn--primary" onClick={goCreate}>
            + 上传新能力
          </button>
        </div>
        {caps.isLoading ? (
          <LoadingState skeletonRows={4} label="能力列表加载中" />
        ) : caps.isError ? (
          <ErrorState error={caps.error} onRetry={caps.retry} />
        ) : (
          <>
            <CapabilityTable
              rows={caps.items}
              meta={caps.meta}
              onTrial={trial.openTrial}
              onEdit={goEdit}
              onMore={more.openMore}
            />
            {caps.hasMore && (
              <button
                type="button"
                className="cb-loadmore"
                onClick={caps.loadMore}
                disabled={caps.isFetching}
              >
                {caps.isFetching ? '加载中…' : '加载更多'}
              </button>
            )}
          </>
        )}
      </section>

      {/* ⑤ 草稿与上传中条 */}
      <section className="cb-dashboard__drafts" aria-label="草稿与上传中">
        {drafts.isLoading ? (
          <LoadingState skeletonRows={1} label="草稿加载中" />
        ) : drafts.isError ? (
          <ErrorState error={drafts.error} onRetry={drafts.retry} />
        ) : (
          <>
            <DraftStrip drafts={drafts.items} onResume={resumeDraft} />
            {drafts.hasMore && (
              <button
                type="button"
                className="cb-loadmore"
                onClick={drafts.loadMore}
                disabled={drafts.isFetching}
              >
                {drafts.isFetching ? '加载中…' : '加载更多草稿'}
              </button>
            )}
          </>
        )}
      </section>

      {/* 试用「本期未开放」占位浮层 */}
      <TrialNotice capabilityName={trial.noticeName} onClose={trial.closeTrial} />

      {/* 更多菜单（下架/改价占位 + 查看公开页路由占位，外壳首页-35） */}
      <MoreMenu
        state={more.state}
        onView={goView}
        onPending={more.setPending}
        onClose={more.closeMore}
      />
    </section>
  );
}
