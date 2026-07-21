import { useEffect, useMemo, useRef } from 'react';
import type { ArtifactVersion } from '@cb/shared';
import { renderMarkdown } from '../lib/markdown.js';

export interface ComboRunRequest {
  prompt: string;
}

export interface ArtifactRendererProps {
  artifact: ArtifactVersion;
  onRunRequest?: (request: ComboRunRequest) => void;
}

const MAX_COMBO_RUN_PROMPT_LENGTH = 12_000;

/** 按 kind 渲染一个 artifact 版本。html 走【沙箱 iframe】（allow-scripts、无 same-origin，隔离父页）。 */
export function ArtifactRenderer({ artifact, onRunRequest }: ArtifactRendererProps) {
  switch (artifact.kind) {
    case 'html':
      return <HtmlView artifact={artifact} onRunRequest={onRunRequest} />;
    case 'markdown':
      return <MarkdownView content={artifact.content} />;
    case 'code':
      return <CodeView content={artifact.content} language={artifact.language} />;
    case 'structured':
      return <StructuredView content={artifact.content} />;
    default:
      return <pre className="rt-artifact__raw">{artifact.content}</pre>;
  }
}

function HtmlView({ artifact, onRunRequest }: ArtifactRendererProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!onRunRequest) return;

    const handleMessage = (event: MessageEvent<unknown>): void => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (!isComboRunMessage(event.data)) return;
      const prompt = event.data.prompt.trim();
      if (!prompt || prompt.length > MAX_COMBO_RUN_PROMPT_LENGTH) return;
      onRunRequest({ prompt });
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onRunRequest]);

  return (
    <iframe
      ref={frameRef}
      className="rt-artifact__frame"
      title={artifact.title}
      sandbox="allow-scripts allow-popups allow-forms"
      srcDoc={artifact.content}
    />
  );
}

function isComboRunMessage(
  value: unknown,
): value is { type: 'combo:run'; version: 1; prompt: string } {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { type?: unknown; version?: unknown; prompt?: unknown };
  return (
    candidate.type === 'combo:run' &&
    candidate.version === 1 &&
    typeof candidate.prompt === 'string'
  );
}

function MarkdownView({ content }: { content: string }) {
  const html = useMemo(() => renderMarkdown(content), [content]);
  return <div className="rt-md rt-artifact__md" dangerouslySetInnerHTML={{ __html: html }} />;
}

function CodeView({ content, language }: { content: string; language: string | null }) {
  return (
    <pre className="rt-artifact__code">
      {language && <span className="rt-artifact__code-lang">{language}</span>}
      <code>{content}</code>
    </pre>
  );
}

function StructuredView({ content }: { content: string }) {
  const data = useMemo<JsonValue | null>(() => {
    try {
      return JSON.parse(content) as JsonValue;
    } catch {
      return null;
    }
  }, [content]);

  if (data === null) {
    return (
      <section className="rt-structured rt-structured--invalid">
        <div className="rt-structured__header">
          <div>
            <div className="rt-structured__eyebrow">结构化结果</div>
            <h2>结果格式还没有准备好</h2>
          </div>
        </div>
        <p className="rt-structured__notice">
          这次运行返回的内容不完整，暂时无法转换成可读页面。你可以继续对话让 Agent 重新生成。
        </p>
        <details className="rt-structured__raw-details">
          <summary>查看原始内容</summary>
          <pre>{content}</pre>
        </details>
      </section>
    );
  }

  if (isRecord(data) && Array.isArray(data.checks)) {
    return <ChecklistView data={data} />;
  }

  return (
    <section className="rt-structured">
      <StructuredHeader data={data} />
      <div className="rt-structured__body">
        <JsonNode value={data} depth={0} />
      </div>
    </section>
  );
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function isRecord(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textValue(value: JsonValue | undefined): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function displayKey(key: string): string {
  const labels: Record<string, string> = {
    id: '编号',
    item: '核查项',
    note: '说明',
    status: '状态',
    score: '评分',
    summary: '摘要',
    result: '结果',
    checks: '核查结果',
    generatedAt: '生成时间',
    cardVersion: '版本',
    evidenceNote: '证据说明',
    runtimeEvidenceNotice: '运行说明',
  };
  return labels[key] ?? key.replaceAll('_', ' ');
}

function statusTone(status: string): 'pass' | 'warning' | 'fail' | 'neutral' {
  const normalized = status.toLowerCase();
  if (/通过|完成|成功|pass|done|true|✅/.test(normalized)) return 'pass';
  if (/警告|待|部分|warning|pending|⚠/.test(normalized)) return 'warning';
  if (/失败|错误|不通过|fail|false|error|❌/.test(normalized)) return 'fail';
  return 'neutral';
}

function ChecklistView({ data }: { data: { [key: string]: JsonValue } }) {
  const meta = isRecord(data.meta) ? data.meta : {};
  const checks = (data.checks as JsonValue[]).filter(isRecord);
  const passed = checks.filter(
    (check) => statusTone(textValue(check.status) ?? '') === 'pass',
  ).length;
  const title = textValue(meta.cardTitle) ?? textValue(data.title) ?? '核查结果';
  const version = textValue(meta.cardVersion);
  const generatedAt = textValue(meta.generatedAt);
  const notice = textValue(meta.runtimeEvidenceNotice) ?? textValue(meta.evidenceNote);

  return (
    <section className="rt-structured rt-structured--checklist">
      <div className="rt-structured__header">
        <div>
          <div className="rt-structured__eyebrow">结构化核查</div>
          <h2>{title}</h2>
          {(version || generatedAt) && (
            <p className="rt-structured__meta">
              {[version, generatedAt].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <div className="rt-structured__progress" aria-label={`${passed} / ${checks.length} 项通过`}>
          <strong>{passed}</strong>
          <span>/ {checks.length} 项通过</span>
        </div>
      </div>

      {notice && <p className="rt-structured__notice">{notice}</p>}

      <ol className="rt-checklist">
        {checks.map((check, index) => {
          const status = textValue(check.status) ?? '待确认';
          const tone = statusTone(status);
          return (
            <li
              className={`rt-checklist__item rt-checklist__item--${tone}`}
              key={textValue(check.id) ?? index}
            >
              <span className="rt-checklist__mark" aria-hidden="true">
                {tone === 'pass' ? '✓' : tone === 'fail' ? '×' : tone === 'warning' ? '!' : '·'}
              </span>
              <div className="rt-checklist__content">
                <div className="rt-checklist__title-row">
                  <strong>{textValue(check.item) ?? `核查项 ${index + 1}`}</strong>
                  <span>{status}</span>
                </div>
                {textValue(check.note) && <p>{textValue(check.note)}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function StructuredHeader({ data }: { data: JsonValue }) {
  const record = isRecord(data) ? data : null;
  const meta = record && isRecord(record.meta) ? record.meta : null;
  const title =
    (meta && (textValue(meta.cardTitle) ?? textValue(meta.title))) ??
    (record && (textValue(record.title) ?? textValue(record.name))) ??
    '结构化结果';

  return (
    <div className="rt-structured__header">
      <div>
        <div className="rt-structured__eyebrow">Agent 结果</div>
        <h2>{title}</h2>
      </div>
    </div>
  );
}

function JsonNode({ value, depth }: { value: JsonValue; depth: number }) {
  if (value === null) return <span className="rt-structured__empty">暂无</span>;
  if (typeof value === 'boolean') return <span>{value ? '是' : '否'}</span>;
  if (typeof value === 'string' || typeof value === 'number') return <span>{String(value)}</span>;

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="rt-structured__empty">暂无内容</span>;
    return (
      <ol className="rt-structured__list">
        {value.map((item, index) => (
          <li key={index}>
            <JsonNode value={item} depth={depth + 1} />
          </li>
        ))}
      </ol>
    );
  }

  const entries = Object.entries(value).filter(
    ([key]) => !(depth === 0 && ['meta', 'title', 'name'].includes(key)),
  );
  if (entries.length === 0) return <span className="rt-structured__empty">暂无内容</span>;

  return (
    <dl className={`rt-structured__fields${depth > 0 ? ' rt-structured__fields--nested' : ''}`}>
      {entries.map(([key, item]) => (
        <div className="rt-structured__field" key={key}>
          <dt>{displayKey(key)}</dt>
          <dd>
            <JsonNode value={item} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
