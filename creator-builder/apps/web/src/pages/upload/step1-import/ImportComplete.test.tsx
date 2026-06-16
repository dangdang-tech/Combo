// F-10 STEP① 完成态组件测试：成功横幅 + 统计四格 + 原始会话列表（只读）。
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SnapshotView, SnapshotSegmentView } from '@cb/shared';
import { ImportComplete } from './ImportComplete.js';

function snapshot(over: Partial<SnapshotView> = {}): SnapshotView {
  return {
    id: 'snap1',
    ownerUserId: 'u1',
    source: 'mixed',
    sources: ['claude', 'codex'],
    stats: {
      segmentCount: 215,
      messageCount: 8420,
      timeSpan: { from: '2026.03', to: '2026.06' },
      projectCount: 14,
    },
    redaction: { applied: true, totalRedactions: 12, byCategory: [], rulesetVersion: 'v1' },
    createdAt: '2026-06-17T00:00:00Z',
    ...over,
  };
}

function seg(over: Partial<SnapshotSegmentView> = {}): SnapshotSegmentView {
  return {
    segmentId: 's1',
    dateLabel: '03-20',
    title: '保单条款梳理',
    messageCount: 42,
    readOnly: true,
    ...over,
  };
}

describe('ImportComplete', () => {
  it('成功横幅：来源口径「Claude + Codex」+ 隐私已抹除', () => {
    render(<ImportComplete snapshot={snapshot()} segments={[]} />);
    expect(screen.getByText(/已导入 Claude \+ Codex 的对话历史/)).toBeInTheDocument();
    expect(screen.getByText(/隐私信息已抹除/)).toBeInTheDocument();
  });

  it('统计四格：会话段 / 消息条数 / 时间跨度 / 涉及项目（真实值，非占位）', () => {
    render(<ImportComplete snapshot={snapshot()} segments={[]} />);
    expect(screen.getByText('会话段')).toBeInTheDocument();
    expect(screen.getByText('215')).toBeInTheDocument();
    expect(screen.getByText('8,420')).toBeInTheDocument(); // 千分位
    expect(screen.getByText('2026.03 – 2026.06')).toBeInTheDocument();
    expect(screen.getByText('14')).toBeInTheDocument();
  });

  it('时间跨度缺失 → 显「—」（不显 undefined）', () => {
    render(
      <ImportComplete
        snapshot={snapshot({
          stats: { segmentCount: 1, messageCount: 1, timeSpan: null, projectCount: 0 },
        })}
        segments={[]}
      />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('原始会话列表（只读）：去敏后标题 + 日期 + 条数', () => {
    render(
      <ImportComplete
        snapshot={snapshot()}
        segments={[seg(), seg({ segmentId: 's2', title: 'PRD 评审', project: 'agora' })]}
      />,
    );
    expect(screen.getByText('原始会话（只读）')).toBeInTheDocument();
    expect(screen.getByText('保单条款梳理')).toBeInTheDocument();
    expect(screen.getByText('PRD 评审')).toBeInTheDocument();
    expect(screen.getByText('agora')).toBeInTheDocument();
  });

  it('无会话节选 → 空态副文（不空白）', () => {
    render(<ImportComplete snapshot={snapshot()} segments={[]} />);
    expect(screen.getByText('这次没有可展示的会话节选。')).toBeInTheDocument();
  });
});
