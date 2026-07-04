// 产物画布（右栏）：产物切换 + 内容回读（GET /runtime/artifacts/:id/content）+ 按 kind 渲染。
import type { ArtifactView } from '@cb/shared';
import { useState } from 'react';
import { useArtifactContent } from '../api/runtime.js';
import { ArtifactRenderer } from './ArtifactRenderer.js';

const KIND_LABEL: Record<string, string> = {
  html: '网页',
  markdown: '文档',
  code: '代码',
  structured: '结构化',
};

export interface ArtifactPanelProps {
  /** 当前展示的产物（active）。 */
  artifact: ArtifactView;
  /** 本会话全部产物，用于在多产物间切换。 */
  artifacts: ArtifactView[];
  onSelectArtifact: (id: string) => void;
}

export function ArtifactPanel({ artifact, artifacts, onSelectArtifact }: ArtifactPanelProps) {
  const content = useArtifactContent(artifact);
  const [copied, setCopied] = useState(false);
  const title = artifact.title ?? '未命名产物';

  const copy = async () => {
    if (content.data === undefined) return;
    try {
      await navigator.clipboard.writeText(content.data);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard 不可用时静默 */
    }
  };

  return (
    <aside className="rt-artifact">
      <header className="rt-artifact__bar">
        <div className="rt-artifact__meta">
          <span className="rt-artifact__kind">{KIND_LABEL[artifact.kind] ?? artifact.kind}</span>
          {artifacts.length > 1 ? (
            <select
              className="rt-artifact__versions"
              value={artifact.id}
              onChange={(e) => onSelectArtifact(e.target.value)}
            >
              {artifacts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title ?? '未命名产物'}
                </option>
              ))}
            </select>
          ) : (
            <span className="rt-artifact__title">{title}</span>
          )}
        </div>
        <div className="rt-artifact__actions">
          <button
            type="button"
            className="rt-icon-btn"
            onClick={() => void copy()}
            title="复制内容"
          >
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      </header>
      <div className="rt-artifact__body">
        {content.isPending ? (
          <div className="rt-empty">产物加载中…</div>
        ) : content.isError ? (
          <div className="rt-empty rt-empty--error">产物内容加载失败，稍后重试。</div>
        ) : (
          <ArtifactRenderer kind={artifact.kind} title={title} content={content.data} />
        )}
      </div>
    </aside>
  );
}
