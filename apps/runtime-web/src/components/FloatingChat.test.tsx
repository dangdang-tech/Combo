import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FloatingChat, type FloatingChatProps } from './FloatingChat.js';

function props(overrides: Partial<FloatingChatProps> = {}): FloatingChatProps {
  return {
    sessionId: '11111111-1111-4111-8111-111111111111',
    messages: [],
    streamingText: null,
    isRunning: false,
    hasArtifact: true,
    error: null,
    onSend: vi.fn(),
    onInterrupt: vi.fn(),
    ...overrides,
  };
}

describe('FloatingChat conversation rail', () => {
  it('keeps the composer editable while a page change is running', () => {
    render(<FloatingChat {...props({ isRunning: true })} />);

    expect(screen.getByRole('textbox', { name: '描述页面修改' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '停止当前修改' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('正在应用修改');
  });

  it('uses the same primary action to stop when empty and queue when typed', () => {
    const onInterrupt = vi.fn();
    render(<FloatingChat {...props({ isRunning: true, onInterrupt })} />);

    fireEvent.click(screen.getByRole('button', { name: '停止当前修改' }));
    expect(onInterrupt).toHaveBeenCalledTimes(1);

    const composer = screen.getByRole('textbox', { name: '描述页面修改' });
    fireEvent.change(composer, { target: { value: '再收紧一点间距' } });
    expect(screen.getByRole('button', { name: '停止当前修改' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '加入修改队列' }));
    expect(screen.getByText('1 条修改待执行')).toBeInTheDocument();
  });

  it('applies a queued edit after the active run completes', async () => {
    const onSend = vi.fn();
    const running = props({ isRunning: true, onSend });
    const { rerender } = render(<FloatingChat {...running} />);
    const composer = screen.getByRole('textbox', { name: '描述页面修改' });
    fireEvent.change(composer, { target: { value: '把主按钮改成暖红色' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();

    rerender(<FloatingChat {...running} isRunning={false} />);
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('把主按钮改成暖红色'));
  });

  it('sends an idle edit with Enter and keeps Shift+Enter for a newline', () => {
    const onSend = vi.fn();
    render(<FloatingChat {...props({ onSend })} />);
    const composer = screen.getByRole('textbox', { name: '描述页面修改' });

    fireEvent.change(composer, { target: { value: '统一页面圆角' } });
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('统一页面圆角');
  });

  it('pauses queued edits after a failed run and offers an explicit resume', () => {
    const onSend = vi.fn();
    const running = props({ isRunning: true, onSend });
    const { rerender } = render(<FloatingChat {...running} />);
    const composer = screen.getByRole('textbox', { name: '描述页面修改' });
    fireEvent.change(composer, { target: { value: '扩大结果区域' } });
    fireEvent.keyDown(composer, { key: 'Enter' });

    rerender(<FloatingChat {...running} isRunning={false} error="这轮修改失败了" />);
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '继续执行' }));
    expect(onSend).toHaveBeenCalledWith('扩大结果区域');
  });
});
