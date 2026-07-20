import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Shell } from './Shell.js';

describe('Shell navigation', () => {
  it('renders the capability market as a cross-bundle anchor in expanded and collapsed modes', async () => {
    globalThis.localStorage.clear();
    render(
      <MemoryRouter initialEntries={['/tasks']}>
        <Routes>
          <Route element={<Shell />}>
            <Route path="/tasks" element={<p>任务页</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const marketLink = screen.getByRole('link', { name: '能力市集' });
    expect(marketLink).toHaveAttribute('href', '/try/market');

    await userEvent.click(screen.getByRole('button', { name: '收起侧栏' }));
    expect(screen.getByRole('link', { name: '能力市集' })).toHaveAttribute('title', '能力市集');
  });
});
