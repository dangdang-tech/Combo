// 测试基建冒烟：确认 jsdom、RTL 与 jest-dom 匹配器就位。
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('test infra smoke', () => {
  it('renders into jsdom and jest-dom matchers work', () => {
    render(<button type="button">点我</button>);
    expect(screen.getByRole('button', { name: '点我' })).toBeInTheDocument();
  });
});
