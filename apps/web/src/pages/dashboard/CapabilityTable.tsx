// 共享 Agent 列表：analytics 模式保留经营列；manage 模式是项目列表。
// 管理页用稳定身份标识帮助识别，并只展示真实可执行动作：继续 UI Studio、自动命名、公开页。
// 创建新 Agent 由页面级 CTA 承担；被拒态继续显示后端拒绝原因。
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { DashboardCapabilityRow, Meta } from '@cb/shared';
import { MiniSparkline, UsagePlaceholder } from '../../components/index.js';

export interface CapabilityTableProps {
  rows: DashboardCapabilityRow[];
  meta: Meta | undefined;
  mode?: 'analytics' | 'manage';
  onOpenStudio?: (row: DashboardCapabilityRow) => void;
  onRegenerateName?: (row: DashboardCapabilityRow) => void;
  openingCapabilityId?: string | null;
  renamingCapabilityId?: string | null;
  actionsBusy?: boolean;
}

/** 状态徽章：颜色档由后端 reviewStatus 单源派生（前端不另判业务态）。 */
const STATUS_TONE: Record<DashboardCapabilityRow['reviewStatus'], string> = {
  published: 'ok',
  alpha_pending: 'pending',
  review_rejected: 'rejected',
  draft: 'neutral',
  unpublished: 'neutral',
};

function StatusBadge({ row }: { row: DashboardCapabilityRow }): ReactElement {
  return (
    <span
      className="cb-cap-status"
      data-status={row.reviewStatus}
      data-tone={STATUS_TONE[row.reviewStatus]}
    >
      {row.statusLabel}
    </span>
  );
}

function agentMark(name: string): string {
  const cjk = [...name].filter((char) => /[\u3400-\u9fff]/.test(char));
  if (cjk.length > 0) return cjk.slice(0, 2).join('');
  const words = name
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'AG';
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
}

function identityVariant(capabilityId: string): number {
  let hash = 0;
  for (const char of capabilityId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (hash % 8) + 1;
}

function updatedLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '刚刚更新';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function AgentIdentity({ row }: { row: DashboardCapabilityRow }): ReactElement {
  return (
    <div className="cb-agent-identity">
      <span
        className="cb-agent-mark"
        data-variant={identityVariant(row.capabilityId)}
        aria-hidden="true"
      >
        {agentMark(row.name)}
      </span>
      <span className="cb-agent-identity__copy">
        <span className="cb-cap-row__title">{row.name}</span>
        <span className="cb-cap-row__tagline">{row.tagline}</span>
        {row.nameNeedsReview && <span className="cb-agent-name-review">名称可优化</span>}
      </span>
    </div>
  );
}

function studioAction(row: DashboardCapabilityRow): { label: string; ariaPrefix: string } {
  if (row.studioAvailable) return { label: '编辑 UI', ariaPrefix: '编辑' };
  if (row.retryEditable && row.retryVersionId) return { label: '修复 UI', ariaPrefix: '修复' };
  if (row.studioDraftable) return { label: '新建 UI 版本', ariaPrefix: '新建' };
  return { label: '生成 UI', ariaPrefix: '生成' };
}

function CapabilityRow({
  row,
  meta,
  mode,
  onOpenStudio,
  onRegenerateName,
  openingCapabilityId,
  renamingCapabilityId,
  actionsBusy,
}: {
  row: DashboardCapabilityRow;
  meta: Meta | undefined;
  mode: 'analytics' | 'manage';
  onOpenStudio?: (row: DashboardCapabilityRow) => void;
  onRegenerateName?: (row: DashboardCapabilityRow) => void;
  openingCapabilityId?: string | null;
  renamingCapabilityId?: string | null;
  actionsBusy: boolean;
}): ReactElement {
  const opening = openingCapabilityId === row.capabilityId;
  const renaming = renamingCapabilityId === row.capabilityId;
  const canPrepareDraft = row.reviewStatus === 'draft' && !row.studioAvailable;
  const canRetryRejected = row.retryEditable && Boolean(row.retryVersionId);
  const canOpenStudio =
    mode === 'manage' &&
    (row.studioAvailable || row.studioDraftable || canRetryRejected || canPrepareDraft) &&
    Boolean(onOpenStudio);
  const canRegenerateName =
    mode === 'manage' &&
    row.nameNeedsReview &&
    (row.studioAvailable ||
      row.studioDraftable ||
      canRetryRejected ||
      row.reviewStatus === 'draft') &&
    Boolean(onRegenerateName);
  const designAction = studioAction(row);
  const publicPage = row.publicPageAvailable ? (
    <Link
      className="cb-cap-action cb-cap-action--view"
      to={`/a/${encodeURIComponent(row.slug)}`}
      aria-label={`打开「${row.name}」公开页`}
    >
      公开页
    </Link>
  ) : null;

  const hasActions = canOpenStudio || canRegenerateName || publicPage !== null;

  return (
    <tr className="cb-cap-row" data-capability={row.capabilityId}>
      <td className="cb-cap-row__name">
        <AgentIdentity row={row} />
      </td>
      <td className="cb-cap-row__status">
        <StatusBadge row={row} />
        {row.reviewStatus === 'published' && row.studioAvailable && (
          <span className="cb-cap-row__draft-note">有未发布修改</span>
        )}
        {row.reviewStatus === 'review_rejected' && row.rejectReason && (
          <span className="cb-cap-row__reject" title={row.rejectReason}>
            {row.rejectReason}
          </span>
        )}
      </td>
      {mode === 'analytics' ? (
        <>
          <td className="cb-cap-row__invocations">
            {row.monthlyInvocations === null ? (
              <UsagePlaceholder field="monthlyInvocations" meta={meta} />
            ) : (
              <span>{row.monthlyInvocations}</span>
            )}
          </td>
          <td className="cb-cap-row__spend">
            <MiniSparkline
              points={row.spendSparkline}
              meta={meta}
              placeholderField="spendSparkline"
            />
          </td>
          <td className="cb-cap-row__revenue">
            {row.revenueMicros === null ? (
              <UsagePlaceholder field="revenueMicros" meta={meta} />
            ) : (
              <span>{(row.revenueMicros / 1_000_000).toFixed(2)}</span>
            )}
          </td>
        </>
      ) : (
        <td className="cb-cap-row__updated">
          <time dateTime={row.updatedAt}>{updatedLabel(row.updatedAt)}</time>
        </td>
      )}
      <td className="cb-cap-row__actions" aria-label={hasActions ? undefined : '暂无可用操作'}>
        {hasActions && (
          <span className="cb-cap-row__action-list">
            {canOpenStudio && onOpenStudio && (
              <button
                type="button"
                className="cb-cap-action cb-cap-action--design"
                disabled={actionsBusy}
                onClick={() => onOpenStudio(row)}
                aria-label={`${designAction.ariaPrefix}「${row.name}」UI 版本`}
              >
                {opening ? '正在准备…' : designAction.label}
              </button>
            )}
            {canRegenerateName && onRegenerateName && (
              <button
                type="button"
                className="cb-cap-action cb-cap-action--rename"
                disabled={actionsBusy}
                onClick={() => onRegenerateName(row)}
                aria-label={`自动整理「${row.name}」名称`}
              >
                {renaming ? '命名中…' : '自动命名'}
              </button>
            )}
            {publicPage}
          </span>
        )}
      </td>
    </tr>
  );
}

/** 空态（外壳首页-23 类比）：无能力 → 友好空态，不裸空表。 */
function EmptyRow({ colSpan }: { colSpan: number }): ReactElement {
  return (
    <tr className="cb-cap-row cb-cap-row--empty">
      <td colSpan={colSpan} className="cb-cap-row__empty">
        还没有 Agent，点右上「创建 Agent」开始第一个。
      </td>
    </tr>
  );
}

export function CapabilityTable({
  rows,
  meta,
  mode = 'analytics',
  onOpenStudio,
  onRegenerateName,
  openingCapabilityId,
  renamingCapabilityId,
  actionsBusy = false,
}: CapabilityTableProps): ReactElement {
  return (
    <table className={`cb-cap-table cb-cap-table--${mode}`} aria-busy={actionsBusy}>
      <thead>
        {mode === 'analytics' ? (
          <tr>
            <th scope="col">Agent</th>
            <th scope="col">状态</th>
            <th scope="col">本月调用</th>
            <th scope="col">消耗趋势</th>
            <th scope="col">收益</th>
            <th scope="col">操作</th>
          </tr>
        ) : (
          <tr>
            <th scope="col">Agent</th>
            <th scope="col">状态</th>
            <th scope="col">最近更新</th>
            <th scope="col">UI 与交互</th>
          </tr>
        )}
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow colSpan={mode === 'analytics' ? 6 : 4} />
        ) : (
          rows.map((r) => (
            <CapabilityRow
              key={r.capabilityId}
              row={r}
              meta={meta}
              mode={mode}
              onOpenStudio={onOpenStudio}
              onRegenerateName={onRegenerateName}
              openingCapabilityId={openingCapabilityId}
              renamingCapabilityId={renamingCapabilityId}
              actionsBusy={actionsBusy}
            />
          ))
        )}
      </tbody>
    </table>
  );
}
