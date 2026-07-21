// STEP① 配对命令框（F-10，开工总纲 §5.1）——铸码后展示本机连接命令，并把真实上传状态提升为主交互。
//
// 状态（对齐 PairPhase，导入-25）：
//   - waiting：等待用户在终端运行命令。
//   - uploading：助手已经上传至少一个分片；展示服务端已落地的真实进度，不伪造速度 / ETA。
//   - job_created：原始记录上传完成，正在接入云端处理。
//   - expired：配对码过期，可恢复地重新生成。
import type { ReactElement } from 'react';
import type { PairPhase, PairResult, PairStatusView } from '@cb/shared';
import type { ApiError } from '../../../api/index.js';

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

/**
 * 后端当前返回的命令形如 `curl -fsSL http://.../script?code=123 | sh`。
 * zsh 默认开启 nomatch，未加引号的 `?code=` 会被当成文件 glob，导致 curl 尚未执行就失败。
 * 这里保持命令语义不变，只把 URL 参数段做 shell-safe 引号处理；复制与展示共用同一结果。
 */
export function shellSafePairCommand(command: string): string {
  return command.replace(
    /(curl(?:\s+-[A-Za-z]+)*\s+)(https?:\/\/[^\s'"]*\?[^\s'"]*)(?=\s|$)/u,
    (_match, prefix: string, url: string) => `${prefix}${shellQuote(url)}`,
  );
}

export interface CommandBoxProps {
  /** 铸码结果（command 一行命令 + curlOneLiner 验收口径串 + expiresAt）。 */
  pair: PairResult;
  /** 轮询到的最新状态（未轮询到时按 waiting 处理）。 */
  status: PairStatusView | undefined;
  /** 点「复制命令」（上层接剪贴板 + 短反馈；本件只回调）。 */
  onCopy: () => void;
  /** 是否正处于复制成功的短反馈窗口。 */
  copied?: boolean;
  /** 配对码过期 → 点「重新生成」重新铸码。 */
  onRegenerate: () => void;
  /** 可恢复的状态轮询瞬断；命令与已传进度仍保留。 */
  reconnecting?: boolean;
  /** 重连中显示的人话错误。 */
  error?: ApiError | undefined;
  /** 正在重新铸码；禁用按钮避免并发生成两条任务。 */
  regenerating?: boolean;
}

const PHASE_COPY: Record<
  PairPhase,
  { badge: string; title: string; lead: string; announcement: string }
> = {
  waiting: {
    badge: '等待本机连接',
    title: '复制命令，连接你的本机会话',
    lead: '在终端运行下面的命令。助手会完整上传原始记录，后续由云端解析并去敏。',
    announcement: '正在等待你在终端运行命令。',
  },
  uploading: {
    badge: '云端已接收',
    title: '会话上传进行中',
    lead: '只要终端仍在运行，传输就会继续。你可以切换页面，回来后仍会显示同一次任务。',
    announcement: '云端已经收到上传分片，任务仍处于上传阶段。',
  },
  job_created: {
    badge: '上传完成',
    title: '记录已上传，正在接入云端处理',
    lead: '原始记录已经完整接收，接下来会自动解析、去敏并提取可复用的 Agent。',
    announcement: '上传已经完成，正在启动云端处理。',
  },
  expired: {
    badge: '连接已过期',
    title: '这次连接已过期',
    lead: '配对码有时效保护。重新生成后，在终端运行新命令即可继续。',
    announcement: '这次连接已经过期，需要重新生成命令。',
  },
};

type StageState = 'done' | 'current' | 'upcoming' | 'issue';

function stageStates(status: PairStatusView | undefined): [StageState, StageState, StageState] {
  const phase = status?.phase ?? 'waiting';
  switch (phase) {
    case 'uploading':
      return ['done', 'current', 'upcoming'];
    case 'job_created':
      return ['done', 'done', 'current'];
    case 'expired':
      return typeof status?.uploadedParts === 'number' && status.uploadedParts > 0
        ? ['done', 'issue', 'upcoming']
        : ['issue', 'upcoming', 'upcoming'];
    case 'waiting':
    default:
      return ['current', 'upcoming', 'upcoming'];
  }
}

const STAGES = [
  { label: '运行本机命令', note: '建立一次性安全连接' },
  { label: '上传原始记录', note: '显示真实分片进度' },
  { label: '云端解析并去敏', note: '完成后自动开始' },
] as const;

function stageStateLabel(state: StageState): string {
  switch (state) {
    case 'done':
      return '已完成';
    case 'current':
      return '当前步骤';
    case 'issue':
      return '需要处理';
    case 'upcoming':
    default:
      return '待进行';
  }
}

function PairStageRail({ status }: { status: PairStatusView | undefined }): ReactElement {
  const states = stageStates(status);

  return (
    <ol className="cb-cmdbox__journey" aria-label="导入阶段">
      {STAGES.map((stage, index) => {
        const state = states[index] ?? 'upcoming';
        const stateLabel = stageStateLabel(state);
        return (
          <li
            key={stage.label}
            className="cb-cmdbox__journey-step"
            data-state={state}
            aria-label={`${stateLabel}：${stage.label}`}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className="cb-cmdbox__journey-index" aria-hidden="true">
              {state === 'done' ? '✓' : index + 1}
            </span>
            <span className="cb-cmdbox__journey-copy">
              <strong>{stage.label}</strong>
              <small>{stage.note}</small>
            </span>
            <span className="cb-cmdbox__journey-state" aria-hidden="true">
              {stateLabel}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function PairStatusPanel({
  status,
  reconnecting = false,
  error,
}: {
  status: PairStatusView | undefined;
  reconnecting?: boolean;
  error?: ApiError | undefined;
}): ReactElement {
  const phase = status?.phase ?? 'waiting';
  const copy = PHASE_COPY[phase];
  const rawDone = status?.uploadedParts;
  const rawTotal = status?.totalParts;
  const done = typeof rawDone === 'number' ? Math.max(0, rawDone) : undefined;
  const total = typeof rawTotal === 'number' && rawTotal > 0 ? rawTotal : undefined;
  const clampedDone = done !== undefined && total !== undefined ? Math.min(done, total) : done;
  const percent =
    clampedDone !== undefined && total !== undefined
      ? Math.min(100, Math.round((clampedDone / total) * 100))
      : undefined;
  const remaining =
    clampedDone !== undefined && total !== undefined ? Math.max(0, total - clampedDone) : undefined;
  const displayDone = clampedDone ?? done;
  const showUploadProgress = phase === 'uploading';
  const visiblePhase =
    phase === 'expired' && displayDone !== undefined && displayDone > 0
      ? `云端已收到 ${displayDone}${total !== undefined ? ` / ${total}` : ''} 个分片；连接已过期，需要重新生成。`
      : copy.announcement;

  return (
    <section
      className="cb-cmdbox__status"
      data-phase={phase}
      data-reconnecting={reconnecting || undefined}
      aria-label="上传状态"
    >
      <p className="cb-cmdbox__announcement" role="status" aria-live="polite">
        {reconnecting && error ? error.userMessage : copy.announcement}
      </p>

      {showUploadProgress ? (
        <>
          <div className="cb-cmdbox__status-topline">
            <span className="cb-cmdbox__live-badge">
              <span className="cb-cmdbox__status-dot" aria-hidden="true" />
              {reconnecting ? '状态重连中' : '云端已接收'}
            </span>
            <span className="cb-cmdbox__status-truth">以云端已接收分片为准</span>
          </div>

          <div className="cb-cmdbox__progress-head">
            <div>
              <span className="cb-cmdbox__progress-label">上传进度</span>
              <strong className="cb-cmdbox__percent">
                {percent !== undefined ? `${percent}%` : '传输中'}
              </strong>
            </div>
            <div className="cb-cmdbox__parts">
              <strong>
                {displayDone !== undefined ? displayDone : '—'}
                {total !== undefined ? ` / ${total}` : ''}
              </strong>
              <span>{total !== undefined ? '分片已接收' : '个分片已接收'}</span>
            </div>
          </div>

          {clampedDone !== undefined && total !== undefined && (
            <progress
              className="cb-cmdbox__progress"
              aria-label="终端上传进度"
              aria-valuetext={`已接收 ${clampedDone} / ${total} 个分片，${percent}%`}
              value={clampedDone}
              max={total}
            />
          )}

          <div className="cb-cmdbox__progress-foot">
            <span>
              {remaining !== undefined
                ? `还剩 ${remaining} 个分片`
                : displayDone !== undefined
                  ? `已接收 ${displayDone} 个分片，仍在上传`
                  : '正在等待更多上传进度'}
            </span>
            <span>完成后自动进入云端处理</span>
          </div>
        </>
      ) : (
        <div className="cb-cmdbox__status-line">
          <span className="cb-cmdbox__status-dot" aria-hidden="true" />
          <p className="cb-cmdbox__phase">{visiblePhase}</p>
        </div>
      )}

      {reconnecting && error && (
        <p className="cb-cmdbox__connection">
          网页状态正在重连；已经收到的进度会保留。{error.userMessage}
        </p>
      )}
    </section>
  );
}

function TerminalCommand({
  command,
  copied,
  expired,
  onCopy,
}: {
  command: string;
  copied: boolean;
  expired: boolean;
  onCopy: () => void;
}): ReactElement {
  return (
    <div className="cb-cmdbox__command">
      <code className="cb-cmdbox__command-text">{command}</code>
      <button type="button" className="cb-btn cb-cmdbox__copy" onClick={onCopy} disabled={expired}>
        {copied ? '已复制 ✓' : '复制命令'}
      </button>
      <span className="cb-cmdbox__announcement" role="status" aria-live="polite">
        {copied ? '命令已复制，可以粘贴到终端运行。' : ''}
      </span>
    </div>
  );
}

function Reassurance(): ReactElement {
  return (
    <aside className="cb-cmdbox__reassurance" aria-label="上传期间注意事项">
      <span aria-hidden="true">i</span>
      <p>
        <strong>终端窗口需要保持运行。</strong>
        关闭或切换这个网页不会中断终端里的上传；回来后页面会恢复同一次任务的进度。
      </p>
    </aside>
  );
}

export function CommandBox({
  pair,
  status,
  onCopy,
  copied = false,
  onRegenerate,
  reconnecting = false,
  error,
  regenerating = false,
}: CommandBoxProps): ReactElement {
  const phase = status?.phase ?? 'waiting';
  const expired = phase === 'expired';
  const command = shellSafePairCommand(pair.command);
  const copy = PHASE_COPY[phase];
  const showPrimaryCommand = phase === 'waiting';
  const showSecondaryCommand = phase === 'uploading';

  return (
    <section className="cb-cmdbox" data-phase={phase} aria-label="连接本机并上传会话">
      <header className="cb-cmdbox__header">
        <div>
          <p className="cb-cmdbox__eyebrow">本机助手 · 云端导入</p>
          <h2 className="cb-cmdbox__title">{copy.title}</h2>
          <p className="cb-cmdbox__lead">{copy.lead}</p>
        </div>
        <span
          className="cb-cmdbox__phase-badge"
          data-phase={phase}
          data-reconnecting={reconnecting || undefined}
        >
          <span aria-hidden="true" />
          {reconnecting ? '状态重连中' : copy.badge}
        </span>
      </header>

      <PairStageRail status={status} />

      {showPrimaryCommand && (
        <TerminalCommand command={command} copied={copied} expired={expired} onCopy={onCopy} />
      )}

      <PairStatusPanel status={status} reconnecting={reconnecting} error={error} />

      {phase === 'uploading' && <Reassurance />}

      {showSecondaryCommand && (
        <details className="cb-cmdbox__command-details">
          <summary>查看已运行的终端命令</summary>
          <TerminalCommand command={command} copied={copied} expired={expired} onCopy={onCopy} />
        </details>
      )}

      {expired && (
        <button
          type="button"
          className="cb-btn cb-btn--primary cb-cmdbox__regen"
          onClick={onRegenerate}
          disabled={regenerating}
        >
          {regenerating ? '正在生成…' : '重新生成命令'}
        </button>
      )}
    </section>
  );
}

export interface PairRecoveryBoxProps {
  /** URL 中的 pairId 已恢复轮询，但一次性明文命令不会持久化。 */
  status: PairStatusView | undefined;
  reconnecting?: boolean;
  error?: ApiError | undefined;
  regenerating?: boolean;
  onRegenerate: () => void;
}

/**
 * 刷新 / 重开后的配对恢复态：继续追踪同一 pairId，不把一次性配对码放进 URL 或存储。
 * waiting 时无法安全重建旧命令，因此显式提供重新生成；uploading 时则原地继续接收进度。
 */
export function PairRecoveryBox({
  status,
  reconnecting = false,
  error,
  regenerating = false,
  onRegenerate,
}: PairRecoveryBoxProps): ReactElement {
  const phase = status?.phase ?? 'waiting';
  const canRegenerate = phase === 'waiting' || phase === 'expired';
  const copy = PHASE_COPY[phase];
  const recoveryTitle = phase === 'waiting' ? '需要重新生成连接命令' : copy.title;
  const recoveryLead =
    phase === 'waiting'
      ? '为了安全，页面刷新后不会保留旧配对码。如果终端还没开始，请生成一条新命令。'
      : '页面已经重新连上云端记录；完成后会自动进入解析和能力提取。';

  return (
    <section className="cb-cmdbox" data-phase={phase} aria-label="恢复终端上传">
      <header className="cb-cmdbox__header">
        <div>
          <p className="cb-cmdbox__eyebrow">已恢复 · 同一次上传任务</p>
          <h2 className="cb-cmdbox__title">{recoveryTitle}</h2>
          <p className="cb-cmdbox__lead">{recoveryLead}</p>
        </div>
        <span
          className="cb-cmdbox__phase-badge"
          data-phase={phase}
          data-reconnecting={reconnecting || undefined}
        >
          <span aria-hidden="true" />
          {reconnecting ? '状态重连中' : copy.badge}
        </span>
      </header>

      <PairStageRail status={status} />
      <PairStatusPanel status={status} reconnecting={reconnecting} error={error} />
      {phase === 'uploading' && <Reassurance />}

      {canRegenerate && (
        <div className="cb-cmdbox__recovery-actions">
          <p>
            {phase === 'expired'
              ? '这条配对码已过期，需要生成一条新命令。'
              : '为了安全，刷新后不会保留旧配对码。如果终端还没开始，请重新生成。'}
          </p>
          <button
            type="button"
            className="cb-btn cb-btn--primary cb-cmdbox__regen"
            onClick={onRegenerate}
            disabled={regenerating}
          >
            {regenerating ? '正在生成…' : '重新生成命令'}
          </button>
        </div>
      )}
    </section>
  );
}
