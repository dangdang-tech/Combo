import { fireEvent, render, screen } from '@testing-library/react';
import type { ArtifactVersion } from '@cb/shared';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactRenderer } from './ArtifactRenderer.js';

function htmlArtifact(): ArtifactVersion {
  return {
    artifactKey: 'main',
    version: 2,
    kind: 'html',
    title: '每日待办 Miniapp',
    language: null,
    content: '<!doctype html><html><body><button>运行</button></body></html>',
    createdAt: '2026-07-21T10:00:00.000Z',
  };
}

describe('ArtifactRenderer Runtime bridge', () => {
  it('accepts a versioned run request only from the rendered iframe', () => {
    const onRunRequest = vi.fn();
    render(<ArtifactRenderer artifact={htmlArtifact()} onRunRequest={onRunRequest} />);
    const frame = screen.getByTitle('每日待办 Miniapp') as HTMLIFrameElement;

    fireEvent(
      window,
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: { type: 'combo:run', version: 1, prompt: '  整理今天的任务  ' },
      }),
    );

    expect(onRunRequest).toHaveBeenCalledWith({ prompt: '整理今天的任务' });
  });

  it('ignores forged, malformed, empty, and oversized requests', () => {
    const onRunRequest = vi.fn();
    render(<ArtifactRenderer artifact={htmlArtifact()} onRunRequest={onRunRequest} />);
    const frame = screen.getByTitle('每日待办 Miniapp') as HTMLIFrameElement;
    const dispatch = (source: MessageEventSource | null, data: unknown) => {
      fireEvent(window, new MessageEvent('message', { source, data }));
    };

    dispatch(window, { type: 'combo:run', version: 1, prompt: '伪造来源' });
    dispatch(frame.contentWindow, { type: 'combo:run', version: 2, prompt: '旧协议' });
    dispatch(frame.contentWindow, { type: 'combo:run', version: 1, prompt: '   ' });
    dispatch(frame.contentWindow, {
      type: 'combo:run',
      version: 1,
      prompt: 'x'.repeat(12_001),
    });
    dispatch(frame.contentWindow, 'not-an-object');

    expect(onRunRequest).not.toHaveBeenCalled();
  });
});
