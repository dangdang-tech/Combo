// 步骤状态机单测（F-09）——五态/序号/路由/底栏文案/续传步骤推导，纯函数无 React。
import { describe, it, expect } from 'vitest';
import {
  WIZARD_STEPS,
  WIZARD_STEP_COUNT,
  stepIndex,
  pathForStep,
  stepForPath,
  stepLabel,
  nextStep,
  prevStep,
  nextStepAction,
  isFirstStep,
  isLastStep,
  buildStepNodes,
  stepSummary,
} from './wizardMachine.js';

describe('wizardMachine 基础', () => {
  it('五步固定序 = import→extract→select→structure→publish', () => {
    expect(WIZARD_STEPS).toEqual(['import', 'extract', 'select', 'structure', 'publish']);
    expect(WIZARD_STEP_COUNT).toBe(5);
  });

  it('stepIndex 1-based；首/末步判定', () => {
    expect(stepIndex('import')).toBe(1);
    expect(stepIndex('select')).toBe(3);
    expect(stepIndex('publish')).toBe(5);
    expect(isFirstStep('import')).toBe(true);
    expect(isFirstStep('select')).toBe(false);
    expect(isLastStep('publish')).toBe(true);
    expect(isLastStep('structure')).toBe(false);
  });

  it('path 与 step 双向映射（CREATE_STEPS 单源）', () => {
    expect(pathForStep('select')).toBe('/create/select');
    expect(stepForPath('/create/select')).toBe('select');
    expect(stepForPath('/create/structure')).toBe('structure');
    // 非五步子路由 → undefined（外壳兜底首步）。
    expect(stepForPath('/creator')).toBeUndefined();
  });

  it('nextStep/prevStep 边界（首步无上一、末步无下一）', () => {
    expect(nextStep('select')).toBe('structure');
    expect(prevStep('select')).toBe('extract');
    expect(prevStep('import')).toBeUndefined();
    expect(nextStep('publish')).toBeUndefined();
  });

  it('底栏主按钮动作名随步变；末步无下一步动作', () => {
    expect(nextStepAction('import')).toBe('提取能力项'); // §5.1.3
    expect(nextStepAction('extract')).toBe('选择能力');
    expect(nextStepAction('select')).toBe('结构化'); // §5.3
    expect(nextStepAction('publish')).toBeUndefined();
  });

  it('stepSummary = 「第 X 步，共 5 步」（§5.0）', () => {
    expect(stepSummary('import')).toBe('第 1 步，共 5 步');
    expect(stepSummary('select')).toBe('第 3 步，共 5 步');
  });

  it('stepLabel 取 CREATE_STEPS.label', () => {
    expect(stepLabel('select')).toContain('选择');
  });
});

describe('buildStepNodes（步骤条五态 + 续传）', () => {
  it('current 之前皆 done（可回看）、current 进行中、之后皆 todo（不可点）', () => {
    const nodes = buildStepNodes('select'); // 第 3 步进行中
    const byStep = Object.fromEntries(nodes.map((n) => [n.step, n]));
    expect(byStep.import!.status).toBe('done');
    expect(byStep.extract!.status).toBe('done');
    expect(byStep.select!.status).toBe('current');
    expect(byStep.structure!.status).toBe('todo');
    expect(byStep.publish!.status).toBe('todo');
    // 已完成步可回看（贯穿-16）；进行中/待办不可点。
    expect(byStep.import!.navigable).toBe(true);
    expect(byStep.select!.navigable).toBe(false);
    expect(byStep.structure!.navigable).toBe(false);
  });

  it('errors 覆写为 error 态，且 error 步可点进去重试（局部失败不连坐）', () => {
    const nodes = buildStepNodes('structure', { extract: true });
    const byStep = Object.fromEntries(nodes.map((n) => [n.step, n]));
    // extract 本应 done，被覆写为 error；其它步不受影响。
    expect(byStep.extract!.status).toBe('error');
    expect(byStep.extract!.navigable).toBe(true); // 可点进去重试（带退路）。
    expect(byStep.import!.status).toBe('done');
    expect(byStep.structure!.status).toBe('current');
  });

  it('待办步显序号数字（§5.0「待办显数字」）', () => {
    const nodes = buildStepNodes('import');
    const publish = nodes.find((n) => n.step === 'publish')!;
    expect(publish.status).toBe('todo');
    expect(publish.index).toBe(5);
  });

  it('首步进行中：全部后续 todo，无 done', () => {
    const nodes = buildStepNodes('import');
    expect(nodes.filter((n) => n.status === 'done')).toHaveLength(0);
    expect(nodes.find((n) => n.step === 'import')!.status).toBe('current');
  });

  it('末步进行中：前四步皆 done（可回看）', () => {
    const nodes = buildStepNodes('publish');
    expect(nodes.filter((n) => n.status === 'done')).toHaveLength(4);
    expect(nodes.every((n) => (n.status === 'done' ? n.navigable : true))).toBe(true);
  });
});
