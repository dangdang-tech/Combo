import { useEffect, useMemo, useRef, useState } from 'react';
import type { ArtifactRef, RuntimeMessage } from '@cb/shared';
import { renderMarkdown } from '../lib/markdown.js';

const KIND_GLYPH: Record<string, string> = {
  html: '🌐',
  markdown: '📄',
  code: '‹›',
  structured: '▦',
};

const ARTIFACT_DETAIL_COLLAPSE_LENGTH = 96;

export type ArtifactPresentation = 'default' | 'event';

export interface ChatThreadProps {
  messages: RuntimeMessage[];
  /** 流式中的助手正文（未落库前的实时显示）。 */
  streamingText: string | null;
  onOpenArtifact: (ref: ArtifactRef) => void;
  assistantLabel?: string;
  /**
   * Studio 中将 artifact 作为轻量创建/更新事件展示；普通运行聊天沿用原卡片与正文。
   */
  artifactPresentation?: ArtifactPresentation;
}

export function ChatThread({
  messages,
  streamingText,
  onOpenArtifact,
  assistantLabel = '能力',
  artifactPresentation = 'default',
}: ChatThreadProps) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streamingText]);

  return (
    <div className="rt-thread">
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          message={m}
          assistantLabel={assistantLabel}
          onOpenArtifact={onOpenArtifact}
          artifactPresentation={artifactPresentation}
        />
      ))}
      {streamingText !== null && (
        <div className="rt-msg rt-msg--assistant">
          <div className="rt-msg__role">{assistantLabel}</div>
          <AssistantBody text={streamingText} streaming />
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

function MessageBubble({
  message,
  assistantLabel,
  onOpenArtifact,
  artifactPresentation,
}: {
  message: RuntimeMessage;
  assistantLabel: string;
  onOpenArtifact: (ref: ArtifactRef) => void;
  artifactPresentation: ArtifactPresentation;
}) {
  const useArtifactEvents = artifactPresentation === 'event' && message.artifacts.length > 0;
  const collapseDescription = useArtifactEvents && isLongArtifactDescription(message.text);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);

  if (message.role === 'user') {
    return (
      <div className="rt-msg rt-msg--user">
        <div className="rt-msg__bubble">{message.text}</div>
      </div>
    );
  }

  return (
    <div className="rt-msg rt-msg--assistant">
      <div className="rt-msg__role">{assistantLabel}</div>
      {useArtifactEvents && (
        <ArtifactReferences
          artifacts={message.artifacts}
          presentation="event"
          onOpenArtifact={onOpenArtifact}
        />
      )}
      {collapseDescription ? (
        <div className="rt-msg__artifact-detail">
          <button
            type="button"
            className="rt-msg__artifact-detail-toggle"
            aria-expanded={descriptionExpanded}
            onClick={() => setDescriptionExpanded((current) => !current)}
          >
            {descriptionExpanded ? '收起修改说明' : '查看修改说明'}
          </button>
          {descriptionExpanded && <AssistantBody text={message.text} />}
        </div>
      ) : (
        <AssistantBody text={message.text} />
      )}
      {message.artifacts.length > 0 && !useArtifactEvents && (
        <ArtifactReferences
          artifacts={message.artifacts}
          presentation="default"
          onOpenArtifact={onOpenArtifact}
        />
      )}
    </div>
  );
}

function ArtifactReferences({
  artifacts,
  presentation,
  onOpenArtifact,
}: {
  artifacts: ArtifactRef[];
  presentation: ArtifactPresentation;
  onOpenArtifact: (ref: ArtifactRef) => void;
}) {
  return (
    <div className="rt-msg__artifacts">
      {artifacts.map((artifact) => {
        const eventLabel = artifact.version <= 1 ? '已创建页面' : '已更新页面';
        return (
          <button
            key={`${artifact.artifactKey}-${artifact.version}`}
            type="button"
            className={`rt-artifact-chip${presentation === 'event' ? ' rt-artifact-chip--event' : ''}`}
            onClick={() => onOpenArtifact(artifact)}
          >
            {presentation === 'event' ? (
              <span className="rt-artifact-chip__event">{eventLabel}</span>
            ) : (
              <span className="rt-artifact-chip__glyph">{KIND_GLYPH[artifact.kind] ?? '📄'}</span>
            )}
            <span className="rt-artifact-chip__title">{artifact.title}</span>
            <span className="rt-artifact-chip__ver">
              {presentation === 'event' ? '查看' : `v${artifact.version}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function isLongArtifactDescription(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  const meaningfulLineCount = normalized.split(/\r?\n/).filter((line) => line.trim()).length;
  return normalized.length > ARTIFACT_DETAIL_COLLAPSE_LENGTH || meaningfulLineCount > 3;
}

function AssistantBody({ text, streaming }: { text: string; streaming?: boolean }) {
  const html = useMemo(() => (text ? renderMarkdown(text) : ''), [text]);
  return (
    <div className="rt-msg__body rt-md">
      {text ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : streaming ? (
        <span className="rt-typing">
          <span></span>
          <span></span>
          <span></span>
        </span>
      ) : null}
      {streaming && text && <span className="rt-caret" />}
    </div>
  );
}
