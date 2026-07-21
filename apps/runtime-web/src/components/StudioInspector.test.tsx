import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StudioInspector, type StudioInspectorProps } from './StudioInspector.js';

const resultElement = {
  key: 'result-main',
  label: '今日安排结果',
  role: 'region',
  text: '3 项任务已经排好',
  tagName: 'section',
};

function props(overrides: Partial<StudioInspectorProps> = {}): StudioInspectorProps {
  return {
    elements: [
      resultElement,
      {
        key: 'run-primary',
        label: '开始整理',
        role: 'button',
        text: '开始整理',
        tagName: 'button',
      },
    ],
    selectedElement: null,
    inspectionEnabled: false,
    revisionNo: 2,
    verified: false,
    readOnly: false,
    isRunning: false,
    isTestRunning: false,
    reusableTestPrompt: '',
    onToggleInspection: vi.fn(),
    onSelectElement: vi.fn(),
    onClearSelection: vi.fn(),
    onApplyEdit: vi.fn(() => true),
    onRerunTest: vi.fn(() => true),
    ...overrides,
  };
}

describe('StudioInspector', () => {
  it('selects a semantic page element from the outline', () => {
    const onSelectElement = vi.fn();
    render(<StudioInspector {...props({ onSelectElement })} />);

    fireEvent.click(screen.getByRole('button', { name: /今日安排结果/ }));
    expect(onSelectElement).toHaveBeenCalledWith(resultElement);
  });

  it('turns a quick action into a scoped Design Agent prompt', () => {
    const onApplyEdit = vi.fn(() => true);
    render(
      <StudioInspector
        {...props({ selectedElement: resultElement, inspectionEnabled: true, onApplyEdit })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '强化重点' }));
    expect(onApplyEdit).toHaveBeenCalledWith(expect.stringContaining('今日安排结果'));
    expect(onApplyEdit).toHaveBeenCalledWith(
      expect.stringContaining('data-combo-key="result-main"'),
    );
    expect(onApplyEdit).toHaveBeenCalledWith(expect.stringContaining('保留其它区域'));
  });

  it('reuses the previous real task for the current revision', () => {
    const onRerunTest = vi.fn(() => true);
    render(
      <StudioInspector {...props({ reusableTestPrompt: '整理今天最重要的三件事', onRerunTest })} />,
    );

    fireEvent.click(screen.getByRole('button', { name: '用同案例重跑 R2 →' }));
    expect(onRerunTest).toHaveBeenCalledTimes(1);
  });

  it('keeps historical revisions read-only', () => {
    render(
      <StudioInspector
        {...props({
          selectedElement: resultElement,
          readOnly: true,
          reusableTestPrompt: '整理今天最重要的三件事',
        })}
      />,
    );

    expect(screen.getByRole('textbox', { name: '描述选中元素的修改' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '强化重点' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '用同案例重跑 R2 →' })).toBeDisabled();
  });
});
