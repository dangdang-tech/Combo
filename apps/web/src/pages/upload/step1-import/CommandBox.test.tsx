// F-10 STEP① 配对任务面板：命令复制 + 真实分片进度 + 三阶段反馈。
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PairResult, PairStatusView } from '@cb/shared';
import { ApiError } from '../../../api/index.js';
import { CommandBox, PairRecoveryBox, shellSafePairCommand } from './CommandBox.js';

function pair(over: Partial<PairResult> = {}): PairResult {
  return {
    pairId: 'p1',
    pairingCode: '123456',
    command: 'curl -fsSL https://x/import/connect/script?code=123456 | sh',
    curlOneLiner: 'curl -fsSL agora.app/import | sh',
    expiresAt: '2026-06-17T01:00:00Z',
    ...over,
  };
}

function status(
  phase: PairStatusView['phase'],
  over: Partial<PairStatusView> = {},
): PairStatusView {
  return { pairId: 'p1', phase, ...over };
}

describe('CommandBox', () => {
  it('展示 shell-safe 真命令（query URL 加引号）+ 「复制命令」按钮', () => {
    render(
      <CommandBox
        pair={pair()}
        status={undefined}
        onCopy={() => undefined}
        onRegenerate={() => undefined}
      />,
    );
    expect(
      screen.getByText("curl -fsSL 'https://x/import/connect/script?code=123456' | sh"),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制命令' })).toBeInTheDocument();
  });

  it('shellSafePairCommand 只处理未加引号的 query URL，避免 zsh nomatch', () => {
    expect(
      shellSafePairCommand(
        'curl -fsSL http://localhost/api/v1/import/connect/script?code=837201 | sh',
      ),
    ).toBe("curl -fsSL 'http://localhost/api/v1/import/connect/script?code=837201' | sh");
    expect(
      shellSafePairCommand(
        "curl -fsSL 'http://localhost/api/v1/import/connect/script?code=837201' | sh",
      ),
    ).toBe("curl -fsSL 'http://localhost/api/v1/import/connect/script?code=837201' | sh");
    expect(shellSafePairCommand('curl -fsSL http://localhost/health | sh')).toBe(
      'curl -fsSL http://localhost/health | sh',
    );
  });

  it('点「复制命令」触发 onCopy；copied=true 显短反馈', async () => {
    const onCopy = vi.fn();
    const { rerender } = render(
      <CommandBox
        pair={pair()}
        status={undefined}
        onCopy={onCopy}
        onRegenerate={() => undefined}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '复制命令' }));
    expect(onCopy).toHaveBeenCalledOnce();
    rerender(
      <CommandBox
        pair={pair()}
        status={undefined}
        onCopy={onCopy}
        copied
        onRegenerate={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: '已复制 ✓' })).toBeInTheDocument();
  });

  it('waiting 态 → 命令仍是主操作，阶段轨道指出当前步骤', () => {
    render(
      <CommandBox
        pair={pair()}
        status={status('waiting')}
        onCopy={() => undefined}
        onRegenerate={() => undefined}
      />,
    );
    expect(screen.getByRole('heading', { name: '复制命令，连接你的本机会话' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: '导入阶段' })).toBeInTheDocument();
    expect(screen.getByLabelText('当前步骤：运行本机命令')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByLabelText('待进行：上传原始记录')).toBeInTheDocument();
  });

  it('uploading 态 → 进度成为主内容，显示百分比、剩余分片和下一步', () => {
    render(
      <CommandBox
        pair={pair()}
        status={status('uploading', { uploadedParts: 2, totalParts: 5 })}
        onCopy={() => undefined}
        onRegenerate={() => undefined}
      />,
    );
    expect(screen.getByRole('heading', { name: '会话上传进行中' })).toBeInTheDocument();
    expect(screen.getAllByText('云端已接收')).toHaveLength(2);
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText('2 / 5')).toBeInTheDocument();
    expect(screen.getByText('还剩 3 个分片')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '终端上传进度' })).toHaveAttribute(
      'aria-valuetext',
      '已接收 2 / 5 个分片，40%',
    );
    expect(screen.getByLabelText('已完成：运行本机命令')).toBeInTheDocument();
    expect(screen.getByLabelText('当前步骤：上传原始记录')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('完成后自动进入云端处理')).toBeInTheDocument();
    expect(screen.getByText('查看已运行的终端命令').closest('details')).not.toHaveAttribute('open');
  });

  it('uploading 未知总量时仍展示真实已接收量，不伪造百分比或 ETA', () => {
    render(
      <CommandBox
        pair={pair()}
        status={status('uploading', { uploadedParts: 17 })}
        onCopy={() => undefined}
        onRegenerate={() => undefined}
      />,
    );
    expect(screen.getByText('传输中')).toBeInTheDocument();
    expect(screen.getByText('17')).toBeInTheDocument();
    expect(screen.getByText('已接收 17 个分片，仍在上传')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText(/分钟|预计|MB\/s/)).not.toBeInTheDocument();
  });

  it('job_created 态 → 上传完成，云端解析成为当前步骤', () => {
    render(
      <CommandBox
        pair={pair()}
        status={status('job_created')}
        onCopy={() => undefined}
        onRegenerate={() => undefined}
      />,
    );
    expect(
      screen.getByRole('heading', { name: '记录已上传，正在接入云端处理' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('已完成：上传原始记录')).toBeInTheDocument();
    expect(screen.getByLabelText('当前步骤：云端解析并去敏')).toHaveAttribute(
      'aria-current',
      'step',
    );
    expect(screen.queryByText(/curl/)).not.toBeInTheDocument();
  });

  it('网页轮询重连时不伪装终端在线，保留最后真实进度', () => {
    const error = new ApiError({
      error: {
        userMessage: '暂时无法取得最新状态。',
        retriable: true,
        action: 'retry',
        traceId: 'trace-1',
      },
    });
    render(
      <CommandBox
        pair={pair()}
        status={status('uploading', { uploadedParts: 2, totalParts: 5 })}
        reconnecting
        error={error}
        onCopy={() => undefined}
        onRegenerate={() => undefined}
      />,
    );
    expect(screen.getAllByText('状态重连中')).toHaveLength(2);
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.queryByText('实时接收')).not.toBeInTheDocument();
  });

  it('expired 态 → 「已经过期」+ 「重新生成命令」引导（态非错误）', async () => {
    const onRegenerate = vi.fn();
    render(
      <CommandBox
        pair={pair()}
        status={status('expired')}
        onCopy={() => undefined}
        onRegenerate={onRegenerate}
      />,
    );
    expect(screen.getByRole('heading', { name: '这次连接已过期' })).toBeInTheDocument();
    expect(screen.getByLabelText('需要处理：运行本机命令')).toBeInTheDocument();
    expect(screen.queryByText(/curl/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '重新生成命令' }));
    expect(onRegenerate).toHaveBeenCalledOnce();
  });

  it('部分分片上传后过期 → 保留已完成连接，标记上传需要处理', () => {
    render(
      <CommandBox
        pair={pair()}
        status={status('expired', { uploadedParts: 3, totalParts: 5 })}
        onCopy={() => undefined}
        onRegenerate={() => undefined}
      />,
    );
    expect(screen.getByLabelText('已完成：运行本机命令')).toBeInTheDocument();
    expect(screen.getByLabelText('需要处理：上传原始记录')).toBeInTheDocument();
    expect(screen.getByText(/云端已收到 3 \/ 5 个分片/)).toBeInTheDocument();
  });

  it('异常分片数超过总量时，展示值与进度条统一封顶', () => {
    render(
      <CommandBox
        pair={pair()}
        status={status('uploading', { uploadedParts: 306, totalParts: 304 })}
        onCopy={() => undefined}
        onRegenerate={() => undefined}
      />,
    );
    expect(screen.getByText('304 / 304')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '终端上传进度' })).toHaveAttribute(
      'aria-valuetext',
      '已接收 304 / 304 个分片，100%',
    );
  });

  it('刷新恢复态继续显示上传进度，不伪造旧配对命令', () => {
    render(
      <PairRecoveryBox
        status={status('uploading', { uploadedParts: 189, totalParts: 304 })}
        onRegenerate={() => undefined}
      />,
    );
    expect(screen.getByRole('heading', { name: '会话上传进行中' })).toBeInTheDocument();
    expect(screen.getByText('62%')).toBeInTheDocument();
    expect(screen.getByText('189 / 304')).toBeInTheDocument();
    expect(screen.getByText('还剩 115 个分片')).toBeInTheDocument();
    expect(screen.queryByText(/curl/)).not.toBeInTheDocument();
  });

  it('刷新后仍在 waiting 态 → 给重新生成命令的安全退路', async () => {
    const onRegenerate = vi.fn();
    const { rerender } = render(
      <PairRecoveryBox status={status('waiting')} onRegenerate={onRegenerate} />,
    );
    expect(screen.getByRole('heading', { name: '需要重新生成连接命令' })).toBeInTheDocument();
    expect(screen.queryByText(/curl/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '重新生成命令' }));
    expect(onRegenerate).toHaveBeenCalledOnce();

    rerender(
      <PairRecoveryBox status={status('waiting')} regenerating onRegenerate={onRegenerate} />,
    );
    expect(screen.getByRole('button', { name: '正在生成…' })).toBeDisabled();
  });
});
