// DraftStrip 测试（外壳首页-16/17/23/33/34）：
//   列未完成上传 + 步骤 + 进度短语 / 「去上传流程」回精确断点 / 多条不串台 / 空态不出空胶囊。
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
  it('空 drafts → 不渲染（不出空白胶囊）', () => {
    const { container } = render(<DraftStrip drafts={[]} onResume={() => {}} />);
    expect(container.querySelector('.cb-draft-strip')).toBeNull();
  });

  it('渲染草稿条 + 步骤标识 + 进度短语', () => {
    render(<DraftStrip drafts={[draft()]} onResume={() => {}} />);
    expect(screen.getByText('保险话术草稿')).toBeInTheDocument();
    expect(screen.getByText('STEP4')).toBeInTheDocument(); // structure = 第 4 步
    expect(screen.getByText('结构化中 60%')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '60');
  });

  it('点「去上传流程」→ onResume 带该草稿 + currentStep 对应路由', async () => {
    const onResume = vi.fn();
    render(<DraftStrip drafts={[draft()]} onResume={onResume} />);
    await userEvent.click(screen.getByRole('button', { name: /去上传流程/ }));
    expect(onResume).toHaveBeenCalledOnce();
    const [d, path] = onResume.mock.calls[0] ?? [];
    expect(d.id).toBe('draft-1');
    expect(path).toBe('/create/structure'); // structure 步路由
  });

  it('多条草稿各回各的断点（不串台）', async () => {
    const onResume = vi.fn();
    render(
      <DraftStrip
        drafts={[
          draft({ id: 'a', title: 'A 草稿', currentStep: 'import' }),
          draft({ id: 'b', title: 'B 草稿', currentStep: 'publish' }),
        ]}
        onResume={onResume}
      />,
    );
    const capsuleB = screen.getByText('B 草稿').closest('.cb-draft-capsule') as HTMLElement;
    await userEvent.click(within(capsuleB).getByRole('button', { name: /去上传流程/ }));
    const [d, path] = onResume.mock.calls[0] ?? [];
    expect(d.id).toBe('b');
    expect(path).toBe('/create/publish');
  });

  it('无标题草稿 → 兜底「未命名草稿」', () => {
    const noTitle = draft();
    delete noTitle.title;
    render(<DraftStrip drafts={[noTitle]} onResume={() => {}} />);
    expect(screen.getByText('未命名草稿')).toBeInTheDocument();
  });
});
