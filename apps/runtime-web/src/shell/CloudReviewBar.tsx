import { useState, type ReactElement } from 'react';

const deployEnvironment = import.meta.env.VITE_DEPLOY_ENV?.trim().toLowerCase();
const buildSha = import.meta.env.VITE_BUILD_SHA?.trim() || 'unknown';
const reviewSource = import.meta.env.VITE_REVIEW_SOURCE?.trim() || 'manual';

export function CloudReviewBar(): ReactElement | null {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  if (deployEnvironment !== 'preview') return null;

  const shortSha = buildSha === 'unknown' ? '待标记' : buildSha.slice(0, 8);

  async function copyReviewContext(): Promise<void> {
    const context = [
      `Combo Cloud Review`,
      `页面: ${window.location.href}`,
      `构建: ${buildSha}`,
      `来源: ${reviewSource}`,
      `视口: ${window.innerWidth}x${window.innerHeight}`,
      `浏览器: ${navigator.userAgent}`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(context);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    window.setTimeout(() => setCopyState('idle'), 1800);
  }

  return (
    <aside className="rt-cloud-review" aria-label="云端评审环境">
      <div className="rt-cloud-review__identity">
        <span className="rt-cloud-review__pulse" aria-hidden="true" />
        <strong>云端评审</strong>
        <span>真实运行 · Build {shortSha}</span>
      </div>
      <div className="rt-cloud-review__actions">
        <button type="button" onClick={() => void copyReviewContext()}>
          {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制评审信息'}
        </button>
        <a href="https://buildwithcombo.com">返回主环境</a>
      </div>
    </aside>
  );
}
