import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App.js';

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

function renderApp(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

describe('App landing route', () => {
  it('renders / as a public page without probing the protected session', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    window.history.replaceState({}, '', '/');

    renderApp();

    expect(
      screen.getByRole('heading', {
        name: /把对话，\s*变成 Agent。/u,
      }),
    ).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('renders an unknown deep link as 404 without probing the session', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    window.history.replaceState({}, '', '/retired-page');

    renderApp();

    expect(screen.getByRole('heading', { name: '页面不存在或已失效' })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
