import { fireEvent, render, screen } from '@testing-library/react';
import type { ArtifactVersion } from '@cb/shared';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactRenderer } from './ArtifactRenderer.js';

function htmlArtifact(): ArtifactVersion {
  return {
    artifactKey: 'main',
    version: 2,
    kind: 'html',
    title: '每日待办 Miniapp',
    language: null,
    content:
      '<!doctype html><html><body><h1>Agent-VM 任务助手</h1><button data-combo-key="run-primary">运行</button></body></html>',
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

  it('injects the Studio inspection bridge only for editable previews', () => {
    const { rerender } = render(<ArtifactRenderer artifact={htmlArtifact()} />);
    let frame = screen.getByTitle('每日待办 Miniapp') as HTMLIFrameElement;

    expect(frame.srcdoc).not.toContain('combo:element-select');

    rerender(
      <ArtifactRenderer artifact={htmlArtifact()} inspectionEnabled onElementSelect={vi.fn()} />,
    );
    frame = screen.getByTitle('每日待办 Miniapp') as HTMLIFrameElement;

    expect(frame.srcdoc).toContain('combo:element-select');
    expect(frame.srcdoc).toContain('data-combo-key="run-primary"');
  });

  it('renders HTML results as a static, network-isolated preview', () => {
    const artifact = {
      ...htmlArtifact(),
      content:
        '<!doctype html><html><head><meta http-equiv="refresh" content="0;url=https://evil.test"><style>body{color:red}</style></head><body><script>window.__ran = true</script><form action="https://evil.test"><button>发送</button></form></body></html>',
    };
    render(<ArtifactRenderer artifact={artifact} interactive={false} />);
    const frame = screen.getByTitle('每日待办 Miniapp') as HTMLIFrameElement;

    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-scripts');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-forms');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-popups');
    expect(frame).toHaveAttribute('tabindex', '-1');
    expect(frame).toHaveStyle({ pointerEvents: 'none' });
    expect(frame.srcdoc).toContain("default-src 'none'");
    expect(frame.srcdoc).toContain("style-src 'unsafe-inline'");
    expect(frame.srcdoc).toContain('img-src data: blob:');
    expect(frame.srcdoc).toContain("connect-src 'none'");
    expect(frame.srcdoc).toContain("form-action 'none'");
    expect(frame.srcdoc).not.toMatch(
      /<meta\b[^>]*\bhttp-equiv\s*=\s*(?:"refresh"|'refresh'|refresh\b)/i,
    );
    expect(frame.srcdoc).not.toContain('<script');
    expect(frame.srcdoc).not.toContain('action="https://evil.test"');
  });

  it('installs the static CSP in the real head even when content contains fake head text', () => {
    const artifact = {
      ...htmlArtifact(),
      content:
        '<!doctype html><html><head><title>真实标题</title><meta http-equiv="Content-Security-Policy" content="default-src *"></head><body><!-- <head><meta http-equiv="refresh" content="0;url=https://evil.test"></head> --><script>const fake = "<head></head>"</script><img src="https://evil.test/pixel.png"><img src="data:image/png;base64,AA=="></body></html>',
    };
    render(<ArtifactRenderer artifact={artifact} interactive={false} />);
    const frame = screen.getByTitle('每日待办 Miniapp') as HTMLIFrameElement;
    const dom = new JSDOM(frame.srcdoc);
    const policies = dom.window.document.head.querySelectorAll(
      'meta[http-equiv="Content-Security-Policy"]',
    );
    const images = dom.window.document.querySelectorAll('img');

    expect(policies).toHaveLength(1);
    expect(dom.window.document.head.firstElementChild).toBe(policies[0]);
    expect(policies[0]).toHaveAttribute('content', expect.stringContaining("default-src 'none'"));
    expect(dom.window.document.head.querySelector('title')).toHaveTextContent('真实标题');
    expect(dom.window.document.querySelector('script')).toBeNull();
    expect(images[0]).not.toHaveAttribute('src');
    expect(images[1]).toHaveAttribute('src', 'data:image/png;base64,AA==');
  });

  it('keeps the primary Miniapp interactive by default', () => {
    const artifact = {
      ...htmlArtifact(),
      content:
        '<!doctype html><html><body><script>window.__interactive = true</script><button>运行</button></body></html>',
    };
    render(<ArtifactRenderer artifact={artifact} />);
    const frame = screen.getByTitle('每日待办 Miniapp') as HTMLIFrameElement;

    expect(frame.getAttribute('sandbox')).toContain('allow-scripts');
    expect(frame.getAttribute('sandbox')).toContain('allow-forms');
    expect(frame.getAttribute('sandbox')).toContain('allow-popups');
    expect(frame.srcdoc).toContain('window.__interactive = true');
    expect(frame.srcdoc).not.toContain('Content-Security-Policy');
    expect(frame).not.toHaveAttribute('tabindex');
    expect(frame).not.toHaveStyle({ pointerEvents: 'none' });
  });

  it('selects a semantic page element even when the generated HTML omitted its stable key', async () => {
    render(
      <ArtifactRenderer
        artifact={htmlArtifact()}
        inspectionEnabled
        onElementSelect={vi.fn()}
        onElementManifest={vi.fn()}
      />,
    );
    const frame = screen.getByTitle('每日待办 Miniapp') as HTMLIFrameElement;
    const dom = new JSDOM(frame.srcdoc, {
      pretendToBeVisual: true,
      runScripts: 'dangerously',
      url: 'https://preview.combo.test/',
    });
    await new Promise<void>((resolve) => dom.window.addEventListener('load', () => resolve()));
    const postMessage = vi.spyOn(dom.window, 'postMessage');

    dom.window.dispatchEvent(
      new dom.window.MessageEvent('message', {
        source: dom.window as unknown as MessageEventSource,
        data: {
          type: 'combo:inspection-state',
          version: 1,
          enabled: true,
          selectedElementKey: null,
        },
      }),
    );
    const heading = dom.window.document.querySelector('h1');
    expect(heading).not.toBeNull();
    heading?.click();

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'combo:element-select',
        version: 1,
        element: expect.objectContaining({
          label: 'Agent-VM 任务助手',
          role: 'heading',
          stableKey: false,
          tagName: 'h1',
        }),
      },
      '*',
    );
    expect(heading).toHaveAttribute('data-combo-inspection-key');
    await new Promise<void>((resolve) => dom.window.requestAnimationFrame(() => resolve()));
  });

  it('accepts validated element selections and manifests only from the rendered iframe', () => {
    const onElementSelect = vi.fn();
    const onElementManifest = vi.fn();
    render(
      <ArtifactRenderer
        artifact={htmlArtifact()}
        inspectionEnabled
        onElementSelect={onElementSelect}
        onElementManifest={onElementManifest}
      />,
    );
    const frame = screen.getByTitle('每日待办 Miniapp') as HTMLIFrameElement;
    const element = {
      key: 'result-main',
      label: '今日安排结果',
      role: 'region',
      text: '3 项任务已经排好',
      tagName: 'section',
    };

    fireEvent(
      window,
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: { type: 'combo:element-select', version: 1, element },
      }),
    );
    fireEvent(
      window,
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: { type: 'combo:element-manifest', version: 1, elements: [element] },
      }),
    );

    expect(onElementSelect).toHaveBeenCalledWith(element);
    expect(onElementManifest).toHaveBeenCalledWith([element]);

    fireEvent(
      window,
      new MessageEvent('message', {
        source: window,
        data: { type: 'combo:element-select', version: 1, element },
      }),
    );
    fireEvent(
      window,
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: {
          type: 'combo:element-select',
          version: 1,
          element: { ...element, key: '', text: 'x'.repeat(241) },
        },
      }),
    );

    expect(onElementSelect).toHaveBeenCalledTimes(1);
  });

  it('sends inspection state to the iframe when the bridge is ready', () => {
    const onElementSelect = vi.fn();
    const { rerender } = render(
      <ArtifactRenderer
        artifact={htmlArtifact()}
        inspectionEnabled
        selectedElementKey="run-primary"
        onElementSelect={onElementSelect}
      />,
    );
    const frame = screen.getByTitle('每日待办 Miniapp') as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow as Window, 'postMessage');

    fireEvent(
      window,
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: { type: 'combo:inspection-ready', version: 1 },
      }),
    );

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'combo:inspection-state',
        version: 1,
        enabled: true,
        selectedElementKey: 'run-primary',
      },
      '*',
    );

    postMessage.mockClear();
    rerender(
      <ArtifactRenderer
        artifact={htmlArtifact()}
        inspectionEnabled={false}
        selectedElementKey={null}
        onElementSelect={onElementSelect}
      />,
    );

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'combo:inspection-state',
        version: 1,
        enabled: false,
        selectedElementKey: null,
      },
      '*',
    );
  });
});
