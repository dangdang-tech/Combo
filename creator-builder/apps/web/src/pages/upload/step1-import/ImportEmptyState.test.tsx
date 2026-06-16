// F-10 STEP① 空态引导组件测试：两种导入方式 + 开始导入触发 + 底部说明常驻。
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportEmptyState } from './ImportEmptyState.js';

describe('ImportEmptyState', () => {
  it('渲染两种导入方式：本机直读（推荐·最全）+ 命令框预览', () => {
    render(<ImportEmptyState onStart={() => undefined} />);
    expect(screen.getByText('连接本机直读')).toBeInTheDocument();
    expect(screen.getByText('推荐 · 最全')).toBeInTheDocument();
    // CURL 命令框预览（验收口径串 curl -fsSL agora.app/import | sh）。
    expect(screen.getByText('curl -fsSL agora.app/import | sh')).toBeInTheDocument();
  });

  it('「开始导入 →」点击触发 onStart', async () => {
    const onStart = vi.fn();
    render(<ImportEmptyState onStart={onStart} />);
    await userEvent.click(screen.getByRole('button', { name: '开始导入 →' }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it('starting=true → 按钮禁用 + 显「准备中…」（防重复点，永不裸转圈）', () => {
    render(<ImportEmptyState onStart={() => undefined} starting />);
    const btn = screen.getByRole('button', { name: '准备中…' });
    expect(btn).toBeDisabled();
  });

  it('底部导入说明常驻（隐私口径：去敏 / 原文不落正式盘 / 可关页）', () => {
    render(<ImportEmptyState onStart={() => undefined} />);
    expect(screen.getByText('关于导入')).toBeInTheDocument();
    expect(screen.getByText(/隐私.*自动抹除/)).toBeInTheDocument();
    expect(screen.getByText(/原始对话不会落到正式存储/)).toBeInTheDocument();
  });
});
