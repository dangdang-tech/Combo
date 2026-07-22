import { describe, expect, it, vi } from 'vitest';
import { AUTH_LOGIN_PATH, goToLogin, loginUrl } from './login.js';

describe('runtime login navigation', () => {
  it('preserves an allowed capability deep link on the custom login route', () => {
    const returnTo = '/try/c/11111111-1111-4111-8111-111111111111?from=market';
    expect(loginUrl(returnTo)).toBe(`${AUTH_LOGIN_PATH}?returnTo=${encodeURIComponent(returnTo)}`);
  });

  it('navigates a failed mutation to login while preserving its runtime deep link', () => {
    const navigate = vi.fn<(url: string) => void>();
    const returnTo = '/try/session/11111111-1111-4111-8111-111111111111?tab=artifact';
    goToLogin(returnTo, navigate);
    expect(navigate).toHaveBeenCalledWith(
      `${AUTH_LOGIN_PATH}?returnTo=${encodeURIComponent(returnTo)}`,
    );
  });

  it('falls external, encoded slash and non-MVP paths back to /tasks', () => {
    for (const returnTo of [
      'https://evil.example/path',
      '//evil.example/path',
      '/try/%2f%2fevil.example',
      '/settings/security',
    ]) {
      expect(loginUrl(returnTo)).toBe(
        `${AUTH_LOGIN_PATH}?returnTo=${encodeURIComponent('/tasks')}`,
      );
    }
  });
});
