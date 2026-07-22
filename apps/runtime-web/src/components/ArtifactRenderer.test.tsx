import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactRenderer } from './ArtifactRenderer.js';

const HTML = '<!doctype html><html><body><button>运行</button></body></html>';

function renderHtml(
  props: Partial<ComponentProps<typeof ArtifactRenderer>> = {},
): HTMLIFrameElement {
  render(<ArtifactRenderer kind="html" title="任务助手" content={HTML} {...props} />);
  return screen.getByTitle('任务助手') as HTMLIFrameElement;
}

function postRun(source: MessageEventSource | null, data: unknown): void {
  fireEvent(window, new MessageEvent('message', { source, data }));
}

describe('ArtifactRenderer Combo Runtime bridge', () => {
  it('requires trusted host confirmation before forwarding a trimmed, versioned request', async () => {
    const onRunRequest = vi.fn().mockResolvedValue({ turnId: 'turn-1' });
    const frame = renderHtml({ onRunRequest });

    postRun(frame.contentWindow, {
      type: 'combo:run',
      version: 1,
      prompt: '  整理今天的任务  ',
    });

    expect(onRunRequest).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '确认运行这个 Agent？' })).toHaveTextContent(
      '整理今天的任务',
    );

    fireEvent.click(screen.getByRole('button', { name: '确认运行' }));
    await waitFor(() => expect(onRunRequest).toHaveBeenCalledOnce());
    expect(onRunRequest).toHaveBeenCalledWith({ prompt: '整理今天的任务' });
  });

  it('ignores forged, malformed, empty, and oversized requests', () => {
    const onRunRequest = vi.fn().mockResolvedValue({ turnId: 'turn-1' });
    const frame = renderHtml({ onRunRequest });

    postRun(window, { type: 'combo:run', version: 1, prompt: '伪造来源' });
    postRun(null, { type: 'combo:run', version: 1, prompt: '缺少来源' });
    postRun(frame.contentWindow, { type: 'combo:run', version: 2, prompt: '错误版本' });
    postRun(frame.contentWindow, { type: 'combo:run', version: 1, prompt: '   ' });
    postRun(frame.contentWindow, {
      type: 'combo:run',
      version: 1,
      prompt: 'x'.repeat(12_001),
    });
    postRun(frame.contentWindow, 'not-an-object');

    expect(onRunRequest).not.toHaveBeenCalled();
  });

  it('prevents duplicate turns and only completes the matching turnId', async () => {
    const onRunRequest = vi.fn().mockResolvedValue({ turnId: 'turn-current' });
    const { rerender } = render(
      <ArtifactRenderer kind="html" title="任务助手" content={HTML} onRunRequest={onRunRequest} />,
    );
    const frame = screen.getByTitle('任务助手') as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    const request = { type: 'combo:run', version: 1, prompt: '执行真实任务' };

    postRun(frame.contentWindow, request);
    postRun(frame.contentWindow, request);

    expect(onRunRequest).not.toHaveBeenCalled();
    expect(screen.getAllByRole('dialog', { name: '确认运行这个 Agent？' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '确认运行' }));
    await waitFor(() => expect(onRunRequest).toHaveBeenCalledOnce());
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'combo:run-state', version: 1, state: 'running' }),
      '*',
    );

    rerender(
      <ArtifactRenderer
        kind="html"
        title="任务助手"
        content={HTML}
        onRunRequest={onRunRequest}
        runActive
        activeRunId="turn-current"
      />,
    );
    rerender(
      <ArtifactRenderer
        kind="html"
        title="任务助手"
        content={HTML}
        onRunRequest={onRunRequest}
        runActive={false}
        terminalRun={{
          runId: 'turn-history',
          state: 'completed',
          message: '历史轮完成',
        }}
      />,
    );

    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ state: 'completed', message: '历史轮完成' }),
      '*',
    );

    rerender(
      <ArtifactRenderer
        kind="html"
        title="任务助手"
        content={HTML}
        onRunRequest={onRunRequest}
        terminalRun={{
          runId: 'turn-current',
          state: 'completed',
          message: '当前轮完成',
        }}
      />,
    );

    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'combo:run-state',
          version: 1,
          state: 'completed',
          message: '当前轮完成',
        }),
        '*',
      ),
    );
  });

  it('reports a matching real terminal failure to the Miniapp', async () => {
    const onRunRequest = vi.fn().mockResolvedValue({ turnId: 'turn-current' });
    const { rerender } = render(
      <ArtifactRenderer kind="html" title="任务助手" content={HTML} onRunRequest={onRunRequest} />,
    );
    const frame = screen.getByTitle('任务助手') as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow as Window, 'postMessage');

    postRun(frame.contentWindow, { type: 'combo:run', version: 1, prompt: '执行任务' });
    fireEvent.click(screen.getByRole('button', { name: '确认运行' }));
    await waitFor(() => expect(onRunRequest).toHaveBeenCalledOnce());
    rerender(
      <ArtifactRenderer
        kind="html"
        title="任务助手"
        content={HTML}
        onRunRequest={onRunRequest}
        runActive
        activeRunId="turn-current"
      />,
    );
    rerender(
      <ArtifactRenderer
        kind="html"
        title="任务助手"
        content={HTML}
        onRunRequest={onRunRequest}
        terminalRun={{
          runId: 'turn-current',
          state: 'failed',
          message: '运行失败，请重试。',
        }}
      />,
    );

    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'combo:run-state',
          version: 1,
          state: 'failed',
          message: '运行失败，请重试。',
        }),
        '*',
      ),
    );
  });

  it('releases the request lock and reports failure when POST rejects before SSE starts', async () => {
    const onRunRequest = vi.fn().mockRejectedValue(new Error('服务暂时不可用，请重试。'));
    const frame = renderHtml({ onRunRequest });
    const postMessage = vi.spyOn(frame.contentWindow as Window, 'postMessage');

    postRun(frame.contentWindow, { type: 'combo:run', version: 1, prompt: '执行任务' });
    fireEvent.click(screen.getByRole('button', { name: '确认运行' }));

    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'failed', message: '服务暂时不可用，请重试。' }),
        '*',
      ),
    );

    postRun(frame.contentWindow, { type: 'combo:run', version: 1, prompt: '重新执行' });
    expect(screen.getByRole('dialog', { name: '确认运行这个 Agent？' })).toHaveTextContent(
      '重新执行',
    );
  });

  it('cancels from the trusted host without starting a turn and reports blocked', () => {
    const onRunRequest = vi.fn().mockResolvedValue({ turnId: 'turn-1' });
    const frame = renderHtml({ onRunRequest });
    const postMessage = vi.spyOn(frame.contentWindow as Window, 'postMessage');

    postRun(frame.contentWindow, { type: 'combo:run', version: 1, prompt: '执行任务' });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(onRunRequest).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'blocked',
        message: '已取消，本次没有运行 Agent。',
      }),
      '*',
    );
  });

  it('blocks a Studio preview request instead of running the design session', () => {
    const onRunRequest = vi.fn().mockResolvedValue({ turnId: 'turn-1' });
    const onRunBlocked = vi.fn();
    const frame = renderHtml({
      onRunRequest,
      runDisabledMessage: '请从真实试用运行 Agent。',
      onRunBlocked,
    });
    const postMessage = vi.spyOn(frame.contentWindow as Window, 'postMessage');

    postRun(frame.contentWindow, { type: 'combo:run', version: 1, prompt: '执行任务' });

    expect(onRunRequest).not.toHaveBeenCalled();
    expect(onRunBlocked).toHaveBeenCalledWith('请从真实试用运行 Agent。');
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'combo:run-state', version: 1, state: 'blocked' }),
      '*',
    );
  });
});
