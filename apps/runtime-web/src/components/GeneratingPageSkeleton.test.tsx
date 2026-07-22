import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GeneratingPageSkeleton } from './GeneratingPageSkeleton.js';

describe('GeneratingPageSkeleton', () => {
  it('shows one honest state without decorative workflow claims', () => {
    render(<GeneratingPageSkeleton startedAt={Date.now()} />);

    expect(screen.getByRole('status')).toHaveTextContent('正在生成页面');
    expect(screen.queryByText(/读取能力定义|生成第一版产物|整理产物结构/)).not.toBeInTheDocument();
  });
});
