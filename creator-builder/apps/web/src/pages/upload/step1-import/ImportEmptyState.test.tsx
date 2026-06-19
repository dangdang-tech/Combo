// F-10 STEP① 空态引导组件测试（BUG-013）：主路径浏览器导入 + 折叠的高级入口 + 底部说明常驻。
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportEmptyState } from './ImportEmptyState.js';

const noop = (): void => undefined;

describe('ImportEmptyState', () => {
  it('大标题逐字对齐 PRD §5.1.1 / 验收 导入-01（把对话历史，变成可发布的能力）', () => {
    render(<ImportEmptyState onFiles={noop} onStart={noop} />);
    expect(screen.getByText('把对话历史，变成可发布的能力')).toBeInTheDocument();
  });

  it('主路径是「从浏览器导入」主卡，标推荐 + 选文件/选文件夹入口（BUG-013）', () => {
    render(<ImportEmptyState onFiles={noop} onStart={noop} />);
    expect(screen.getByText('从浏览器导入')).toBeInTheDocument();
    expect(screen.getByText('推荐 · 最省事')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择文件' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择文件夹' })).toBeInTheDocument();
  });

  it('高级入口默认折叠；展开后露出本机直读 + CURL（导入-02/03 兜底，保留不删）', async () => {
    render(<ImportEmptyState onFiles={noop} onStart={noop} />);
    // 默认折叠：本机直读 / CURL 文案不在文档里。
    expect(screen.queryByText('一键导入（本机直读）')).not.toBeInTheDocument();
    expect(screen.queryByText('CURL 命令导入')).not.toBeInTheDocument();
    // 展开。
    await userEvent.click(
      screen.getByRole('button', { name: '试试其它导入方式（命令行 / CURL）' }),
    );
    expect(screen.getByText('一键导入（本机直读）')).toBeInTheDocument();
    expect(
      screen.getByText(
        '直接扫描这台机器上全部 ~/.claude、~/.codex —— 全自动，无需选文件夹，不会漏。',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('CURL 命令导入')).toBeInTheDocument();
    expect(screen.getByText('curl -fsSL agora.app/import | sh')).toBeInTheDocument();
  });

  it('高级入口「开始导入 →」点击触发 onStart（铸码高级路径）', async () => {
    const onStart = vi.fn();
    render(<ImportEmptyState onFiles={noop} onStart={onStart} />);
    await userEvent.click(
      screen.getByRole('button', { name: '试试其它导入方式（命令行 / CURL）' }),
    );
    await userEvent.click(screen.getByRole('button', { name: '开始导入 →' }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it('starting=true（展开后）→ 开始导入按钮禁用 + 显「准备中…」（防重复点）', async () => {
    render(<ImportEmptyState onFiles={noop} onStart={noop} starting />);
    await userEvent.click(
      screen.getByRole('button', { name: '试试其它导入方式（命令行 / CURL）' }),
    );
    expect(screen.getByRole('button', { name: '准备中…' })).toBeDisabled();
  });

  it('uploading=true → 浏览器导入入口禁用（编排在途，防重复触发）', () => {
    render(<ImportEmptyState onFiles={noop} onStart={noop} uploading />);
    expect(screen.getByRole('button', { name: '选择文件' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '选择文件夹' })).toBeDisabled();
  });

  it('底部导入说明常驻，逐字对齐 PRD §5.1.1 / 验收 导入-04（完整上传到云端、云端解析去敏）', () => {
    render(<ImportEmptyState onFiles={noop} onStart={noop} />);
    expect(screen.getByText('导入说明')).toBeInTheDocument();
    expect(
      screen.getByText(
        '导入会把你选择的对话历史完整上传到云端，由云端解析、去敏后再用于后续步骤。',
      ),
    ).toBeInTheDocument();
  });

  it('负向（导入-05/29）：不出现「数据不出本机 / 只上传精简 / 本机解析」这类承诺（含展开高级入口后）', async () => {
    const { container } = render(<ImportEmptyState onFiles={noop} onStart={noop} />);
    await userEvent.click(
      screen.getByRole('button', { name: '试试其它导入方式（命令行 / CURL）' }),
    );
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/数据不出本机/);
    expect(text).not.toMatch(/原文不留底/);
    expect(text).not.toMatch(/只上传提取后/);
    expect(text).not.toMatch(/仅上传精简/);
    expect(text).not.toMatch(/解析在你浏览器本地完成/);
  });
});
