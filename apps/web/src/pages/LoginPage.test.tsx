import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage, resolveLocalReturnTo } from './index.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LoginPage local review login', () => {
  it('keeps returnTo on the current origin and rejects browser backslash normalization', () => {
    expect(resolveLocalReturnTo('/create/import?draftId=demo#upload', 'http://localhost')).toBe(
      '/create/import?draftId=demo#upload',
    );
    expect(resolveLocalReturnTo('/\\evil.example', 'http://localhost')).toBe('/creator');
    expect(resolveLocalReturnTo('//evil.example', 'http://localhost')).toBe('/creator');
    expect(resolveLocalReturnTo('https://evil.example', 'http://localhost')).toBe('/creator');
  });

  it('development login posts to the guarded real endpoint and shows a useful failure', async () => {
    const request = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', request);
    render(
      <MemoryRouter initialEntries={['/login?returnTo=%2Fcreate%2Fimport']}>
        <LoginPage />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: '本地体验登录' }));

    expect(request).toHaveBeenCalledWith('/api/v1/auth/dev-login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '本地体验登录暂不可用，请确认真实开发服务已启动后重试。',
    );
  });
});
