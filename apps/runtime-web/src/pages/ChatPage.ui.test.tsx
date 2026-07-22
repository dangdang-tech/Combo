import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ArtifactView, SessionDetail } from '@cb/shared';
import { ChatPage } from './ChatPage.js';

const mocks = vi.hoisted(() => ({
  detail: undefined as SessionDetail | undefined,
  running: false,
  activeRunId: null as string | null,
  terminalRun: null as {
    runId: string;
    state: 'completed' | 'failed';
    message: string;
  } | null,
  errorMessage: null as string | null,
  artifact: null as ArtifactView | null,
  artifactContent: '<!doctype html><html><body><button>运行</button></body></html>',
  send: vi.fn(),
}));

vi.mock('../api/runtime.js', () => ({
  useSession: () => ({ data: mocks.detail, isPending: false, isError: false, refetch: vi.fn() }),
  useArtifactContent: () => ({
    data: mocks.artifactContent,
    isPending: false,
    isError: false,
  }),
}));

vi.mock('../api/useSessionStream.js', () => ({
  useSessionStream: () => ({
    activeArtifactId: mocks.artifact?.id ?? null,
    artifacts: mocks.artifact ? { [mocks.artifact.id]: mocks.artifact } : {},
    artifactList: mocks.artifact ? [mocks.artifact] : [],
    streamingText: null,
    running: mocks.running,
    activeRunId: mocks.activeRunId,
    terminalRun: mocks.terminalRun,
    errorMessage: mocks.errorMessage,
    send: mocks.send,
    interrupt: vi.fn(),
    selectArtifact: vi.fn(),
  }),
}));

vi.mock('../components/SessionSidebar.js', () => ({
  SessionSidebar: ({ experience }: { experience?: string }) => (
    <div data-testid="session-sidebar" data-experience={experience} />
  ),
}));

function sessionDetail(mode?: 'consume' | 'studio'): SessionDetail {
  return {
    session: {
      id: '11111111-1111-4111-8111-111111111111',
      capabilityId: '22222222-2222-4222-8222-222222222222',
      title: '周报助手页面设计',
      status: 'active',
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z',
      ...(mode ? { mode } : {}),
    },
    capability: {
      id: '22222222-2222-4222-8222-222222222222',
      name: '周报助手',
      summary: '整理本周工作',
      kind: 'workflow',
      inputs: [],
      starterPrompts: [],
    },
    messages: [],
    artifacts: [],
  } as SessionDetail;
}

function renderPage(url: string): void {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/session/:sessionId" element={<ChatPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ChatPage studio experience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.detail = sessionDetail('studio');
    mocks.running = false;
    mocks.activeRunId = null;
    mocks.terminalRun = null;
    mocks.errorMessage = null;
    mocks.artifact = null;
  });

  it('shows an honest UI-design first screen and returns to My Agent', () => {
    renderPage('/session/11111111-1111-4111-8111-111111111111?returnTo=%2Fcreate%2Fcapabilities');

    expect(screen.getByRole('heading', { level: 1, name: '周报助手 UI' })).toBeInTheDocument();
    expect(screen.getByText('UI 设计 · 修改保存在当前会话')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回我的 Agent' })).toHaveAttribute(
      'href',
      '/capabilities',
    );
    expect(screen.getByRole('complementary', { name: 'UI 设计对话' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '描述第一版 UI' })).toHaveAttribute(
      'placeholder',
      '描述你想要的页面结构、交互和视觉…',
    );
    expect(screen.getByRole('button', { name: '生成第一版 UI' })).toBeDisabled();
    expect(screen.getByRole('region', { name: '等待 UI 设计要求' })).toHaveTextContent(
      '从左侧开始设计',
    );
    expect(screen.queryByRole('region', { name: '本次试用输入' })).not.toBeInTheDocument();
    expect(screen.getByTestId('session-sidebar')).toHaveAttribute('data-experience', 'studio');
    expect(screen.queryByText('返回发布流程')).not.toBeInTheDocument();
  });

  it('keeps the first-generation state truthful and studio-specific', () => {
    mocks.running = true;
    renderPage('/session/11111111-1111-4111-8111-111111111111');

    expect(
      screen.getAllByRole('status').some((node) => node.textContent?.includes('正在生成第一版 UI')),
    ).toBe(true);
    expect(
      screen.queryByText(/理解页面与修改要求|整理页面版本|保留 Agent 能力/),
    ).not.toBeInTheDocument();
  });

  it('accepts mode=studio during mixed-version rollout', () => {
    mocks.detail = sessionDetail();
    renderPage('/session/11111111-1111-4111-8111-111111111111?mode=studio');

    expect(screen.getByRole('complementary', { name: 'UI 设计对话' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '等待 UI 设计要求' })).toBeInTheDocument();
  });

  it('does not send a business run into the Studio design conversation', () => {
    mocks.artifact = {
      id: '33333333-3333-4333-8333-333333333333',
      kind: 'html',
      title: '周报助手页面',
      updatedAt: '2026-07-23T01:00:00.000Z',
    };
    renderPage('/session/11111111-1111-4111-8111-111111111111');
    const frame = screen.getByTitle('周报助手页面') as HTMLIFrameElement;

    fireEvent(
      window,
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: { type: 'combo:run', version: 1, prompt: '生成本周周报' },
      }),
    );

    expect(mocks.send).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(
      '当前是 UI 设计预览。请返回「我的 Agent」，从真实试用运行 Agent。',
    );
  });
});

describe('ChatPage consume Miniapp bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.detail = sessionDetail('consume');
    mocks.running = false;
    mocks.activeRunId = null;
    mocks.terminalRun = null;
    mocks.errorMessage = null;
    mocks.artifact = {
      id: '33333333-3333-4333-8333-333333333333',
      kind: 'html',
      title: '周报助手页面',
      updatedAt: '2026-07-23T01:00:00.000Z',
    };
  });

  it('forwards a host-confirmed Miniapp request to the real session stream', async () => {
    mocks.send.mockResolvedValue({
      id: '44444444-4444-4444-8444-444444444444',
      seq: 1,
      turnId: '55555555-5555-4555-8555-555555555555',
      role: 'user',
      content: [{ type: 'text', text: '生成本周周报' }],
      status: 'completed',
      createdAt: '2026-07-23T01:01:00.000Z',
    });
    renderPage('/session/11111111-1111-4111-8111-111111111111');
    const frame = screen.getByTitle('周报助手页面') as HTMLIFrameElement;

    fireEvent(
      window,
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: { type: 'combo:run', version: 1, prompt: '  生成本周周报  ' },
      }),
    );

    expect(mocks.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认运行' }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
    expect(mocks.send).toHaveBeenCalledWith('生成本周周报');
  });
});
