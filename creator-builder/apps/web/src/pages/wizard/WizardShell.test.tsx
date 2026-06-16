// WizardShell 集成单测（F-09 / F-15）：
//   步骤条随路由步态变 / 顶栏「保存草稿」/ 底栏摘要随步变 / 续传 ?draftId= 恢复 selection /
//   已完成步可点回看 / 外壳头条+步骤条+底栏五步常驻（D14：换步不改本壳结构）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import type { DraftView } from '@cb/shared';
import { WizardLayout } from './WizardLayout.js';
import { SelectStep } from './SelectStep.js';
import { useWizard } from './WizardContext.js';
import { installFetchMock, type FetchMock } from '../../test/mockFetch.js';

function draftView(over: Partial<DraftView> = {}): DraftView {
  return {
    id: 'd1',
    status: 'active',
    currentStep: 'select',
    stepProgress: { percent: 30, phrase: '选择中' },
    selection: { mode: 'single', candidateId: 'c1' },
    createdAt: '2026-06-10T00:00:00Z',
    updatedAt: '2026-06-11T00:00:00Z',
    ...over,
  };
}

/** 暴露当前路由 + wizard 选择态，供断言续传恢复。 */
function StepProbe() {
  const loc = useLocation();
  const { selection, currentStep } = useWizard();
  return (
    <div>
      <span data-testid="path">{loc.pathname}</span>
      <span data-testid="step">{currentStep}</span>
      <span data-testid="selection">{selection ? selection.mode : 'none'}</span>
    </div>
  );
}

function renderWizard(initialPath: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/creator" element={<div>工作台首页</div>} />
          <Route path="/create" element={<WizardLayout />}>
            <Route index element={<Navigate to="/create/import" replace />} />
            <Route path="import" element={<StepProbe />} />
            <Route path="extract" element={<StepProbe />} />
            <Route
              path="select"
              element={
                <>
                  <StepProbe />
                  <SelectStep candidates={[]} />
                </>
              }
            />
            <Route path="structure" element={<StepProbe />} />
            <Route path="publish" element={<StepProbe />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

let mock: FetchMock;
beforeEach(() => {
  // 默认：drafts 列表空（避免续传 effect 真打）；按需在用例内覆盖。
  mock = installFetchMock({
    status: 200,
    json: {
      data: [],
      meta: { page: { hasMore: false, nextCursor: null, limit: 20, order: 'desc' } },
    },
  });
});
afterEach(() => mock.restore());

describe('WizardShell（F-09 向导壳）', () => {
  it('渲染头条「上传能力」+「保存草稿」+ 步骤条五段 + 底栏', () => {
    renderWizard('/create/import');
    expect(screen.getByRole('heading', { name: '上传能力' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeInTheDocument();
    // 步骤条五段。
    const bar = screen.getByRole('list', { name: '上传五步进度' });
    expect(within(bar).getAllByRole('listitem')).toHaveLength(5);
    // 底栏摘要。
    expect(screen.getByText('第 1 步，共 5 步')).toBeInTheDocument();
  });

  it('步骤条随当前步：import 进行时第1段 current、其余 todo', () => {
    renderWizard('/create/import');
    const bar = screen.getByRole('list', { name: '上传五步进度' });
    expect(bar.querySelector('[data-step="import"]')).toHaveAttribute('aria-current', 'step');
    expect(bar.querySelector('[data-step="select"]')?.getAttribute('data-status')).toBe('todo');
  });

  it('select 步：前两步 done（可回看）、第3段 current；底栏摘要「第 3 步」', () => {
    renderWizard('/create/select');
    expect(screen.getByTestId('step')).toHaveTextContent('select');
    const bar = screen.getByRole('list', { name: '上传五步进度' });
    expect(bar.querySelector('[data-step="import"]')?.getAttribute('data-status')).toBe('done');
    expect(bar.querySelector('[data-step="extract"]')?.getAttribute('data-status')).toBe('done');
    expect(bar.querySelector('[data-step="select"]')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('第 3 步，共 5 步')).toBeInTheDocument();
  });

  it('点已完成步 → 路由跳该步回看（贯穿-16），保留 ?draftId', async () => {
    renderWizard('/create/structure?draftId=d1');
    // structure 步：import done 可点。
    const importBtn = screen.getByRole('button', { name: /第 1 步.*点击回看/ });
    await userEvent.click(importBtn);
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/create/import'));
  });

  it('「保存草稿」非 select 步 + 有 draftId（草稿已落库）→ 退出回工作台（§5.0 每步可存草稿退出）', async () => {
    // import 步带 ?draftId=：后端建产物时已落 drafts 行，保存草稿 = 诚实退出（无独立写端点，§1.1(b)）。
    //   续传 hook 经单条 GET /drafts/d1 拉回草稿（返回单个 DraftView，非列表）。
    mock.restore();
    mock = installFetchMock({
      status: 200,
      json: { data: draftView({ id: 'd1', currentStep: 'import' }) },
    });
    renderWizard('/create/import?draftId=d1');
    await userEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(screen.getByText('工作台首页')).toBeInTheDocument());
  });

  it('「保存草稿」非 select 步 + 无 draftId（尚无已落库草稿）→ 不谎报成功：留在原步 + 人话退路（Codex P0-1）', async () => {
    // import 步无 draftId：没有任何已落库草稿可存，绝不空退出，落「先完成当前步骤」人话退路。
    renderWizard('/create/import');
    await userEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(screen.getByText(/还没生成可保存的内容/)).toBeInTheDocument());
    // 仍在 import 步，未跳工作台（不假成功离开）。
    expect(screen.getByTestId('path')).toHaveTextContent('/create/import');
    expect(screen.queryByText('工作台首页')).not.toBeInTheDocument();
  });

  it('F-15 续传：?draftId= → 拉草稿恢复 selection（落点步态对得上，贯穿-15）', async () => {
    // 续传 hook 经单条 GET /drafts/d1 拉回草稿（返回单个 DraftView）。
    mock.restore();
    mock = installFetchMock({
      status: 200,
      json: {
        data: draftView({ id: 'd1', selection: { mode: 'all', candidateIds: ['c1', 'c2'] } }),
      },
    });
    renderWizard('/create/select?draftId=d1');
    // 续传恢复后 selection = all（来自 draft.selection）。
    await waitFor(() => expect(screen.getByTestId('selection')).toHaveTextContent('all'));
    // 落点步 = select（URL 决定，与草稿 currentStep 对齐）。
    expect(screen.getByTestId('step')).toHaveTextContent('select');
  });

  it('外壳头条/步骤条/底栏五步常驻（D14：换步不改本壳结构）', async () => {
    renderWizard('/create/select');
    // select 步具备三件套。
    expect(screen.getByRole('heading', { name: '上传能力' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: '上传五步进度' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeInTheDocument();
    // 跳到 import 步（点回看），三件套仍在、结构不变。
    await userEvent.click(screen.getByRole('button', { name: /第 1 步.*点击回看/ }));
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/create/import'));
    expect(screen.getByRole('heading', { name: '上传能力' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: '上传五步进度' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeInTheDocument();
  });
});
