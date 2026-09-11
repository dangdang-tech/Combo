import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PublicLayout } from './PublicLayout.js';

function renderAt(pathname: string): void {
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="*" element={<p>公开页面</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('PublicLayout', () => {
  it('公开页面只保留返回首页的品牌入口', () => {
    renderAt('/');

    expect(screen.getByRole('link', { name: 'Combo 首页' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', { name: '登录' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: '公开导航' })).toBeNull();
    expect(screen.queryByRole('link', { name: '开始创建' })).toBeNull();
  });

  it('登录页同样不增加全局登录入口', () => {
    renderAt('/login');

    expect(screen.getByRole('link', { name: 'Combo 首页' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', { name: '登录' })).toBeNull();
  });
});
