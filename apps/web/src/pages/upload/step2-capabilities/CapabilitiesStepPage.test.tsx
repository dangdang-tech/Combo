// 能力页容器集成测试（mock fetch + SSE）：提取过程态 → done 拉候选进 ready（默认全选）；
//   试用入口（trialCapability 直开 / 建版结构化后开）；发布入口为禁用占位（批量发布已整体下线）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { WizardProvider } from '../../wizard/index.js';
import { CapabilitiesStepPage } from './CapabilitiesStepPage.js';
import { __setOpenRuntimeTrialForTests } from './trialApi.js';
import { installFetchMock, type FetchMock } from '../../../test/mockFetch.js';
import { __setFetchEventSourceForTests } from '../../../api/useSSE.js';
import {
  MockFetchEventSource,
  type MockSSEConnection,
} from '../../../test/mockFetchEventSource.js';

function renderPage(
  initialPath = '/create/capabilities?snapshotId=s1',
  draftId = 'd1',
  opts: { snapshotId?: string } = {},
) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <WizardProvider
        initialStep="capabilities"
        initialDraftId={draftId}
        initialSnapshotId={opts.snapshotId}
      >
        <Routes>
          <Route path="/create/capabilities" element={<CapabilitiesStepPage />} />
        </Routes>
      </WizardProvider>
    </MemoryRouter>,
  );
}

function connAt(i: number): MockSSEConnection {
  const c = MockFetchEventSource.connections[i];
  if (!c) throw new Error(`no SSE connection at ${i}`);
  return c;
}

function candidateJson(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    extractJobId: 'j1',
    snapshotId: 's1',
    status: 'ready',
    name: '短视频脚本生成器',
    intent: '按选题生成口播脚本',
    slug: 'svs',
    type: 'recurring',
    confidence: 'high',
    segmentCount: 9,
    frequencyRatio: 0.6,
    reusability: null,
    scopeCoherence: 0.74,
    splitSuggested: null,
    scope: null,
    error: null,
    retryCount: 0,
    trialCapability: { capabilityId: 'cap1', versionId: 'v1', slug: 'svs' },
    createdAt: '2026-06-10T00:00:00Z',
    ...over,
  };
}

const extractDone = {
  status: 'completed',
  result: {
    candidateCount: 2,
    readyCount: 2,
    failedCount: 0,
    analyzedSegments: 215,
    degraded: false,
  },
};

let mock: FetchMock;
let restoreFes: () => void;
let restoreOpenTrial: (() => void) | undefined;
beforeEach(() => {
  MockFetchEventSource.reset();
  restoreFes = __setFetchEventSourceForTests(MockFetchEventSource.impl);
});
afterEach(() => {
  restoreFes();
  restoreOpenTrial?.();
  restoreOpenTrial = undefined;
  mock?.restore();
  vi.restoreAllMocks();
});

describe('CapabilitiesStepPage', () => {
  it('过程态 → 触发萃取(scope=extract.create) → done 拉候选进 ready（默认全选 + 信任背书段数）', async () => {
    mock = installFetchMock([
      // createExtractJob
      {
        status: 202,
        json: { data: { jobId: 'j1', snapshotId: 's1', status: 'queued', eventsUrl: '/x' } },
      },
      // fetchCandidates
      {
        status: 200,
        json: {
          data: [
            candidateJson(),
            candidateJson({ id: 'c2', name: 'VC 拷打模拟器', slug: 'vc', segmentCount: 4 }),
          ],
          meta: {
            page: { hasMore: false, nextCursor: null, limit: 50, order: 'asc' },
            confidenceSummary: { high: 2, med: 0, low: 0 },
          },
        },
      },
    ]);
    renderPage();
    // 触发萃取带 scope + draftId（后端据它同事务回填 drafts.extract_job_id）。
    await waitFor(() => {
      const call = mock.calls.find((c) => c.url.includes('/snapshots/s1/extract'));
      expect(call?.headers['X-Idempotency-Scope']).toBe('extract.create');
      expect(call?.headers['Idempotency-Key']).toBe('extract:session-mock-v1:d1:s1');
      expect(call?.body).toEqual({ draftId: 'd1' });
    });
    // 萃取 SSE（connection[0]）：open → done → 拉候选进 ready。
    await waitFor(() => expect(MockFetchEventSource.connections.length).toBe(1));
    act(() => connAt(0).open());
    act(() => connAt(0).emit('done', extractDone, { id: '1-0' }));

    await waitFor(() => expect(screen.getByText('短视频脚本生成器')).toBeInTheDocument());
    expect(screen.getByText('VC 拷打模拟器')).toBeInTheDocument();
    expect(screen.getByText('第二步 · 能力')).toBeInTheDocument();
    expect(screen.getByText('你的能力，挑选后一键发布')).toBeInTheDocument();
    expect(screen.queryByText('已入')).toBeNull();
    // 信任背书：来源 session 段数。
    expect(screen.getByText('来自 9 段 session')).toBeInTheDocument();
    expect(screen.getByText(/已分析 215 段 session/)).toBeInTheDocument();
    // 默认全选（两张卡的复选框都勾上）。
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => b.checked)).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: '取消全选' }));
    expect((screen.getAllByRole('checkbox') as HTMLInputElement[]).every((b) => !b.checked)).toBe(
      true,
    );

    await userEvent.click(screen.getByRole('button', { name: '全选' }));
    expect((screen.getAllByRole('checkbox') as HTMLInputElement[]).every((b) => b.checked)).toBe(
      true,
    );
  });

  it('发布入口为禁用占位：按钮恒 disabled + 占位文案，点击无动作（批量发布已整体下线）', async () => {
    mock = installFetchMock([
      {
        status: 202,
        json: { data: { jobId: 'j1', snapshotId: 's1', status: 'queued', eventsUrl: '/x' } },
      },
      {
        status: 200,
        json: {
          data: [candidateJson()],
          meta: {
            page: { hasMore: false, nextCursor: null, limit: 50, order: 'asc' },
            confidenceSummary: { high: 1, med: 0, low: 0 },
          },
        },
      },
    ]);
    renderPage();
    await waitFor(() => expect(MockFetchEventSource.connections.length).toBe(1));
    act(() => connAt(0).open());
    act(() => connAt(0).emit('done', extractDone, { id: '1-0' }));
    await waitFor(() => expect(screen.getByText('短视频脚本生成器')).toBeInTheDocument());

    const publishBtn = screen.getByRole('button', { name: '发布流程重构中，本期暂不开放' });
    expect(publishBtn).toBeDisabled();
    expect(publishBtn).toHaveAttribute('aria-disabled', 'true');
    // 点击无动作：不发任何发布命令（disabled 按钮无 onClick，命令面为空）。
    const before = mock.calls.length;
    fireEvent.click(publishBtn);
    expect(mock.calls.length).toBe(before);
    expect(mock.calls.some((c) => c.url.includes('/publish'))).toBe(false);
  });

  it('试用按钮 → 使用预准备 trialCapability 直接开 runtime trial session 并跳转', async () => {
    const openTrial = vi.fn();
    restoreOpenTrial = __setOpenRuntimeTrialForTests(openTrial);
    mock = installFetchMock([
      {
        status: 202,
        json: { data: { jobId: 'j1', snapshotId: 's1', status: 'queued', eventsUrl: '/x' } },
      },
      {
        status: 200,
        json: {
          data: [candidateJson()],
          meta: {
            page: { hasMore: false, nextCursor: null, limit: 50, order: 'asc' },
            confidenceSummary: { high: 1, med: 0, low: 0 },
          },
        },
      },
      {
        status: 201,
        json: {
          session: {
            id: 'rt1',
            capabilityId: 'cap1',
            slug: 'svs',
            version: '0.1.0',
            mode: 'trial',
            title: '短视频脚本生成器 试用',
            createdAt: '2026-06-10T00:00:00Z',
            updatedAt: '2026-06-10T00:00:00Z',
          },
          capability: { capabilityId: 'cap1', slug: 'svs', version: '0.1.0' },
        },
      },
    ]);
    renderPage();
    await waitFor(() => expect(MockFetchEventSource.connections.length).toBe(1));
    act(() => connAt(0).open());
    act(() => connAt(0).emit('done', extractDone, { id: '1-0' }));
    await waitFor(() => expect(screen.getByText('短视频脚本生成器')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: '试用 →' }));

    await waitFor(() =>
      expect(mock.calls.some((c) => c.url === '/api/v1/runtime/trial-chains/cap1/sessions')).toBe(
        true,
      ),
    );
    expect(mock.calls.some((c) => c.url === '/api/v1/capabilities')).toBe(false);
    expect(mock.calls.some((c) => c.url.includes('/versions/v1/structure'))).toBe(false);
    expect(mock.calls.find((c) => c.url.includes('/runtime/trial-chains'))?.body).toEqual({
      versionId: 'v1',
      title: '短视频脚本生成器 试用',
    });
    await waitFor(() => expect(openTrial).toHaveBeenCalledOnce());
    const trialUrl = openTrial.mock.calls[0]![0] as string;
    expect(trialUrl).toContain('/try/session/rt1');
    expect(new URLSearchParams(trialUrl.split('?')[1]).get('returnTo')).toBe(
      '/create/capabilities?snapshotId=s1&draftId=d1',
    );
  });

  it('试用回跳地址补齐向导上下文里的 snapshotId/draftId，避免回到裸能力页丢数据', async () => {
    const openTrial = vi.fn();
    restoreOpenTrial = __setOpenRuntimeTrialForTests(openTrial);
    mock = installFetchMock([
      {
        status: 202,
        json: { data: { jobId: 'j1', snapshotId: 's1', status: 'queued', eventsUrl: '/x' } },
      },
      {
        status: 200,
        json: {
          data: [candidateJson()],
          meta: {
            page: { hasMore: false, nextCursor: null, limit: 50, order: 'asc' },
            confidenceSummary: { high: 1, med: 0, low: 0 },
          },
        },
      },
      {
        status: 201,
        json: {
          session: {
            id: 'rt1',
            capabilityId: 'cap1',
            slug: 'svs',
            version: '0.1.0',
            mode: 'trial',
            title: '短视频脚本生成器 试用',
            createdAt: '2026-06-10T00:00:00Z',
            updatedAt: '2026-06-10T00:00:00Z',
          },
          capability: { capabilityId: 'cap1', slug: 'svs', version: '0.1.0' },
        },
      },
    ]);
    renderPage('/create/capabilities', 'd1', { snapshotId: 's1' });
    await waitFor(() => expect(MockFetchEventSource.connections.length).toBe(1));
    act(() => connAt(0).open());
    act(() => connAt(0).emit('done', extractDone, { id: '1-0' }));
    await waitFor(() => expect(screen.getByText('短视频脚本生成器')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: '试用 →' }));

    await waitFor(() => expect(openTrial).toHaveBeenCalledOnce());
    const trialUrl = openTrial.mock.calls[0]![0] as string;
    expect(new URLSearchParams(trialUrl.split('?')[1]).get('returnTo')).toBe(
      '/create/capabilities?snapshotId=s1&draftId=d1',
    );
  });

  it('试用建版失败 → 卡片内显示错误且不跳转', async () => {
    const openTrial = vi.fn();
    restoreOpenTrial = __setOpenRuntimeTrialForTests(openTrial);
    mock = installFetchMock([
      {
        status: 202,
        json: { data: { jobId: 'j1', snapshotId: 's1', status: 'queued', eventsUrl: '/x' } },
      },
      {
        status: 200,
        json: {
          data: [candidateJson({ trialCapability: undefined })],
          meta: {
            page: { hasMore: false, nextCursor: null, limit: 50, order: 'asc' },
            confidenceSummary: { high: 1, med: 0, low: 0 },
          },
        },
      },
      {
        status: 503,
        json: {
          error: {
            userMessage: '没能准备试用，请稍后重试。',
            retriable: true,
            action: 'retry',
            traceId: 't1',
          },
        },
      },
    ]);
    renderPage();
    await waitFor(() => expect(MockFetchEventSource.connections.length).toBe(1));
    act(() => connAt(0).open());
    act(() => connAt(0).emit('done', extractDone, { id: '1-0' }));
    await waitFor(() => expect(screen.getByText('短视频脚本生成器')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: '试用 →' }));

    expect(await screen.findByText('没能准备试用，请稍后重试。')).toBeInTheDocument();
    expect(openTrial).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '重试试用 →' })).toBeEnabled();
  });

  it('试用结构化启动失败 → 卡片内显示错误且不跳转', async () => {
    const openTrial = vi.fn();
    restoreOpenTrial = __setOpenRuntimeTrialForTests(openTrial);
    mock = installFetchMock([
      {
        status: 202,
        json: { data: { jobId: 'j1', snapshotId: 's1', status: 'queued', eventsUrl: '/x' } },
      },
      {
        status: 200,
        json: {
          data: [candidateJson({ trialCapability: undefined })],
          meta: {
            page: { hasMore: false, nextCursor: null, limit: 50, order: 'asc' },
            confidenceSummary: { high: 1, med: 0, low: 0 },
          },
        },
      },
      {
        status: 201,
        json: {
          data: {
            capabilityId: 'cap1',
            versionId: 'v1',
            slug: 'svs',
            version: '0.1.0',
            manifest: {},
            structureState: { fields: [], totalCount: 0, doneCount: 0 },
          },
        },
      },
      {
        status: 503,
        json: {
          error: {
            userMessage: '生成试用能力失败，请稍后重试。',
            retriable: true,
            action: 'retry',
            traceId: 't1',
          },
        },
      },
    ]);
    renderPage();
    await waitFor(() => expect(MockFetchEventSource.connections.length).toBe(1));
    act(() => connAt(0).open());
    act(() => connAt(0).emit('done', extractDone, { id: '1-0' }));
    await waitFor(() => expect(screen.getByText('短视频脚本生成器')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: '试用 →' }));

    expect(await screen.findByText('生成试用能力失败，请稍后重试。')).toBeInTheDocument();
    expect(openTrial).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '重试试用 →' })).toBeEnabled();
  });

  it('runtime trial session 创建失败 → 卡片内显示错误且不跳转', async () => {
    const openTrial = vi.fn();
    restoreOpenTrial = __setOpenRuntimeTrialForTests(openTrial);
    mock = installFetchMock([
      {
        status: 202,
        json: { data: { jobId: 'j1', snapshotId: 's1', status: 'queued', eventsUrl: '/x' } },
      },
      {
        status: 200,
        json: {
          data: [candidateJson()],
          meta: {
            page: { hasMore: false, nextCursor: null, limit: 50, order: 'asc' },
            confidenceSummary: { high: 1, med: 0, low: 0 },
          },
        },
      },
      {
        status: 503,
        json: {
          error: {
            userMessage: '没能打开试用，请稍后重试。',
            retriable: true,
            action: 'retry',
            traceId: 't1',
          },
        },
      },
    ]);
    renderPage();
    await waitFor(() => expect(MockFetchEventSource.connections.length).toBe(1));
    act(() => connAt(0).open());
    act(() => connAt(0).emit('done', extractDone, { id: '1-0' }));
    await waitFor(() => expect(screen.getByText('短视频脚本生成器')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: '试用 →' }));

    expect(await screen.findByText('没能打开试用，请稍后重试。')).toBeInTheDocument();
    expect(openTrial).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '重试试用 →' })).toBeEnabled();
  });

  it('提取完成但 0 候选 → 诚实空态，无发布区（永不裸转圈）', async () => {
    mock = installFetchMock([
      {
        status: 202,
        json: { data: { jobId: 'j1', snapshotId: 's1', status: 'queued', eventsUrl: '/x' } },
      },
      {
        status: 200,
        json: {
          data: [],
          meta: {
            page: { hasMore: false, nextCursor: null, limit: 50, order: 'asc' },
            confidenceSummary: { high: 0, med: 0, low: 0 },
          },
        },
      },
    ]);
    renderPage();
    await waitFor(() => expect(MockFetchEventSource.connections.length).toBe(1));
    act(() => connAt(0).open());
    act(() =>
      connAt(0).emit(
        'done',
        {
          status: 'completed',
          result: {
            candidateCount: 0,
            readyCount: 0,
            failedCount: 0,
            analyzedSegments: 100,
            degraded: false,
          },
        },
        { id: '1-0' },
      ),
    );
    await waitFor(() => expect(screen.getByText(/没识别出可复用的能力/)).toBeInTheDocument());
    // readyCount=0 → 底部动作区不渲染，无发布占位按钮。
    expect(screen.queryByRole('button', { name: '发布流程重构中，本期暂不开放' })).toBeNull();
  });
});
