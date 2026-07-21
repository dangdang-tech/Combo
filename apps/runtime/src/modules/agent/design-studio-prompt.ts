import type { ArtifactRef } from '@cb/shared';

const DESIGN_STUDIO_RULES = `
# Combo Design Agent 工作模式

你正在帮创作者把当前能力包装成可直接体验和迭代的 Miniapp 前端。在不改变能力的业务边界、证据标准和核心行为的前提下，优先执行用户的页面修改要求。

必须遵守：
- 主交付物始终使用 artifactKey="main"、kind="html"，并输出完整、自包含的 HTML 文档。
- 对话中已经存在 main 页面时，应在它的基础上实施修改，复用同一 artifactKey 产生新版本；不要另起一个主页面。
- 用户只要要求调整文案、色彩、间距、布局或移动端，就必须实际更新 HTML，不能只给建议。
- 页面必须是响应式的，保证基本键盘操作、可读对比度和清晰焦点。
- 不要要求用户打开本地文件，不要依赖需要私有鉴权的外部资源。
- structured / markdown / code 可用作辅助产物，但不能取代 main HTML 页面。
- 这不是 Landing Page。页面必须围绕当前能力的真实 inputs、主操作、运行状态和 output 组织成可使用的工具界面。
- 主要区块与可编辑元素使用稳定且语义化的 data-combo-key（例如 input-goal、run-primary、result-main），后续修改保持 key 不变。
- 未收到真实 Runtime 结果时不得伪造“生成成功”或虚构结果；可以展示清楚的待运行、空状态和示例输入。
- 聊天正文只用简短说明本次真正改了什么；页面本体必须通过 upsert_artifact 工具更新。
`.trim();

/**
 * Per-run Design Agent overlay. It preserves the frozen capability contract
 * while forcing the main deliverable into the persistent HTML version chain.
 */
export function withDesignStudioInstructions(baseInstructions: string): string {
  return `${baseInstructions.trim()}\n\n———\n${DESIGN_STUDIO_RULES}`;
}

/** Design runs only count as completed after producing a fresh main HTML page. */
export function hasDesignStudioPage(artifacts: readonly ArtifactRef[]): boolean {
  return artifacts.some((artifact) => artifact.artifactKey === 'main' && artifact.kind === 'html');
}

/** Lightweight document guard; visual and interaction checks remain a separate concern. */
export function isCompleteDesignStudioHtml(content: string | null | undefined): boolean {
  if (!content) return false;
  return (
    /<!doctype\s+html(?:\s[^>]*)?>/i.test(content) &&
    /<html(?:\s[^>]*)?>/i.test(content) &&
    /<body(?:\s[^>]*)?>/i.test(content) &&
    /<\/body>/i.test(content) &&
    /<\/html>/i.test(content)
  );
}

export { DESIGN_STUDIO_RULES };
