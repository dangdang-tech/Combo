// CapabilityTable 测试：
//   状态单源 / analytics 占位 / Agent 身份 / 管理页真实动作 / 拒绝原因。
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import type { DashboardCapabilityRow } from '@cb/shared';

// jsdom 无 canvas：MiniSparkline 在有数据时会渲染 echarts；这里行的 spendSparkline=null（占位），
// 不会触达 echarts，但仍 mock 以防回归。
vi.mock('echarts-for-react/lib/core', () => ({
  default: () => <div data-testid="echarts-core" />,
}));

import { CapabilityTable } from './CapabilityTable.js';

function renderTable(ui: ReactElement): ReturnType<typeof render> {
  return render(ui, { wrapper: MemoryRouter });
}

function row(over: Partial<DashboardCapabilityRow> = {}): DashboardCapabilityRow {
  return {
    capabilityId: 'cap-1',
    versionId: 'ver-1',
    slug: 'my-cap',
    name: '保险方案速算',
    tagline: '一句话算清两全险现金价值',
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
    publishedAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-10T00:00:00Z',
    ...over,
  };
}

describe('CapabilityTable 列与单源状态', () => {
  it('渲染名称 + 简介；状态徽章用后端 statusLabel（单源派生 tone）', () => {
    const { container } = renderTable(<CapabilityTable rows={[row()]} meta={undefined} />);
    expect(screen.getByText('保险方案速算')).toBeInTheDocument();
    expect(screen.getByText('一句话算清两全险现金价值')).toBeInTheDocument();
    const badge = container.querySelector('.cb-cap-status') as HTMLElement;
    expect(badge.textContent).toBe('已上架');
    expect(badge.getAttribute('data-status')).toBe('published');
    expect(badge.getAttribute('data-tone')).toBe('ok');
  });

  it('被拒态：statusLabel 已退回 + 拒绝原因仍清楚可见', () => {
    renderTable(
      <CapabilityTable
        rows={[
          row({
            reviewStatus: 'review_rejected',
            statusLabel: '已退回',
            rejectReason: '示例字段过少',
            retryEditable: true,
          }),
        ]}
        meta={undefined}
      />,
    );
    expect(screen.getByText('已退回')).toBeInTheDocument();
    expect(screen.getByText('示例字段过少')).toBeInTheDocument();
  });

  it('usage 列（本月调用 / 收益 / 消耗迷你图）走占位，绝不显 0、不画图', () => {
    const meta = {
      placeholders: {
        monthlyInvocations: '暂无数据 / 上线后填充',
        revenueMicros: '暂无数据 / 上线后填充',
        spendSparkline: '暂无数据 / 上线后填充',
      },
    };
    const { container } = renderTable(<CapabilityTable rows={[row()]} meta={meta} />);
    // 至少两个 usage 占位（本月调用 + 收益），且不画真图
    expect(container.querySelectorAll('.cb-usage-placeholder').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId('echarts-core')).toBeNull();
    const invCell = container.querySelector('.cb-cap-row__invocations') as HTMLElement;
    expect(within(invCell).queryByText('0')).not.toBeInTheDocument();
  });
});

describe('CapabilityTable 操作入口', () => {
  it('不展示尚未兑现的「试用」入口', () => {
    renderTable(<CapabilityTable rows={[row()]} meta={undefined} />);
    expect(screen.queryByRole('button', { name: '试用' })).not.toBeInTheDocument();
  });

  it('当前公开页可达：直接展示语义化链接，不再经过“更多”弹窗', () => {
    renderTable(<CapabilityTable rows={[row()]} meta={undefined} />);
    expect(screen.getByRole('link', { name: /打开.*公开页/ })).toHaveAttribute('href', '/a/my-cap');
    expect(screen.queryByRole('button', { name: '更多操作' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('当前公开页不可达：操作列不显示破折号或死入口', () => {
    const { container } = renderTable(
      <CapabilityTable
        rows={[
          row({
            reviewStatus: 'draft',
            statusLabel: '草稿',
            publishedAt: null,
            publicPageAvailable: false,
          }),
        ]}
        meta={undefined}
      />,
    );
    const actionCell = container.querySelector('.cb-cap-row__actions') as HTMLElement;
    expect(within(actionCell).queryByRole('button')).toBeNull();
    expect(within(actionCell).queryByRole('link')).toBeNull();
    expect(actionCell).not.toHaveTextContent('—');
    expect(actionCell).toHaveAttribute('aria-label', '暂无可用操作');
    expect(actionCell).toBeEmptyDOMElement();
    expect(screen.queryByRole('link', { name: /公开页/ })).toBeNull();
  });

  it('管理页：稳定 Agent 标识 + 草稿可编辑 UI，旧名称可自动整理', async () => {
    const openStudio = vi.fn();
    const regenerateName = vi.fn();
    const draft = row({
      reviewStatus: 'draft',
      statusLabel: '草稿',
      publishedAt: null,
      publicPageAvailable: false,
      studioAvailable: true,
      nameNeedsReview: true,
      name: '<recommended_plugins>',
    });
    const { container, rerender } = renderTable(
      <CapabilityTable
        rows={[draft]}
        meta={undefined}
        mode="manage"
        onOpenStudio={openStudio}
        onRegenerateName={regenerateName}
      />,
    );

    const mark = container.querySelector('.cb-agent-mark') as HTMLElement;
    const variant = mark.getAttribute('data-variant');
    expect(mark).toHaveTextContent('RP');
    expect(variant).toMatch(/^[1-8]$/);
    expect(screen.getByText('名称可优化')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /编辑.*UI 版本/ }));
    expect(openStudio).toHaveBeenCalledWith(draft);
    await userEvent.click(screen.getByRole('button', { name: /自动整理.*名称/ }));
    expect(regenerateName).toHaveBeenCalledWith(draft);

    rerender(
      <CapabilityTable
        rows={[draft]}
        meta={undefined}
        mode="manage"
        onOpenStudio={openStudio}
        onRegenerateName={regenerateName}
      />,
    );
    expect(container.querySelector('.cb-agent-mark')).toHaveAttribute('data-variant', variant);
  });

  it('管理页：未完成结构化时提供真实的 UI 生成入口', async () => {
    const openStudio = vi.fn();
    const draft = row({
      reviewStatus: 'draft',
      statusLabel: '草稿',
      publicPageAvailable: false,
      publishedAt: null,
      studioAvailable: false,
    });
    renderTable(
      <CapabilityTable rows={[draft]} meta={undefined} mode="manage" onOpenStudio={openStudio} />,
    );
    expect(screen.queryByRole('button', { name: /编辑.*UI 版本/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /生成.*UI 版本/ }));
    expect(openStudio).toHaveBeenCalledWith(draft);
  });

  it('管理页：被退回版本提供“修复 UI”入口', async () => {
    const openStudio = vi.fn();
    const rejected = row({
      reviewStatus: 'review_rejected',
      statusLabel: '已退回',
      retryEditable: true,
      retryVersionId: 'rejected-version',
    });
    renderTable(
      <CapabilityTable
        rows={[rejected]}
        meta={undefined}
        mode="manage"
        onOpenStudio={openStudio}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /修复.*UI 版本/ }));
    expect(openStudio).toHaveBeenCalledWith(rejected);
  });

  it('管理页：无上一公开版的已下架 Agent 也能修复 UI', async () => {
    const openStudio = vi.fn();
    const unpublished = row({
      reviewStatus: 'unpublished',
      statusLabel: '已下架',
      retryEditable: true,
      retryVersionId: 'rejected-version',
      publicPageAvailable: false,
    });
    renderTable(
      <CapabilityTable
        rows={[unpublished]}
        meta={undefined}
        mode="manage"
        onOpenStudio={openStudio}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /修复.*UI 版本/ }));
    expect(openStudio).toHaveBeenCalledWith(unpublished);
  });

  it('管理页：已发布且没有草稿时明确提供“新建 UI 版本”入口', async () => {
    const openStudio = vi.fn();
    const published = row({ studioDraftable: true });
    renderTable(
      <CapabilityTable
        rows={[published]}
        meta={undefined}
        mode="manage"
        onOpenStudio={openStudio}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /新建.*UI 版本/ }));
    expect(openStudio).toHaveBeenCalledWith(published);
  });

  it('管理页：任一创作动作执行时禁用所有行的冲突动作', () => {
    renderTable(
      <CapabilityTable
        rows={[
          row({ capabilityId: 'cap-1', studioAvailable: true, publicPageAvailable: false }),
          row({ capabilityId: 'cap-2', studioAvailable: true, publicPageAvailable: false }),
        ]}
        meta={undefined}
        mode="manage"
        onOpenStudio={vi.fn()}
        actionsBusy
      />,
    );
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
    for (const button of screen.getAllByRole('button', { name: /编辑.*UI 版本/ })) {
      expect(button).toBeDisabled();
    }
  });

  it('空 rows → 友好空态，不裸空表', () => {
    renderTable(<CapabilityTable rows={[]} meta={undefined} />);
    expect(screen.getByText(/还没有 Agent/)).toBeInTheDocument();
  });
});
