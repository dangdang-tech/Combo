// 公开能力页 /a/:slug 测试（Phase 4B P1）——路由可达（非 NotFound）+ 只读最小卡渲染 + slug 透传。
//
// 工作台「查看公开页」/ 作品墙卡片导航到 /a/{slug}，此前路由树无 /a/:slug → 落 NotFound。
// 本测试用真实 NotFoundPage 同台对照：/a/:slug 命中公开页（非 NotFound），且 :slug 透传进页面。
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PublicCapabilityPage, NotFoundPage } from '../index.js';

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/a/:slug" element={<PublicCapabilityPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('公开能力页 /a/:slug', () => {
  it('路由可达：命中公开页（非 NotFound），渲染只读最小卡', () => {
    renderAt('/a/my-cap');
    expect(screen.getByLabelText('公开能力卡')).toBeInTheDocument();
    // 不是 NotFound 占位。
    expect(screen.queryByText('未找到页面')).not.toBeInTheDocument();
  });

  it(':slug 透传进页面（标题 + data-slug）', () => {
    renderAt('/a/insurance-helper');
    expect(screen.getByRole('heading', { name: 'insurance-helper' })).toBeInTheDocument();
    expect(
      document.querySelector('.cb-public-capability[data-slug="insurance-helper"]'),
    ).not.toBeNull();
  });

  it('对外只读：明示市集完整详情本期未开放（不裸 404、不进管理）', () => {
    renderAt('/a/my-cap');
    expect(screen.getByText(/公开只读页/)).toBeInTheDocument();
  });
});
