// Stable conversation rail for repeated page edits. The name is kept for import
// compatibility, but the component is intentionally no longer a floating window:
// one history, one composer, and one dynamic primary action.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { MessageView } from '@cb/shared';
import type { RuntimeSessionExperience } from '../sessionExperience.js';
import { ChatThread } from './ChatThread.js';

export interface FloatingChatProps {
  sessionId: string;
  messages: MessageView[];
  streamingText: string | null;
  isRunning: boolean;
  hasArtifact: boolean;
  error: string | null;
  onSend: (text: string) => void;
  onInterrupt: () => void;
  experience?: RuntimeSessionExperience;
}

export function FloatingChat({
  sessionId,
  messages,
  streamingText,
  isRunning,
  hasArtifact,
  error,
  onSend,
  onInterrupt,
  experience = 'consume',
}: FloatingChatProps) {
  const [text, setText] = useState('');
  const [queued, setQueued] = useState<string[]>([]);
  const wasRunningRef = useRef(false);

  useEffect(() => {
    setText('');
    setQueued([]);
    wasRunningRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    if (isRunning) {
      wasRunningRef.current = true;
      return;
    }
    if (error) {
      wasRunningRef.current = false;
      return;
    }
    if (!wasRunningRef.current || queued.length === 0) return;
    wasRunningRef.current = false;
    const [next, ...rest] = queued;
    if (!next) return;
    setQueued(rest);
    onSend(next);
  }, [error, isRunning, onSend, queued]);

  const submit = useCallback((): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (isRunning) setQueued((current) => [...current, trimmed]);
    else onSend(trimmed);
    setText('');
  }, [isRunning, onSend, text]);

  const sendNextQueued = (): void => {
    if (isRunning) return;
    const [next, ...rest] = queued;
    if (!next) return;
    setQueued(rest);
    onSend(next);
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing || event.key !== 'Enter' || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    submit();
  };

  const hasText = Boolean(text.trim());
  const isFirstStudioPrompt = experience === 'studio' && messages.length === 0 && !hasArtifact;
  const actionLabel =
    isRunning && !hasText
      ? '停止当前修改'
      : isRunning
        ? '加入修改队列'
        : isFirstStudioPrompt
          ? '生成第一版 UI'
          : '发送修改';
  const runningLabel =
    experience === 'studio'
      ? hasArtifact
        ? '正在应用 UI 修改'
        : '正在生成第一版 UI'
      : hasArtifact
        ? '正在应用修改'
        : '正在生成页面';

  return (
    <aside
      className="rt-conversation-panel"
      aria-label={experience === 'studio' ? 'UI 设计对话' : '页面修改'}
    >
      <ChatThread
        messages={messages}
        streamingText={streamingText}
        runningLabel={isRunning ? runningLabel : undefined}
      />

      {error && (
        <div className="rt-conversation-panel__error" role="alert">
          {error}
        </div>
      )}

      <div className="rt-conversation-panel__footer">
        <div className="rt-conversation-composer" role="group" aria-label="页面修改输入">
          {queued.length > 0 && (
            <details className="rt-conversation-queue">
              <summary>
                <span>{queued.length} 条修改待执行</span>
                <small>按发送顺序应用</small>
              </summary>
              <ol>
                {queued.map((item, index) => (
                  <li key={item + '-' + index}>{item}</li>
                ))}
              </ol>
              {!isRunning && (
                <button type="button" onClick={sendNextQueued}>
                  继续执行
                </button>
              )}
            </details>
          )}
          <textarea
            value={text}
            rows={4}
            placeholder={
              isFirstStudioPrompt
                ? '描述你想要的页面结构、交互和视觉…'
                : '想怎么改这个页面？描述期望的结果…'
            }
            aria-label={isFirstStudioPrompt ? '描述第一版 UI' : '描述页面修改'}
            aria-keyshortcuts="Enter"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleInputKeyDown}
          />
          <div className="rt-conversation-composer__actions">
            <small>{isRunning ? '发送后接着修改' : 'Enter 发送 · Shift + Enter 换行'}</small>
            <div className="rt-conversation-composer__buttons">
              {isRunning && hasText && (
                <button
                  type="button"
                  className="rt-conversation-stop"
                  aria-label="停止当前修改"
                  title="停止当前修改"
                  onClick={onInterrupt}
                >
                  <span aria-hidden="true">■</span>
                </button>
              )}
              <button
                type="button"
                className={'rt-conversation-send' + (isRunning && !hasText ? ' is-stop' : '')}
                aria-label={actionLabel}
                title={actionLabel}
                disabled={!isRunning && !hasText}
                onClick={isRunning && !hasText ? onInterrupt : submit}
              >
                <span aria-hidden="true">{isRunning && !hasText ? '■' : '↑'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
