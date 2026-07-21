import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ArtifactRef, RuntimeMessage, StudioRevision } from '@cb/shared';
import { ChatThread } from './ChatThread.js';
import { ComboWordmark } from './ComboBrand.js';

const QUICK_EDITS = [
  '让主任务和主按钮更突出',
  '统一色彩、间距和圆角',
  '优化手机端布局和交互',
  '让结果区更清楚、更容易行动',
] as const;

export interface DesignAgentPanelProps {
  title: string;
  versionLabel: string;
  messages: RuntimeMessage[];
  revisions: StudioRevision[];
  selectedRevisionNo?: number;
  isRunning: boolean;
  isBootstrapping: boolean;
  readOnlyHistory: boolean;
  historyVersion?: number;
  latestVersion?: number;
  error: string | null;
  onBack: () => void;
  onSend: (text: string) => boolean;
  onInterrupt: () => void;
  onReturnLatest: () => void;
  onSelectRevision: (revisionNo: number) => void;
  onOpenArtifact: (ref: ArtifactRef) => void;
}

function revisionTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function DesignAgentPanel({
  title,
  versionLabel,
  messages,
  revisions,
  selectedRevisionNo,
  isRunning,
  isBootstrapping,
  readOnlyHistory,
  historyVersion,
  latestVersion,
  error,
  onBack,
  onSend,
  onInterrupt,
  onReturnLatest,
  onSelectRevision,
  onOpenArtifact,
}: DesignAgentPanelProps) {
  const [text, setText] = useState('');
  const [view, setView] = useState<'conversation' | 'versions'>('conversation');
  const [queued, setQueued] = useState<string[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wasRunningRef = useRef(false);
  const bootstrapFailed = revisions.length === 0 && !isBootstrapping && Boolean(error);

  useEffect(() => {
    if (isRunning || isBootstrapping) {
      wasRunningRef.current = true;
      return;
    }
    if (error) {
      wasRunningRef.current = false;
      return;
    }
    if (!wasRunningRef.current || queued.length === 0 || readOnlyHistory) return;
    wasRunningRef.current = false;
    const [next, ...rest] = queued;
    if (next && onSend(next)) setQueued(rest);
  }, [error, isBootstrapping, isRunning, onSend, queued, readOnlyHistory]);

  const submit = (): void => {
    const trimmed = text.trim();
    if (!trimmed || readOnlyHistory) return;
    const accepted = isRunning || isBootstrapping;
    if (accepted) {
      setQueued((current) => [...current, trimmed]);
    } else {
      if (!onSend(trimmed)) return;
    }
    setText('');
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing || event.key !== 'Enter' || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    submit();
  };

  const useQuickEdit = (prompt: string): void => {
    setText(prompt);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <aside className="rt-design-agent" aria-label="Design Agent 编辑面板">
      <header className="rt-design-agent__chrome">
        <a href="/creator" className="rt-design-agent__brand" aria-label="Combo 创作者中心 首页">
          <ComboWordmark className="rt-design-agent__brand-word" />
        </a>
        <button
          type="button"
          className="rt-design-agent__back"
          onClick={onBack}
          aria-label="返回能力结果"
        >
          <span aria-hidden="true">←</span>
          返回
        </button>
      </header>

      <div className="rt-design-agent__intro">
        <div className="rt-design-agent__eyebrow">DESIGN AGENT</div>
        <h2>{title}</h2>
        <p>持续描述你想改的地方；每次成功修改都会自动保存为新的 UI Revision。</p>
        <div className="rt-design-agent__meta">
          <span>
            {isBootstrapping
              ? '正在准备首版 Miniapp'
              : bootstrapFailed
                ? '首版生成失败，可以直接重试'
                : revisions.length > 0
                  ? '首版已生成，可反复修改'
                  : '正在读取 Studio 状态'}
          </span>
          <span>{versionLabel}</span>
        </div>
      </div>

      <div className="rt-design-agent__tabs" role="tablist" aria-label="Design Agent 面板">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'conversation'}
          onClick={() => setView('conversation')}
        >
          对话修改
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'versions'}
          onClick={() => setView('versions')}
        >
          版本历史
          {revisions.length > 0 && <span>{revisions.length}</span>}
        </button>
      </div>

      {view === 'versions' ? (
        <div className="rt-design-agent__versions" role="tabpanel">
          <div className="rt-version-list__head">
            <strong>所有 Revision</strong>
            <span>预览历史不会覆盖后续版本</span>
          </div>
          {revisions.length === 0 ? (
            <div className="rt-version-list__empty">首版完成后，版本会自动出现在这里。</div>
          ) : (
            <ol className="rt-version-list">
              {[...revisions].reverse().map((revision) => {
                const selected = selectedRevisionNo === revision.revisionNo;
                const current = revision.revisionNo === revisions.at(-1)?.revisionNo;
                return (
                  <li key={revision.id}>
                    <button
                      type="button"
                      className={selected ? 'is-selected' : ''}
                      onClick={() => onSelectRevision(revision.revisionNo)}
                    >
                      <span className="rt-version-list__line" aria-hidden="true" />
                      <span className="rt-version-list__body">
                        <span className="rt-version-list__title">
                          <strong>UI R{revision.revisionNo}</strong>
                          {current && <em>当前</em>}
                          {revision.verified && <em className="is-verified">已试用</em>}
                        </span>
                        <span className="rt-version-list__summary">
                          {revision.summary || '页面修改已保存'}
                        </span>
                        <time>{revisionTime(revision.createdAt)}</time>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      ) : (
        <div className="rt-design-agent__thread" role="tabpanel">
          <div className="rt-design-agent__welcome">
            <span aria-hidden="true">✦</span>
            <div>
              <strong>
                {isBootstrapping
                  ? '正在把这个 Agent 包装成首版 Miniapp'
                  : bootstrapFailed
                    ? '首版还没有生成出来'
                    : '首版 Miniapp 已准备好'}
              </strong>
              <p>
                {isBootstrapping
                  ? '你可以现在就描述下一步修改，我会排在首版之后继续执行。'
                  : bootstrapFailed
                    ? '上一版要求没有成功，你可以重试首版，或者直接换一种描述。'
                    : '先在右侧直接体验；任何文案、布局和视觉调整都可以继续告诉我。'}
              </p>
              {bootstrapFailed && (
                <button
                  type="button"
                  className="rt-design-agent__retry"
                  onClick={() =>
                    onSend('请重新生成首版 Miniapp，保持能力输入、核心任务和结果区域完整。')
                  }
                >
                  重试生成首版
                </button>
              )}
            </div>
          </div>
          {messages.length > 0 && (
            <ChatThread
              messages={messages}
              streamingText={null}
              assistantLabel="Design Agent"
              onOpenArtifact={onOpenArtifact}
            />
          )}
        </div>
      )}

      <div className="rt-design-agent__footer">
        {readOnlyHistory ? (
          <div className="rt-design-agent__history-notice">
            <div>
              <strong>正在预览历史 UI R{historyVersion}</strong>
              <small>返回 UI R{latestVersion} 后继续修改。</small>
            </div>
            <button type="button" onClick={onReturnLatest}>
              返回当前版
            </button>
          </div>
        ) : isRunning || isBootstrapping ? (
          <div className="rt-design-agent__running">
            <span aria-hidden="true" />
            <div>
              <strong>{isBootstrapping ? '正在生成 UI R1' : '正在生成下一个 Revision'}</strong>
              <small>上一成功版本会保持可用；新的要求可以继续排队。</small>
            </div>
            {isRunning && (
              <button type="button" onClick={onInterrupt}>
                停止
              </button>
            )}
          </div>
        ) : (
          <div className="rt-design-agent__quick-edits" role="group" aria-label="修改建议">
            {QUICK_EDITS.map((prompt) => (
              <button key={prompt} type="button" onClick={() => useQuickEdit(prompt)}>
                {prompt}
              </button>
            ))}
          </div>
        )}

        {queued.length > 0 && (
          <div className="rt-design-agent__queue" aria-live="polite">
            <strong>接下来</strong>
            {queued.map((item, index) => (
              <span key={`${item}-${index}`}>{item}</span>
            ))}
          </div>
        )}

        {error && (
          <div className="rt-design-agent__error" role="alert">
            {error}
          </div>
        )}

        <div className="rt-design-agent__composer">
          <textarea
            ref={inputRef}
            value={text}
            disabled={readOnlyHistory}
            rows={3}
            placeholder={
              readOnlyHistory
                ? '返回当前版本后继续修改'
                : '描述下一步修改，例如：让输入区更紧凑，把结果作为页面重点…'
            }
            aria-label="描述页面修改"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleInputKeyDown}
          />
          <div className="rt-design-agent__composer-actions">
            <small>{isRunning || isBootstrapping ? '会排在当前修改之后' : 'Enter 发送'}</small>
            <button
              type="button"
              className="rt-design-agent__send"
              disabled={readOnlyHistory || !text.trim()}
              onClick={submit}
            >
              {isRunning || isBootstrapping ? '加入队列 ↑' : '应用修改 ↑'}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
