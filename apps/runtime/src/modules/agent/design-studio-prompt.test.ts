import { describe, expect, it } from 'vitest';
import {
  DESIGN_STUDIO_REPAIR_PROMPT,
  hasDesignStudioPage,
  hasDesignStudioRuntimeBridge,
  hasValidDesignStudioResult,
  isCompleteDesignStudioHtml,
  withDesignStudioInstructions,
} from './design-studio-prompt.js';

describe('withDesignStudioInstructions', () => {
  it('preserves the capability contract and requires a versioned main HTML page', () => {
    const prompt = withDesignStudioInstructions('原能力边界：不可伪造证据。');

    expect(prompt).toContain('原能力边界：不可伪造证据。');
    expect(prompt).toContain('Combo Design Agent');
    expect(prompt).toContain('artifactKey="main"');
    expect(prompt).toContain('kind="html"');
    expect(prompt).toContain('复用同一 artifactKey 产生新版本');
    expect(prompt).toContain('这不是 Landing Page');
    expect(prompt).toContain('data-combo-key');
    expect(prompt).toContain('data-combo-key="run-primary"');
    expect(prompt).toContain("type: 'combo:run'");
    expect(prompt).toContain('version: 1');
    expect(prompt).toContain('保持当前 Miniapp 可见');
    expect(prompt).toContain('不要解释 HTML、bridge、artifactKey');
    expect(prompt).toContain('禁止使用 setTimeout、setInterval、Math.random');
  });

  it('requires the versioned Runtime bridge and rejects simulated execution', () => {
    const realBridge = `<!doctype html><html><body><button data-combo-key="run-primary">运行</button><script>
      const prompt = '处理真实任务';
      window.parent.postMessage({ type: 'combo:run', version: 1, prompt }, '*');
    </script></body></html>`;
    const fakeResult = `<!doctype html><html><body><script>
      const prompt = '处理真实任务';
      window.parent.postMessage({ type: 'combo:run', version: 1, prompt }, '*');
      setTimeout(() => document.body.textContent = '成功', 800);
    </script></body></html>`;

    expect(hasDesignStudioRuntimeBridge(realBridge)).toBe(true);
    expect(hasDesignStudioRuntimeBridge(realBridge.replace('version: 1', 'version: 2'))).toBe(
      false,
    );
    expect(hasDesignStudioRuntimeBridge(fakeResult)).toBe(false);
    expect(hasDesignStudioRuntimeBridge('<html><body>没有 bridge</body></html>')).toBe(false);
  });

  it('only accepts a fresh main HTML artifact as a completed design result', () => {
    expect(
      hasDesignStudioPage([{ artifactKey: 'main', version: 2, kind: 'html', title: 'Miniapp' }]),
    ).toBe(true);
    expect(
      hasDesignStudioPage([
        { artifactKey: 'main', version: 2, kind: 'structured', title: '数据' },
        { artifactKey: 'preview', version: 1, kind: 'html', title: '预览' },
      ]),
    ).toBe(false);
    expect(hasDesignStudioPage([])).toBe(false);
  });

  it('requires the fresh main ref, complete document and Runtime bridge as one result', () => {
    const ref = [{ artifactKey: 'main', version: 2, kind: 'html' as const, title: 'Miniapp' }];
    const validHtml = `<!doctype html><html><body>
      <button data-combo-key="run-primary">运行</button>
      <script>const prompt = '真实输入'; parent.postMessage({type:'combo:run',version:1,prompt}, '*')</script>
    </body></html>`;

    expect(hasValidDesignStudioResult(ref, validHtml)).toBe(true);
    expect(hasValidDesignStudioResult([], validHtml)).toBe(false);
    expect(hasValidDesignStudioResult(ref, '<div>fragment</div>')).toBe(false);
    expect(
      hasValidDesignStudioResult(
        ref,
        '<!doctype html><html><body><button data-combo-key="run-primary">运行</button></body></html>',
      ),
    ).toBe(false);
  });

  it('provides one strict repair instruction that requires the accepted main page contract', () => {
    expect(DESIGN_STUDIO_REPAIR_PROMPT).toContain('系统自动修复');
    expect(DESIGN_STUDIO_REPAIR_PROMPT).toContain('立即调用 upsert_artifact');
    expect(DESIGN_STUDIO_REPAIR_PROMPT).toContain('artifactKey="main"');
    expect(DESIGN_STUDIO_REPAIR_PROMPT).toContain('kind="html"');
    expect(DESIGN_STUDIO_REPAIR_PROMPT).toContain('data-combo-key="run-primary"');
    expect(DESIGN_STUDIO_REPAIR_PROMPT).toContain("type: 'combo:run'");
    expect(DESIGN_STUDIO_REPAIR_PROMPT).toContain('version: 1');
  });

  it('rejects HTML labels that do not contain a complete document', () => {
    expect(
      isCompleteDesignStudioHtml(
        '<!doctype html><html><head><title>Miniapp</title></head><body>完成</body></html>',
      ),
    ).toBe(true);
    expect(isCompleteDesignStudioHtml('<div>只有片段</div>')).toBe(false);
    expect(isCompleteDesignStudioHtml(null)).toBe(false);
  });
});
