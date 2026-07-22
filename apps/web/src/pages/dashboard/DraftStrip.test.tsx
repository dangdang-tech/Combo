// 工作台创作恢复入口测试：
//   最近一次创作是唯一主入口，其余创作收起，每条仍精确回到真实断点。
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DraftView } from '@cb/shared';
import { DraftStrip } from './DraftStrip.js';

function draft(over: Partial<DraftView> = {}): DraftView {
  return {
    id: 'draft-1',
    status: 'active',
    currentStep: 'structure',
    stepProgress: { percent: 60, phrase: '结构化中 60%' },
    title: '保险话术草稿',
    createdAt: '2026-06-10T00:00:00Z',
    updatedAt: '2026-06-11T00:00:00Z',
    ...over,
  };
}

describe('DraftStrip', () => {
  it('空 drafts → 不渲染（不出空白卡）', () => {
    const { container } = render(<DraftStrip drafts={[]} onResume={() => {}} />);
    expect(container.querySelector('.cb-resume-card')).toBeNull();
  });

  it('只强调最近一次创作，并展示名称、阶段、进度与更新时间', () => {
    render(<DraftStrip drafts={[draft()]} onResume={() => {}} />);
    expect(screen.getByRole('region', { name: '继续上次创作' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '继续上次创作' })).toBeInTheDocument();
    expect(screen.getByText('保险话术草稿')).toBeInTheDocument();
    expect(screen.getByText('正在完善 Agent · 结构化中 60%')).toBeInTheDocument();
    expect(screen.getByText(/^更新于 /)).toBeInTheDocument();
  });

  it('点主 CTA → onResume 带最近草稿 + currentStep 对应路由', async () => {
    const onResume = vi.fn();
    render(<DraftStrip drafts={[draft()]} onResume={onResume} />);
    await userEvent.click(screen.getByRole('button', { name: '继续完善：保险话术草稿' }));
    expect(onResume).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'draft-1' }),
      '/create/capabilities',
    );
  });

  it.each([
    ['import', '正在导入会话', '继续导入', '/create/import'],
    ['extract', '正在分析工作历史', '查看分析进度', '/create/capabilities'],
    ['select', 'Agent 已准备好', '查看 Agent', '/create/capabilities'],
    ['structure', '正在完善 Agent', '继续完善', '/create/capabilities'],
    ['publish', '等待发布', '继续发布', '/create/capabilities'],
  ] as const)(
    '%s 阶段 → 展示「%s」并提供「%s」恢复动作',
    async (currentStep, stage, action, expectedPath) => {
      const onResume = vi.fn();
      render(
        <DraftStrip
          drafts={[
            draft({
              currentStep,
              stepProgress: { percent: 42, phrase: '已完成 42%' },
            }),
          ]}
          onResume={onResume}
        />,
      );

      expect(screen.getByText(`${stage} · 已完成 42%`)).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: `${action}：保险话术草稿` }));
      expect(onResume).toHaveBeenCalledWith(expect.objectContaining({ currentStep }), expectedPath);
    },
  );

  it('多条时按 updatedAt 选最近一条，其余收起但仍可回到各自断点', async () => {
    const onResume = vi.fn();
    render(
      <DraftStrip
        drafts={[
          draft({
            id: 'a',
            title: 'A Agent',
            currentStep: 'import',
            updatedAt: '2026-06-11T00:00:00Z',
          }),
          draft({
            id: 'b',
            title: 'B Agent',
            currentStep: 'publish',
            updatedAt: '2026-06-12T00:00:00Z',
          }),
        ]}
        onResume={onResume}
      />,
    );

    expect(screen.getByText('B Agent')).toBeInTheDocument();
    expect(screen.getByText('共 2 个')).toBeInTheDocument();
    await userEvent.click(screen.getByText('查看其余 1 个'));
    await userEvent.click(screen.getByRole('button', { name: /继续导入：A Agent/ }));
    expect(onResume).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), '/create/import');
  });

  it('无标题草稿用「未命名 Agent」，不把时间伪装成项目名', () => {
    const noTitle = draft();
    delete noTitle.title;
    render(<DraftStrip drafts={[noTitle]} onResume={() => {}} />);
    expect(screen.getByText('未命名 Agent')).toBeInTheDocument();
    expect(screen.queryByText(/Agent 创作 ·/)).not.toBeInTheDocument();
  });

  it('提取终态自动变成可查看的识别结果，不再假装仍在分析', async () => {
    const onResume = vi.fn();
    render(
      <DraftStrip
        drafts={[
          draft({
            currentStep: 'extract',
            stepProgress: { percent: 100, phrase: '已准备好 5 个 Agent' },
          }),
        ]}
        onResume={onResume}
      />,
    );

    expect(screen.getByText('识别已完成 · 已准备好 5 个 Agent')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看识别结果：保险话术草稿' }));
    expect(onResume).toHaveBeenCalledWith(
      expect.objectContaining({ currentStep: 'extract' }),
      '/create/capabilities',
    );
  });

  it('后端尚无进度短语时只展示阶段名称，不出现空分隔符', () => {
    render(
      <DraftStrip
        drafts={[draft({ currentStep: 'extract', stepProgress: { percent: 0, phrase: '  ' } })]}
        onResume={() => {}}
      />,
    );
    expect(screen.getByText('正在分析工作历史')).toBeInTheDocument();
    expect(screen.queryByText(/正在分析工作历史 ·\s*$/)).toBeNull();
  });

  it('发布终态已持久化 → 不再出现在恢复入口', () => {
    const { container } = render(
      <DraftStrip
        drafts={[
          draft({
            currentStep: 'publish',
            stepProgress: { percent: 100, phrase: '发布完成' },
          }),
        ]}
        onResume={() => {}}
      />,
    );

    expect(container.querySelector('.cb-resume-card')).toBeNull();
  });
});
