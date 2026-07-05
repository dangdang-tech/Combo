// 任务详情测试：SSE 实时进度（快照点亮 + progress + item-appended + done 终态刷新）与失败重试。
import { describe, it, expect, afterEach } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installFetchMock, type FetchMock } from '../../test/mockFetch.js';
import { MockFetchEventSource } from '../../test/mockFetchEventSource.js';
import { __setFetchEventSourceForTests } from '../../api/index.js';
import { makeTask, makeCapability, envelopeBody } from '../../test/fixtures.js';
import { renderPage } from '../../test/renderWithProviders.js';
import { TaskDetailPage } from './TaskDetailPage.js';

let fm: FetchMock | undefined;
let restoreSse: (() => void) | undefined;
afterEach(() => {
  fm?.restore();
  fm = undefined;
  restoreSse?.();
  restoreSse = undefined;
});

const RUNNING = makeTask({
  id: 't-1',
  description: '提取我的对话历史',
  currentStep: 'extract',
  status: 'running',
  upload: {
    status: 'processed',
    partsExpected: 5,
    partsLanded: 5,
    pairingExpiresAt: '2026-07-04T12:00:00.000Z',
  },
});

function renderDetail(): void {
  renderPage(<TaskDetailPage />, { route: '/tasks/t-1', path: '/tasks/:taskId' });
}

describe('TaskDetailPage — SSE 实时进度', () => {
  it('state_snapshot 点亮子任务 → progress 更新 → item-appended 逐个显示 → done 终态刷新', async () => {
    restoreSse = __setFetchEventSourceForTests(MockFetchEventSource.impl);
    const succeeded = makeTask({ ...RUNNING, status: 'succeeded', capabilityCount: 2 });
    const cap1 = makeCapability({ id: 'c1', name: '周报整理' });
    const cap2 = makeCapability({ id: 'c2', name: '代码评审' });
    fm = installFetchMock([
      { status: 200, json: envelopeBody(RUNNING) },
      { status: 200, json: envelopeBody(succeeded) }, // done 后失效重拉
      // 能力项列表以库为真源：SSE item-appended 只触发重拉（先空，随后逐个出现）。
      { match: '/capabilities', status: 200, json: envelopeBody([]) },
      { match: '/capabilities', status: 200, json: envelopeBody([cap1, cap2]) },
    ]);
    renderDetail();

    await screen.findByText('提取我的对话历史');
    expect(screen.getByText('上传完成')).toBeInTheDocument();

    // 跑着的任务建了 SSE 流。
    const conn = MockFetchEventSource.last!;
    expect(conn.url).toBe('/api/v1/tasks/t-1/events');
    act(() => conn.open());

    // 首帧 state_snapshot：全量 progress + 子任务点亮。
    act(() =>
      conn.emit(
        'state_snapshot',
        {
          progress: {
            percent: 30,
            phrase: '正在切分会话段落…',
            subtasks: [
              { key: 'fetch', label: '读取上传内容', status: 'done' },
              { key: 'segment', label: '切分会话段落', status: 'running' },
            ],
          },
        },
        { id: '1-1' },
      ),
    );
    expect(screen.getByText('正在切分会话段落…')).toBeInTheDocument();
    expect(screen.getByText('读取上传内容')).toBeInTheDocument();

    // progress 增量帧：量化文案更新，子任务清单保留。
    act(() =>
      conn.emit('progress', { percent: 62, phrase: '已分析 6 / 10 段会话' }, { id: '2-1' }),
    );
    expect(screen.getByText('已分析 6 / 10 段会话')).toBeInTheDocument();
    expect(screen.getByText('切分会话段落')).toBeInTheDocument();

    // item-appended：触发能力列表重拉，新能力项就地浮现（带试用/发布动作）。
    act(() => conn.emit('item-appended', { item: cap1 }, { id: '3-1' }));
    act(() => conn.emit('item-appended', { item: cap2 }, { id: '3-2' }));
    expect(await screen.findByText('周报整理')).toBeInTheDocument();
    expect(await screen.findByText('代码评审')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '去试用' })[0]).toHaveAttribute(
      'href',
      '/try/c/c1',
    );
    expect(screen.getAllByRole('button', { name: '发布' })).toHaveLength(2);

    // done 帧 → 重拉任务定格终态；能力项留在原地，能力页只是补充入口。
    act(() =>
      conn.emit('done', { status: 'succeeded', result: { capabilityCount: 2 } }, { id: '4-1' }),
    );
    expect(await screen.findByRole('heading', { name: '提取完成' })).toBeInTheDocument();
    expect(screen.getByText(/共提取出 2 个能力项/)).toBeInTheDocument();
    expect(screen.getByText('周报整理')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '能力页' })).toHaveAttribute('href', '/capabilities');
  });
});

describe('TaskDetailPage — 失败与重试', () => {
  it('失败任务显示 lastError 人话 + 重试按钮；重试 POST 后回到跑态', async () => {
    restoreSse = __setFetchEventSourceForTests(MockFetchEventSource.impl);
    const failed = makeTask({
      ...RUNNING,
      status: 'failed',
      retryCount: 1,
      lastError: {
        userMessage: '这次处理超时了，点重试再来一次。',
        retriable: true,
        action: 'retry',
        traceId: 't-timeout',
      },
    });
    fm = installFetchMock([
      { status: 200, json: envelopeBody(failed) },
      { status: 200, json: envelopeBody(RUNNING) }, // POST retry 响应
      { match: '/capabilities', status: 200, json: envelopeBody([]) }, // 回跑态后的能力列表
    ]);
    renderDetail();

    expect(await screen.findByText('这次处理超时了，点重试再来一次。')).toBeInTheDocument();
    expect(screen.getByText('已重试 1 次。')).toBeInTheDocument();
    // 终态任务不建 SSE 流。
    expect(MockFetchEventSource.connections).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    const post = fm.calls.find((c) => c.method === 'POST');
    expect(post?.url).toBe('/api/v1/tasks/t-1/retry');

    // 重试成功 → 任务回 running（badge 变提取中），重新建流。
    expect(await screen.findByText('提取中')).toBeInTheDocument();
    expect(MockFetchEventSource.connections.length).toBeGreaterThan(0);
  });
});
