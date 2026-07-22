// 我的 Agent 页测试（F-07）：项目识别 / 设计入口 / 精简筛选 / 空态 / 分页 / 错误。
import { useState, type ReactElement } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DashboardCapabilityRow } from '@cb/shared';
import { installFetchMock, type FetchMock } from '../../test/mockFetch.js';
import { renderPage } from '../__testutils__/renderPage.js';
import { __setOpenRuntimeTrialForTests } from '../upload/step2-capabilities/trialApi.js';
import { CapabilitiesPage } from './CapabilitiesPage.js';

const sseMock = vi.hoisted(() => ({
  status: 'connecting',
  error: null as { userMessage?: string } | null,
  done: null as {
    status: string;
    error?: { error: { userMessage: string } };
  } | null,
}));

vi.mock('../../api/useSSE.js', () => ({
  useSSE: () => ({
    kind: 'structure',
    status: sseMock.status,
    items: [],
    error: sseMock.error,
    done: sseMock.done,
  }),
}));

let forceCapabilitiesPageRender: (() => void) | undefined;

function ControlledCapabilitiesPage(): ReactElement {
  const [, setTick] = useState(0);
  forceCapabilitiesPageRender = () => setTick((tick) => tick + 1);
  return <CapabilitiesPage />;
}

function row(over: Partial<DashboardCapabilityRow> = {}): DashboardCapabilityRow {
  return {
    capabilityId: 'cap-1',
    versionId: 'v-1',
    slug: 'demo',
    name: '保险话术助手',
    tagline: '一句话简介',
    reviewStatus: 'published',
    statusLabel: '已上架',
    rejectReason: null,
    retryEditable: false,
    monthlyInvocations: null,
    spendSparkline: null,
    revenueMicros: null,
    studioAvailable: false,
    studioDraftable: false,
    nameNeedsReview: false,
    publicPageAvailable: true,
    publishedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...over,
  };
}

/** Paginated 信封：data + meta.page（+ usage 占位 placeholders）。 */
function pageBody(
  rows: DashboardCapabilityRow[],
  opts: { hasMore?: boolean; nextCursor?: string | null } = {},
): unknown {
  return {
    data: rows,
    meta: {
      traceId: 't',
      page: {
        nextCursor: opts.nextCursor ?? null,
        hasMore: opts.hasMore ?? false,
        limit: 20,
        order: 'desc',
      },
      placeholders: {
        monthlyInvocations: '暂无数据 / 上线后填充',
        spendSparkline: '暂无数据 / 上线后填充',
        revenueMicros: '暂无数据 / 上线后填充',
      },
    },
  };
}

let mock: FetchMock | undefined;
let restoreOpenTrial: (() => void) | undefined;
afterEach(() => {
  mock?.restore();
  restoreOpenTrial?.();
  sseMock.status = 'connecting';
  sseMock.error = null;
  sseMock.done = null;
  forceCapabilitiesPageRender = undefined;
  mock = undefined;
  restoreOpenTrial = undefined;
});

describe('我的 Agent 页', () => {
  it('渲染列表：能力名 + 后端单源状态文案（不前端自造）', async () => {
    mock = installFetchMock({
      status: 200,
      json: pageBody([row({ name: '保险话术助手', statusLabel: '已上架' })]),
    });
    renderPage(<CapabilitiesPage />);

    expect(await screen.findByText('保险话术助手')).toBeInTheDocument();
    // 状态徽章在表内（与同名筛选 chip 区分：scope 到 table）。
    expect(within(screen.getByRole('table')).getByText('已上架')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '我的 Agent' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Alpha·审核中' })).toBeNull();
  });

  it('不重复展示工作台的创作恢复卡，只给明确的创建入口', async () => {
    mock = installFetchMock({ status: 200, json: pageBody([row()]) });
    renderPage(<CapabilitiesPage />, '/capabilities');

    await screen.findByText('保险话术助手');
    expect(screen.queryByRole('region', { name: '继续上次创作' })).not.toBeInTheDocument();
    const create = screen.getByRole('button', { name: '创建 Agent' });
    expect(create).toBeInTheDocument();
    expect(create.closest('.cb-capabilities__list-toolbar')).not.toBeNull();
    expect(screen.queryByText(/进入设计空间修改页面/)).toBeNull();
  });

  it('管理页只呈现识别、状态、更新时间与创作动作，不混入分析数据列', async () => {
    mock = installFetchMock({ status: 200, json: pageBody([row()]) });
    renderPage(<CapabilitiesPage />);

    await screen.findByText('保险话术助手');
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: '最近更新' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'UI 与交互' })).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: '本月调用' })).toBeNull();
    expect(within(table).queryByRole('columnheader', { name: '收益' })).toBeNull();
    expect(screen.queryByText('暂无数据 / 上线后填充')).toBeNull();
  });

  it('不展示尚未兑现的行内试用入口', async () => {
    mock = installFetchMock({ status: 200, json: pageBody([row()]) });
    renderPage(<CapabilitiesPage />);
    await screen.findByText('保险话术助手');

    expect(screen.queryByRole('button', { name: '试用' })).not.toBeInTheDocument();
  });

  it('被退回态保留拒绝原因；回退后的公开版真实可达时仍可打开', async () => {
    mock = installFetchMock({
      status: 200,
      json: pageBody([
        row({
          reviewStatus: 'review_rejected',
          statusLabel: '已退回',
          rejectReason: '内容含敏感词',
          retryEditable: true,
          retryVersionId: 'rejected-v1',
          publicPageAvailable: true,
        }),
      ]),
    });
    renderPage(<CapabilitiesPage />);

    await screen.findByText('保险话术助手');
    const table = screen.getByRole('table');
    // 状态徽章「已退回」在表内（与同名筛选 chip 区分）。
    expect(within(table).getByText('已退回')).toBeInTheDocument();
    expect(within(table).getByText('内容含敏感词')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: /打开.*公开页/ })).toBeInTheDocument();
  });

  it('已上架直接显示公开页；不再渲染“更多”占位菜单', async () => {
    mock = installFetchMock({ status: 200, json: pageBody([row()]) });
    renderPage(<CapabilitiesPage />);
    await screen.findByText('保险话术助手');

    expect(screen.getByRole('link', { name: /打开.*公开页/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '更多操作' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('草稿尚未准备好 Studio：显示“生成 UI”，不显示公开页或假占位', async () => {
    mock = installFetchMock({
      status: 200,
      json: pageBody([
        row({
          reviewStatus: 'draft',
          statusLabel: '草稿',
          publishedAt: null,
          publicPageAvailable: false,
        }),
      ]),
    });
    renderPage(<CapabilitiesPage />);
    await screen.findByText('保险话术助手');

    expect(screen.queryByRole('button', { name: '重新创建' })).toBeNull();
    expect(screen.getByRole('button', { name: /生成.*UI 版本/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /公开页/ })).toBeNull();
    expect(screen.queryByText('—')).toBeNull();
    expect(screen.queryByText(/下架|改价|本期未开放/)).toBeNull();
  });

  it('未完成草稿点击“生成 UI”后等待结构化完成，并自动进入 UI Studio', async () => {
    const opened: string[] = [];
    restoreOpenTrial = __setOpenRuntimeTrialForTests((url) => opened.push(url));
    mock = installFetchMock([
      {
        status: 200,
        json: pageBody([
          row({
            reviewStatus: 'draft',
            statusLabel: '草稿',
            publishedAt: null,
            publicPageAvailable: false,
            studioAvailable: false,
          }),
        ]),
      },
      {
        status: 202,
        json: {
          data: {
            jobId: 'structure-job',
            versionId: 'v-1',
            eventsUrl: '/api/v1/versions/v-1/structure/events',
            structureState: {},
          },
        },
      },
      {
        status: 201,
        json: {
          session: {
            id: 'rt-generated',
            capabilityId: 'cap-1',
            slug: 'demo',
            version: '0.1.0',
            mode: 'trial',
            title: '保险话术助手 页面设计',
            createdAt: '2026-01-02T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
          },
        },
      },
    ]);
    renderPage(<ControlledCapabilitiesPage />, '/capabilities');

    await screen.findByText('保险话术助手');
    const generate = screen.getByRole('button', { name: /生成.*UI 版本/ });
    await userEvent.click(generate);
    await waitFor(() => expect(mock!.calls).toHaveLength(2));
    expect(mock.calls[1]?.url).toContain('/api/v1/versions/v-1/structure');
    expect(generate).toBeDisabled();
    expect(generate).toHaveAttribute('aria-busy', 'true');
    expect(generate).toHaveTextContent('正在打开…');
    expect(generate.closest('td')).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      sseMock.status = 'done';
      sseMock.done = { status: 'completed' };
      forceCapabilitiesPageRender?.();
    });
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(mock.calls[2]?.url).toContain('/api/v1/runtime/studio/trial-chains/cap-1/session');
    expect(mock.calls[2]?.method).toBe('POST');
    expect(mock.calls[2]?.body).toEqual({
      versionId: 'v-1',
      title: '保险话术助手 页面设计',
    });
    expect(opened[0]).toContain('/try/session/rt-generated?returnTo=%2Fcapabilities');
  });

  it('完整草稿可从列表恢复既有 UI Studio，会保留返回路径', async () => {
    const opened: string[] = [];
    restoreOpenTrial = __setOpenRuntimeTrialForTests((url) => opened.push(url));
    mock = installFetchMock([
      {
        status: 200,
        json: pageBody([
          row({
            reviewStatus: 'draft',
            statusLabel: '草稿',
            publishedAt: null,
            publicPageAvailable: false,
            studioAvailable: true,
          }),
        ]),
      },
      {
        status: 200,
        json: {
          session: {
            id: 'rt-1',
            capabilityId: 'cap-1',
            slug: 'demo',
            version: '0.1.0',
            mode: 'trial',
            title: '保险话术助手 页面设计',
            createdAt: '2026-01-02T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
          },
          verified: false,
        },
      },
    ]);
    renderPage(<CapabilitiesPage />, '/capabilities');

    await screen.findByText('保险话术助手');
    await userEvent.click(screen.getByRole('button', { name: /编辑.*UI 版本/ }));
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0]).toContain('/try/session/rt-1?returnTo=%2Fcapabilities');
    expect(mock.calls[1]?.url).toContain('/api/v1/runtime/studio/trial-chains/cap-1/session');
    expect(mock.calls[1]?.method).toBe('POST');
    expect(mock.calls[1]?.body).toEqual({
      versionId: 'v-1',
      title: '保险话术助手 页面设计',
    });
  });

  it('设计空间打开失败时，错误回到对应 Agent 行内并恢复按钮', async () => {
    mock = installFetchMock([
      {
        status: 200,
        json: pageBody([
          row({
            reviewStatus: 'draft',
            statusLabel: '草稿',
            publishedAt: null,
            publicPageAvailable: false,
            studioAvailable: true,
          }),
        ]),
      },
      {
        status: 503,
        json: {
          error: {
            userMessage: '设计空间暂时没有准备好，请稍后重试。',
            retriable: true,
            action: 'retry',
            traceId: 'studio-open',
          },
        },
      },
    ]);
    renderPage(<CapabilitiesPage />, '/capabilities');

    const name = await screen.findByText('保险话术助手');
    await userEvent.click(screen.getByRole('button', { name: /编辑.*UI 版本/ }));

    const capabilityRow = name.closest('tr');
    expect(capabilityRow).not.toBeNull();
    expect(await within(capabilityRow!).findByRole('alert')).toHaveTextContent(
      '设计空间暂时没有准备好，请稍后重试。',
    );
    expect(within(capabilityRow!).getByRole('button', { name: /编辑.*UI 版本/ })).toBeEnabled();
    expect(document.querySelector('.cb-capabilities__action-error')).toBeNull();
  });

  it('已发布且没有草稿时，先复制为新草稿，再进入对应版本的 UI Studio', async () => {
    const opened: string[] = [];
    restoreOpenTrial = __setOpenRuntimeTrialForTests((url) => opened.push(url));
    mock = installFetchMock([
      {
        status: 200,
        json: pageBody([
          row({
            studioDraftable: true,
            studioSourceVersionId: '11111111-1111-4111-8111-111111111111',
          }),
        ]),
      },
      {
        status: 201,
        json: {
          data: {
            capabilityId: 'cap-1',
            versionId: 'v-draft',
            slug: 'demo',
            version: '0.2.0',
            manifest: { name: '保险话术助手' },
            structureState: {},
          },
        },
      },
      {
        status: 201,
        json: {
          session: {
            id: 'rt-new',
            capabilityId: 'cap-1',
            slug: 'demo',
            version: '0.2.0',
            mode: 'trial',
            title: '保险话术助手 页面设计',
            createdAt: '2026-01-02T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
          },
        },
      },
    ]);
    renderPage(<CapabilitiesPage />, '/capabilities');

    await screen.findByText('保险话术助手');
    await userEvent.click(screen.getByRole('button', { name: /新建.*UI 版本/ }));
    await waitFor(() => expect(opened).toHaveLength(1));

    expect(mock.calls[1]?.url).toContain('/api/v1/capabilities');
    expect(mock.calls[1]?.body).toEqual({ capabilityId: 'cap-1' });
    expect(mock.calls[1]?.headers['Idempotency-Key']).toBe('studio:draft:cap-1:v-1');
    expect(mock.calls[2]?.url).toContain('/api/v1/runtime/studio/trial-chains/cap-1/session');
    expect(mock.calls[2]?.body).toEqual({
      versionId: 'v-draft',
      sourceVersionId: '11111111-1111-4111-8111-111111111111',
      title: '保险话术助手 页面设计',
    });
    expect(opened[0]).toContain('/try/session/rt-new?returnTo=%2Fcapabilities');
  });

  it('被退回 Agent 从精确被拒版本创建修复草稿，再进入 UI Studio', async () => {
    const rejectedVersionId = '22222222-2222-4222-8222-222222222222';
    const opened: string[] = [];
    restoreOpenTrial = __setOpenRuntimeTrialForTests((url) => opened.push(url));
    mock = installFetchMock([
      {
        status: 200,
        json: pageBody([
          row({
            reviewStatus: 'review_rejected',
            statusLabel: '已退回',
            retryEditable: true,
            retryVersionId: rejectedVersionId,
            studioSourceVersionId: rejectedVersionId,
            publicPageAvailable: false,
          }),
        ]),
      },
      {
        status: 201,
        json: {
          data: {
            capabilityId: 'cap-1',
            versionId: 'v-repair',
            slug: 'demo',
            version: '0.2.0',
            manifest: { name: '保险话术助手' },
            structureState: {},
          },
        },
      },
      {
        status: 201,
        json: {
          session: {
            id: 'rt-repair',
            capabilityId: 'cap-1',
            slug: 'demo',
            version: '0.2.0',
            mode: 'trial',
            title: '保险话术助手 页面设计',
            createdAt: '2026-01-02T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
          },
        },
      },
    ]);
    renderPage(<CapabilitiesPage />, '/capabilities');

    await screen.findByText('保险话术助手');
    await userEvent.click(screen.getByRole('button', { name: /修复.*UI 版本/ }));
    await waitFor(() => expect(opened).toHaveLength(1));

    expect(mock.calls[1]?.body).toEqual({ fromVersionId: rejectedVersionId });
    expect(mock.calls[1]?.headers['Idempotency-Key']).toBe(
      `studio:retry:cap-1:${rejectedVersionId}`,
    );
    expect(mock.calls[2]?.url).toContain('/api/v1/runtime/studio/trial-chains/cap-1/session');
    expect(mock.calls[2]?.body).toEqual({
      versionId: 'v-repair',
      sourceVersionId: rejectedVersionId,
      title: '保险话术助手 页面设计',
    });
    expect(opened[0]).toContain('/try/session/rt-repair?returnTo=%2Fcapabilities');
  });

  it('名称需要优化时也不暴露手动自动命名入口', async () => {
    mock = installFetchMock([
      {
        status: 200,
        json: pageBody([
          row({
            reviewStatus: 'draft',
            statusLabel: '草稿',
            publicPageAvailable: false,
            name: '<recommended_plugins>',
            nameNeedsReview: true,
            studioAvailable: true,
          }),
        ]),
      },
    ]);
    renderPage(<CapabilitiesPage />);

    await screen.findByText('<recommended_plugins>');
    expect(screen.queryByRole('button', { name: /自动整理.*名称/ })).toBeNull();
    expect(screen.queryByText('名称可优化')).toBeNull();
  });

  it('空态（无 Agent）→ 友好空态，不裸空表', async () => {
    mock = installFetchMock({ status: 200, json: pageBody([]) });
    renderPage(<CapabilitiesPage />);
    expect(await screen.findByText('还没有 Agent')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('状态筛选切换：当前档高亮 + 重新拉数（cursor 回第一页）', async () => {
    mock = installFetchMock({ status: 200, json: pageBody([row()]) });
    renderPage(<CapabilitiesPage />);
    await screen.findByText('保险话术助手');

    const publishedChip = screen.getByRole('button', { name: '已上架' });
    await userEvent.click(publishedChip);

    await waitFor(() => expect(publishedChip).toHaveAttribute('aria-pressed', 'true'));
    // 第二次请求带 status=published（换筛选回第一页，无 cursor）。
    await waitFor(() => {
      const last = mock?.calls.at(-1);
      expect(last?.url).toContain('status=published');
      expect(last?.url).not.toContain('cursor=');
    });
  });

  it('分页真追加：点「加载更多」后第一页旧行仍在（不被替换），与第二页累积同时呈现', async () => {
    mock = installFetchMock([
      {
        status: 200,
        json: pageBody([row({ capabilityId: 'cap-1', name: '能力 A' })], {
          hasMore: true,
          nextCursor: 'CUR2',
        }),
      },
      {
        status: 200,
        json: pageBody([row({ capabilityId: 'cap-2', name: '能力 B' })], { hasMore: false }),
      },
    ]);
    renderPage(<CapabilitiesPage />);

    await screen.findByText('能力 A');
    await userEvent.click(screen.getByRole('button', { name: '加载更多' }));

    // 关键断言（Codex P1）：第二页到达后，第一页的「能力 A」仍在 DOM（追加，不替换）。
    expect(await screen.findByText('能力 B')).toBeInTheDocument();
    expect(screen.getByText('能力 A')).toBeInTheDocument();
    // 两行同时在表内（累积态）。
    const table = screen.getByRole('table');
    expect(within(table).getByText('能力 A')).toBeInTheDocument();
    expect(within(table).getByText('能力 B')).toBeInTheDocument();
  });

  it('分页累积去重：后页重叠返回同一 capabilityId → 只保留一行（旧行口径不被覆盖）', async () => {
    mock = installFetchMock([
      {
        status: 200,
        json: pageBody([row({ capabilityId: 'cap-1', name: '能力 A' })], {
          hasMore: true,
          nextCursor: 'CUR2',
        }),
      },
      {
        status: 200,
        // 后端重叠返回了 cap-1（边界/并发新增导致游标重叠）+ 新行 cap-2。
        json: pageBody(
          [
            row({ capabilityId: 'cap-1', name: '能力 A 改名了' }),
            row({ capabilityId: 'cap-2', name: '能力 B' }),
          ],
          { hasMore: false },
        ),
      },
    ]);
    renderPage(<CapabilitiesPage />);

    await screen.findByText('能力 A');
    await userEvent.click(screen.getByRole('button', { name: '加载更多' }));
    await screen.findByText('能力 B');

    // cap-1 只出现一行（去重），保留首次出现口径「能力 A」；后页改名版不覆盖。
    expect(screen.getAllByText('能力 A')).toHaveLength(1);
    expect(screen.queryByText('能力 A 改名了')).not.toBeInTheDocument();
    expect(screen.getByText('能力 B')).toBeInTheDocument();
  });

  it('分页：hasMore → 显示「加载更多」，点击带 nextCursor 拉下一页', async () => {
    mock = installFetchMock([
      {
        status: 200,
        json: pageBody([row({ capabilityId: 'cap-1', name: '能力 A' })], {
          hasMore: true,
          nextCursor: 'CUR2',
        }),
      },
      {
        status: 200,
        json: pageBody([row({ capabilityId: 'cap-2', name: '能力 B' })], { hasMore: false }),
      },
    ]);
    renderPage(<CapabilitiesPage />);

    await screen.findByText('能力 A');
    const more = screen.getByRole('button', { name: '加载更多' });
    await userEvent.click(more);

    await waitFor(() => {
      const last = mock?.calls.at(-1);
      expect(last?.url).toContain('cursor=CUR2');
    });
    expect(await screen.findByText('能力 B')).toBeInTheDocument();
  });

  it('无更多页 → 不额外展示无信息量的尾注文案', async () => {
    mock = installFetchMock({ status: 200, json: pageBody([row()], { hasMore: false }) });
    renderPage(<CapabilitiesPage />);
    await screen.findByText('保险话术助手');
    expect(screen.queryByText('没有更多了')).toBeNull();
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();
  });

  it('加载中 → 骨架占位（永不裸转圈），不显错误/数据', () => {
    // 不消费的 promise：保持 pending，断言加载态。
    mock = installFetchMock({ status: 200, json: pageBody([row()]) });
    const { container } = renderPage(<CapabilitiesPage />);
    expect(container.querySelector('.cb-skeleton')).toBeInTheDocument();
  });

  it('后端失败 → ErrorState（只人话 + 重试，无错误码）', async () => {
    mock = installFetchMock([
      {
        status: 500,
        json: {
          error: {
            userMessage: '经营数据没能加载，请重试。',
            retriable: true,
            action: 'retry',
            traceId: 'tr-x',
          },
        },
      },
    ]);
    const { container } = renderPage(<CapabilitiesPage />);

    expect(await screen.findByText('经营数据没能加载，请重试。')).toBeInTheDocument();
    expect(
      within(screen.getByRole('alert')).getByRole('button', { name: '重试' }),
    ).toBeInTheDocument();
    // 绝不裸露错误码 / HTTP 状态。
    expect(container.innerHTML).not.toMatch(/\b500\b/);
  });
});
