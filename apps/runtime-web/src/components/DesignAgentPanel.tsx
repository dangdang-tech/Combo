import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { ArtifactRef, RuntimeMessage, StudioRevision } from '@cb/shared';
import type { ComboElementSelection } from './ArtifactRenderer.js';
import { ChatThread } from './ChatThread.js';
import {
  buildStudioDesignOperationPrompt,
  STUDIO_DESIGN_OPERATIONS,
  type StudioDesignOperation,
} from '../lib/studioDesignOperations.js';

const ROLE_LABELS: Record<string, string> = {
  button: '操作按钮',
  heading: '标题',
  input: '输入区域',
  link: '链接',
  region: '内容区块',
  form: '表单',
};

interface QueuedEdit {
  text: string;
  label: string;
  element: ComboElementSelection | null;
}

export interface DesignAgentPanelProps {
  messages: RuntimeMessage[];
  revisions: StudioRevision[];
  selectedRevisionNo?: number;
  isRunning: boolean;
  isBootstrapping: boolean;
  readOnlyHistory: boolean;
  annotationAvailable: boolean;
  annotationEnabled: boolean;
  selectedElement: ComboElementSelection | null;
  error: string | null;
  onSend: (text: string, element?: ComboElementSelection) => boolean;
  onInterrupt: () => void;
  onSelectRevision: (revisionNo: number) => void;
  onOpenArtifact: (ref: ArtifactRef) => void;
  onToggleAnnotation: () => void;
  onClearAnnotation: () => void;
}

function clipped(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function elementRole(element: ComboElementSelection): string {
  return (element.role && ROLE_LABELS[element.role]) || element.tagName.toUpperCase();
}

export function DesignAgentPanel({
  messages,
  revisions,
  selectedRevisionNo,
  isRunning,
  isBootstrapping,
  readOnlyHistory,
  annotationAvailable,
  annotationEnabled,
  selectedElement,
  error,
  onSend,
  onInterrupt,
  onSelectRevision,
  onOpenArtifact,
  onToggleAnnotation,
  onClearAnnotation,
}: DesignAgentPanelProps) {
  const [text, setText] = useState('');
  const [queued, setQueued] = useState<QueuedEdit[]>([]);
  const [operationMenuOpen, setOperationMenuOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const operationTriggerRef = useRef<HTMLButtonElement>(null);
  const firstOperationRef = useRef<HTMLButtonElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const stickToLatestRef = useRef(true);
  const selectedRevision = revisions.find((item) => item.revisionNo === selectedRevisionNo);
  const revisionOptions = [...revisions].sort((left, right) => right.revisionNo - left.revisionNo);
  const wasRunningRef = useRef(false);
  const bootstrapFailed = revisions.length === 0 && !isBootstrapping && Boolean(error);
  const isWorking = isRunning || isBootstrapping;
  const operationMenuId = useId();

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
    if (!next) return;
    const accepted = next.element ? onSend(next.text, next.element) : onSend(next.text);
    if (accepted) setQueued(rest);
  }, [error, isBootstrapping, isRunning, onSend, queued, readOnlyHistory]);

  useEffect(() => {
    if (!selectedElement) return;
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [selectedElement?.key]);

  useEffect(() => {
    if (readOnlyHistory || (annotationEnabled && !selectedElement)) {
      setOperationMenuOpen(false);
    }
  }, [annotationEnabled, readOnlyHistory, selectedElement]);

  useEffect(() => {
    if (!operationMenuOpen) return;
    firstOperationRef.current?.focus();
  }, [operationMenuOpen]);

  useEffect(() => {
    if (!stickToLatestRef.current) return;
    window.requestAnimationFrame(() =>
      threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }),
    );
  }, [error, isBootstrapping, isRunning, messages.at(-1)?.id, queued.length]);

  const dispatchEdit = (
    value: string,
    label: string,
    element: ComboElementSelection | null,
  ): boolean => {
    if (!value.trim() || readOnlyHistory) return false;
    if (isWorking) {
      setQueued((current) => [
        ...current,
        {
          text: value,
          label,
          element,
        },
      ]);
    } else {
      const sent = element ? onSend(value, element) : onSend(value);
      if (!sent) return false;
    }
    if (element) onClearAnnotation();
    return true;
  };

  const submit = (): void => {
    const trimmed = text.trim();
    if (!trimmed || readOnlyHistory) return;
    const element = selectedElement ? { ...selectedElement } : null;
    const label = element ? `标注「${clipped(element.label, 40)}」：${trimmed}` : trimmed;
    if (!dispatchEdit(trimmed, label, element)) return;
    setText('');
  };

  const applyDesignOperation = (operation: StudioDesignOperation): void => {
    const element = selectedElement ? { ...selectedElement } : null;
    const prompt = buildStudioDesignOperationPrompt(operation, element ? 'element' : 'page');
    const label = element
      ? `标注「${clipped(element.label, 40)}」：${operation.label}`
      : `设计操作：${operation.label}`;
    if (!dispatchEdit(prompt, label, element)) return;
    setOperationMenuOpen(false);
  };

  const handleOperationKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    setOperationMenuOpen(false);
    operationTriggerRef.current?.focus();
  };

  const toggleAnnotation = (): void => {
    setOperationMenuOpen(false);
    onToggleAnnotation();
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing || event.key !== 'Enter' || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    submit();
  };

  return (
    <aside className="rt-design-agent" aria-label="页面修改">
      <header className="rt-design-agent__head">
        <strong>修改</strong>
        {selectedRevision ? (
          <label>
            <span className="rt-sr-only">页面版本</span>
            <select
              aria-label="页面版本"
              value={selectedRevision.revisionNo}
              onChange={(event) => onSelectRevision(Number(event.target.value))}
            >
              {revisionOptions.map((revision, index) => (
                <option key={revision.id} value={revision.revisionNo}>
                  版本 {revision.revisionNo}
                  {index === 0 ? ' · 当前' : revision.verified ? ' · 已试用' : ''}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span>{isBootstrapping ? '正在创建首版' : '还没有页面'}</span>
        )}
      </header>
      <div
        ref={threadRef}
        className="rt-design-agent__thread"
        role="log"
        aria-label="页面修改记录"
        onScroll={(event) => {
          const target = event.currentTarget;
          stickToLatestRef.current =
            target.scrollHeight - target.scrollTop - target.clientHeight < 72;
        }}
      >
        {messages.length > 0 && (
          <ChatThread
            messages={messages}
            streamingText={null}
            assistantLabel="Combo"
            artifactPresentation="event"
            autoScroll={false}
            activeArtifact={
              selectedRevision
                ? {
                    artifactKey: selectedRevision.artifactKey,
                    version: selectedRevision.artifactVersion,
                  }
                : undefined
            }
            onOpenArtifact={onOpenArtifact}
          />
        )}
        {messages.length === 0 && !isBootstrapping && !bootstrapFailed && (
          <div className="rt-design-agent__empty">
            <strong>直接告诉我你想怎么改</strong>
            <span>描述期望的结果，或者先从右侧页面选择一个位置。</span>
          </div>
        )}

        {!readOnlyHistory && isWorking && (
          <div className="rt-design-agent__activity" role="status" aria-live="polite">
            <span className="rt-design-agent__activity-mark" aria-hidden="true" />
            <div>
              <strong>{isBootstrapping ? '正在生成页面' : '正在修改页面'}</strong>
              <small>你可以继续输入，下一条修改会按顺序执行。</small>
            </div>
          </div>
        )}

        {error && (
          <div className="rt-design-agent__error" role="alert">
            <span>{error}</span>
            {bootstrapFailed && (
              <button
                type="button"
                onClick={() =>
                  onSend('请重新生成首版页面，保持 Agent 输入、核心任务和结果区域完整。')
                }
              >
                重新生成
              </button>
            )}
          </div>
        )}
        <div ref={threadEndRef} />
      </div>

      <div className="rt-design-agent__footer">
        <div
          className="rt-design-agent__composer"
          role="group"
          aria-label="页面修改输入"
          data-working={isWorking ? 'true' : 'false'}
        >
          {queued.length > 0 && (
            <details className="rt-design-agent__queue">
              <summary>
                <span>{queued.length} 条修改待执行</span>
                <small>按发送顺序应用</small>
              </summary>
              <ol>
                {queued.map((item, index) => (
                  <li key={`${item.label}-${index}`}>{item.label}</li>
                ))}
              </ol>
            </details>
          )}
          {selectedElement && (
            <section className="rt-design-agent__attachment" aria-label="当前页面标注">
              <span aria-hidden="true">⌖</span>
              <div>
                <small>1 处页面标注 · {elementRole(selectedElement)}</small>
                <strong>{clipped(selectedElement.label, 74)}</strong>
              </div>
              <button type="button" onClick={onClearAnnotation} aria-label="移除页面标注">
                ×
              </button>
            </section>
          )}
          {annotationEnabled && !selectedElement && (
            <div className="rt-design-agent__selection-guide" role="status">
              <span>点击右侧页面，选择要修改的位置</span>
              <button type="button" onClick={toggleAnnotation}>
                取消
              </button>
            </div>
          )}
          {operationMenuOpen && (
            <section
              id={operationMenuId}
              className="rt-design-agent__operations"
              aria-label="设计操作"
              onKeyDown={handleOperationKeyDown}
            >
              <header>
                <strong>{selectedElement ? '调整选中位置' : '快速整理页面'}</strong>
                <small>会直接生成一个新版本</small>
              </header>
              <div>
                {STUDIO_DESIGN_OPERATIONS.map((operation, index) => (
                  <button
                    key={operation.id}
                    ref={index === 0 ? firstOperationRef : undefined}
                    type="button"
                    onClick={() => applyDesignOperation(operation)}
                  >
                    <strong>{operation.label}</strong>
                    <span>{operation.description}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          <textarea
            ref={inputRef}
            value={text}
            disabled={readOnlyHistory}
            rows={4}
            placeholder={
              readOnlyHistory
                ? '返回当前版本后继续修改'
                : selectedElement
                  ? '告诉我这里要怎么改…'
                  : '想怎么改这个页面？描述期望的结果，也可以先选择页面位置…'
            }
            aria-label="描述页面修改"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleInputKeyDown}
          />
          <div className="rt-design-agent__composer-actions">
            <div className="rt-design-agent__composer-tools">
              <button
                ref={operationTriggerRef}
                type="button"
                className="rt-design-agent__operation-control"
                aria-label={operationMenuOpen ? '关闭设计操作' : '打开设计操作'}
                aria-expanded={operationMenuOpen}
                aria-controls={operationMenuId}
                title="快速检查、整理或加固当前页面"
                disabled={readOnlyHistory || (annotationEnabled && !selectedElement)}
                onClick={() => setOperationMenuOpen((current) => !current)}
              >
                <span aria-hidden="true">✦</span>
                设计操作
              </button>
              <button
                type="button"
                className="rt-design-agent__annotation-control"
                aria-label={annotationEnabled ? '取消标注页面' : '标注页面'}
                aria-pressed={annotationEnabled}
                title={
                  annotationAvailable
                    ? annotationEnabled
                      ? '取消选择'
                      : '选择页面元素'
                    : '页面准备好后即可选择'
                }
                disabled={(!annotationAvailable && !annotationEnabled) || readOnlyHistory}
                onClick={toggleAnnotation}
              >
                <span aria-hidden="true">⌖</span>
                选择页面
              </button>
              <small>
                {readOnlyHistory
                  ? '正在查看历史版本'
                  : isWorking
                    ? '发送后接着修改'
                    : 'Enter 发送 · Shift + Enter 换行'}
              </small>
            </div>
            <button
              type="button"
              className={`rt-design-agent__send${isWorking && !text.trim() ? ' is-stop' : ''}`}
              aria-label={
                isWorking && !text.trim() ? '停止当前修改' : isWorking ? '加入修改队列' : '发送修改'
              }
              disabled={!isWorking && (readOnlyHistory || !text.trim())}
              onClick={isWorking && !text.trim() ? onInterrupt : submit}
            >
              <span aria-hidden="true">{isWorking && !text.trim() ? '■' : '↑'}</span>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
