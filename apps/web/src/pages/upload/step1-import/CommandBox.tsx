// STEP① 配对命令框（F-10，开工总纲 §5.1）——铸码后展示一行命令 + 轮询配对/上传状态。
//
// 状态（对齐 PairPhase，导入-25）：
//   - waiting：已铸码，等终端跑命令。显示可复制命令 + 「等待你在终端运行…」会话状态。
//   - uploading：助手已开始直传。显示「正在上传你的对话历史…」+ 已传分片量化（uploadedParts/totalParts）。
//   - job_created：已建 Job（上层据此转 SSE，不在本件渲染）。
//   - expired：配对码过期（态非错误，导入-25）。给「重新生成」引导。
// 永不裸转圈：每个阶段都有人话会话状态 + 进度量化，绝不空转。
import type { ReactElement } from 'react';
import type { PairResult, PairStatusView } from '@cb/shared';
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
  /** 点「复制命令」（上层接剪贴板 + toast；本件只回调，不直接碰 navigator 以便测试）。 */
  onCopy: () => void;
  /** 是否已复制（按钮显「已复制」短反馈）。 */
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

/** 把 phase 翻成人话会话状态行（导入-25 逐行会话状态）。 */
function phasePhrase(status: PairStatusView | undefined): string {
  const phase = status?.phase ?? 'waiting';
  switch (phase) {
    case 'uploading': {
      const done = status?.uploadedParts;
      const total = status?.totalParts;
      if (typeof done === 'number' && typeof total === 'number' && total > 0) {
        const percent = Math.min(100, Math.round((done / total) * 100));
        return `正在上传你的对话历史 · ${done} / ${total} 片（${percent}%）`;
      }
      return '正在上传你的对话历史…';
    }
    case 'job_created':
      return '上传完成，正在进入处理…';
    case 'expired':
      return '这条配对码已经过期了。';
    case 'waiting':
    default:
      return '等待你在终端运行上面的命令…';
  }
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
  const done = status?.uploadedParts;
  const total = status?.totalParts;
  const showProgress =
    phase === 'uploading' && typeof done === 'number' && typeof total === 'number' && total > 0;

  return (
    <div className="cb-cmdbox__status" data-phase={phase}>
      <div className="cb-cmdbox__status-line">
        <span className="cb-cmdbox__status-dot" aria-hidden="true" />
        <p className="cb-cmdbox__phase" role="status" aria-live="polite">
          {phasePhrase(status)}
        </p>
      </div>
      {showProgress && (
        <progress
          className="cb-cmdbox__progress"
          aria-label={`终端上传进度 ${done} / ${total} 片`}
          value={done}
          max={total}
        />
      )}
      {reconnecting && error && (
        <p className="cb-cmdbox__connection" role="status" aria-live="polite">
          {error.userMessage}
        </p>
      )}
    </div>
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

  return (
    <section className="cb-cmdbox" aria-label="连接本机并运行命令">
      <h2 className="cb-cmdbox__title">在你电脑的终端里运行这行命令</h2>
      <p className="cb-cmdbox__lead">
        助手会扫描本机的对话历史并安全上传；完成后这一页会自动接上，你不用回到终端。
      </p>

      {/* 一行可复制命令（带专属配对码）。展示与复制同为真命令 pair.command（不再用占位 curlOneLiner）。 */}
      <div className="cb-cmdbox__command">
        <code className="cb-cmdbox__command-text">{command}</code>
        <button
          type="button"
          className="cb-btn cb-cmdbox__copy"
          onClick={onCopy}
          disabled={expired}
        >
          {copied ? '已复制' : '复制命令'}
        </button>
      </div>

      {/* 会话状态（逐行，永不裸转圈）。 */}
      <PairStatusPanel status={status} reconnecting={reconnecting} error={error} />

      {/* 过期引导（态非错误，导入-25）。 */}
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

  return (
    <section className="cb-cmdbox" aria-label="恢复终端上传">
      <h2 className="cb-cmdbox__title">
        {phase === 'uploading' ? '终端正在上传' : '正在恢复这次上传'}
      </h2>
      <p className="cb-cmdbox__lead">
        页面已经重新连上云端任务。终端上传完成后，这里会自动进入处理和能力提取。
      </p>

      <PairStatusPanel status={status} reconnecting={reconnecting} error={error} />

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
