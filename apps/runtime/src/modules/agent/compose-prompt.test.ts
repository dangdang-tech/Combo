import { describe, expect, it } from 'vitest';
import type { SkillPackageRuntimeView } from '@cb/shared';
import { composeSystemPrompt } from './compose-prompt.js';

const VIEW: SkillPackageRuntimeView = {
  capabilityId: 'cap-1',
  slug: 'doc-check',
  version: '0.1.0',
  manifestHash: 'hash-1',
  status: 'published',
  name: '文档与代码一致性核查',
  tagline: '对照真实代码逐条验证文档',
  instructions: '像审稿人一样工作。',
  inputs: {
    fields: [{ key: 'doc', label: '文档摘录', type: 'string', required: true }],
  },
  output: { type: 'structured' },
  boundaries: { riskLevel: 'low', redLines: [] },
  starterPrompts: [],
};

describe('composeSystemPrompt', () => {
  it('injects runtime date and evidence-boundary rules', () => {
    const prompt = composeSystemPrompt(VIEW);

    expect(prompt).toContain('当前运行日期：');
    expect(prompt).toContain('generatedAt');
    expect(prompt).toContain('证据不足 / 需查看完整材料后确认');
    expect(prompt).toContain('输出应区分：已由材料直接证明的问题');
    expect(prompt).toContain('meta.generatedAt');
    expect(prompt).toContain('主交付物必须使用 "main"');
    expect(prompt).toContain('辅助产物使用其他 key');
  });

  it('keeps an explicit self-contained HTML deliverable primary over a checklist process step', () => {
    const prompt = composeSystemPrompt({
      ...VIEW,
      instructions: '为 Combo 批量生成自包含 HTML 规格对比卡片，最后输出一份自检清单。',
      output: { type: 'checklist' },
    });

    expect(prompt).toContain('完整自包含 HTML 页面');
    expect(prompt).toContain('主交付物优先用 kind=html');
    expect(prompt).toContain('manifest output.type=checklist');
  });
});
