// F-10 STEP① 配对命令框组件测试：一行命令复制 + 逐行会话状态（waiting/uploading/expired）。
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PairResult, PairStatusView } from '@cb/shared';
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

  it('点「复制命令」触发 onCopy；copied=true 显「已复制」', async () => {
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
    expect(screen.getByRole('button', { name: '已复制' })).toBeInTheDocument();
  });

  it('waiting 态 → 「等待你在终端运行…」（永不裸转圈）', () => {
    render(
      <CommandBox
        pair={pair()}
        status={status('waiting')}
        onCopy={() => undefined}
        onRegenerate={() => undefined}
      />,
    );
    expect(screen.getByText(/等待你在终端运行/)).toBeInTheDocument();
  });

  it('uploading 态 → 数字+百分比+可访问进度条', () => {
    render(
      <CommandBox
        pair={pair()}
        status={status('uploading', { uploadedParts: 2, totalParts: 5 })}
        onCopy={() => undefined}
        onRegenerate={() => undefined}
      />,
    );
    expect(screen.getByText(/2 \/ 5 片（40%）/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '终端上传进度 2 / 5 片' })).toHaveAttribute(
      'value',
      '2',
    );
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
    expect(screen.getByText(/已经过期/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '重新生成命令' }));
    expect(onRegenerate).toHaveBeenCalledOnce();
  });

  it('刷新恢复态继续显示上传进度，不伪造旧配对命令', () => {
    render(
      <PairRecoveryBox
        status={status('uploading', { uploadedParts: 189, totalParts: 304 })}
        onRegenerate={() => undefined}
      />,
    );
    expect(screen.getByRole('heading', { name: '终端正在上传' })).toBeInTheDocument();
    expect(screen.getByText(/189 \/ 304 片（62%）/)).toBeInTheDocument();
    expect(screen.queryByText(/curl/)).not.toBeInTheDocument();
  });

  it('刷新后仍在 waiting 态 → 给重新生成命令的安全退路', async () => {
    const onRegenerate = vi.fn();
    const { rerender } = render(
      <PairRecoveryBox status={status('waiting')} onRegenerate={onRegenerate} />,
    );
    await userEvent.click(screen.getByRole('button', { name: '重新生成命令' }));
    expect(onRegenerate).toHaveBeenCalledOnce();

    rerender(
      <PairRecoveryBox status={status('waiting')} regenerating onRegenerate={onRegenerate} />,
    );
    expect(screen.getByRole('button', { name: '正在生成…' })).toBeDisabled();
  });
});
