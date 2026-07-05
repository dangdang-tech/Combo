// 系统提示词编排自检：作者 instructions 逐字在前，平台注入段带服务端日期与证据纪律（issue #19）。
import { describe, expect, it } from 'vitest';
import type { CapabilityDefinition } from '@cb/shared';
import { composeSystemPrompt } from '../modules/agent/build-agent.js';

const DEFINITION: CapabilityDefinition = {
  version: 1,
  name: '文档一致性核查',
  summary: '对照文档与代码找出不一致',
  kind: '分析',
  instructions: '你是文档一致性核查助手。逐条对照文档声明与代码实现。',
  inputs: [],
  starterPrompts: [],
  meta: {},
};

describe('composeSystemPrompt', () => {
  it('作者 instructions 逐字开头，能力名称与简介在平台注入段里', () => {
    const prompt = composeSystemPrompt(DEFINITION, new Date('2026-07-06T08:00:00Z'));
    expect(prompt.startsWith('你是文档一致性核查助手。')).toBe(true);
    expect(prompt).toContain('名称：文档一致性核查');
    expect(prompt).toContain('简介：对照文档与代码找出不一致');
  });

  it('注入服务端日期：产物写日期以它为准，不靠模型记忆推断', () => {
    const prompt = composeSystemPrompt(DEFINITION, new Date('2026-07-06T08:00:00Z'));
    expect(prompt).toContain('今天的日期是 2026-07-06');
  });

  it('注入证据纪律：材料未覆盖的事实不得当作已证实', () => {
    const prompt = composeSystemPrompt(DEFINITION, new Date('2026-07-06T08:00:00Z'));
    expect(prompt).toContain('# 事实纪律');
    expect(prompt).toContain('当前材料未覆盖，需要补充确认');
    expect(prompt).toContain('材料直接证明的结论');
  });

  it('缺省用当下时间：不传 now 也能生成含日期的提示词', () => {
    const prompt = composeSystemPrompt(DEFINITION);
    expect(prompt).toMatch(/今天的日期是 \d{4}-\d{2}-\d{2}/);
  });
});
