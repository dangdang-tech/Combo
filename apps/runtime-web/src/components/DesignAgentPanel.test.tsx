import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DesignAgentPanel, type DesignAgentPanelProps } from './DesignAgentPanel.js';

function props(overrides: Partial<DesignAgentPanelProps> = {}): DesignAgentPanelProps {
  return {
    title: '每日待办管家',
    versionLabel: 'UI R2',
    messages: [],
    revisions: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        revisionNo: 1,
        artifactKey: 'main',
        artifactVersion: 1,
        sourceRunId: '22222222-2222-4222-8222-222222222222',
        summary: '生成首版',
        createdAt: '2026-07-21T10:00:00.000Z',
        verified: false,
      },
    ],
    selectedRevisionNo: 1,
    isRunning: false,
    isBootstrapping: false,
    readOnlyHistory: false,
    error: null,
    onBack: vi.fn(),
    onSend: vi.fn(() => true),
    onInterrupt: vi.fn(),
    onReturnLatest: vi.fn(),
    onSelectRevision: vi.fn(),
    onOpenArtifact: vi.fn(),
    ...overrides,
  };
}

describe('DesignAgentPanel', () => {
  it('turns a suggested edit into an editable prompt and sends it with Enter', () => {
    const onSend = vi.fn(() => true);
    render(<DesignAgentPanel {...props({ onSend })} />);

    fireEvent.click(screen.getByRole('button', { name: '统一色彩、间距和圆角' }));
    const composer = screen.getByRole('textbox', { name: '描述页面修改' });
    expect(composer).toHaveValue('统一色彩、间距和圆角');

    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('统一色彩、间距和圆角');
  });

  it('keeps a historical page read-only until the user returns to latest', () => {
    const onReturnLatest = vi.fn();
    render(
      <DesignAgentPanel
        {...props({
          readOnlyHistory: true,
          historyVersion: 1,
          latestVersion: 3,
          onReturnLatest,
        })}
      />,
    );

    expect(screen.getByText('正在预览历史 UI R1')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '描述页面修改' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '返回当前版' }));
    expect(onReturnLatest).toHaveBeenCalledTimes(1);
  });

  it('keeps the composer available while the first Miniapp is being prepared', () => {
    render(
      <DesignAgentPanel
        {...props({ revisions: [], selectedRevisionNo: undefined, isBootstrapping: true })}
      />,
    );

    expect(screen.getByText('正在把这个 Agent 包装成首版 Miniapp')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '描述页面修改' })).toBeEnabled();
  });

  it('queues an edit during bootstrap and applies it when the first revision settles', () => {
    const onSend = vi.fn(() => true);
    const { rerender } = render(
      <DesignAgentPanel
        {...props({
          revisions: [],
          selectedRevisionNo: undefined,
          isBootstrapping: true,
          onSend,
        })}
      />,
    );
    const composer = screen.getByRole('textbox', { name: '描述页面修改' });

    fireEvent.change(composer, { target: { value: '把结果区改成卡片' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();

    rerender(
      <DesignAgentPanel {...props({ revisions: [], selectedRevisionNo: undefined, onSend })} />,
    );
    expect(onSend).toHaveBeenCalledWith('把结果区改成卡片');
  });

  it('exposes a stop action while the Design Agent is running', () => {
    const onInterrupt = vi.fn();
    render(<DesignAgentPanel {...props({ isRunning: true, onInterrupt })} />);

    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    expect(onInterrupt).toHaveBeenCalledTimes(1);
  });

  it('shows immutable revision history and previews the selected revision', () => {
    const onSelectRevision = vi.fn();
    render(<DesignAgentPanel {...props({ onSelectRevision })} />);

    fireEvent.click(screen.getByRole('tab', { name: /版本历史/ }));
    fireEvent.click(screen.getByRole('button', { name: /UI R1/ }));
    expect(onSelectRevision).toHaveBeenCalledWith(1);
  });

  it('offers an explicit retry when the first Miniapp fails', () => {
    const onSend = vi.fn(() => true);
    render(
      <DesignAgentPanel
        {...props({
          revisions: [],
          selectedRevisionNo: undefined,
          error: '首版生成失败',
          onSend,
        })}
      />,
    );

    expect(screen.getByText('首版还没有生成出来')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试生成首版' }));
    expect(onSend).toHaveBeenCalledWith(expect.stringContaining('重新生成首版 Miniapp'));
  });

  it('pauses queued edits after an interrupted or failed run', () => {
    const onSend = vi.fn(() => true);
    const { rerender } = render(<DesignAgentPanel {...props({ isRunning: true, onSend })} />);
    const composer = screen.getByRole('textbox', { name: '描述页面修改' });
    fireEvent.change(composer, { target: { value: '把结果区改成卡片' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(screen.getByText('把结果区改成卡片')).toBeInTheDocument();

    rerender(<DesignAgentPanel {...props({ isRunning: false, error: '运行已打断。', onSend })} />);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps the prompt when the run controller does not accept the send', () => {
    const onSend = vi.fn(() => false);
    render(<DesignAgentPanel {...props({ onSend })} />);
    const composer = screen.getByRole('textbox', { name: '描述页面修改' });

    fireEvent.change(composer, { target: { value: '把结果区改成卡片' } });
    fireEvent.click(screen.getByRole('button', { name: '应用修改 ↑' }));

    expect(onSend).toHaveBeenCalledWith('把结果区改成卡片');
    expect(composer).toHaveValue('把结果区改成卡片');
  });
});
