import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFetchMock, type FetchMock } from '../test/mockFetch.js';
import { AUTH_LOGOUT_PATH, completeLogout, logoutSession } from './sessionLogout.js';

let fetchMock: FetchMock | undefined;

afterEach(() => {
  fetchMock?.restore();
  fetchMock = undefined;
  vi.restoreAllMocks();
});

describe('logoutSession', () => {
  it('posts the strict empty JSON contract with the HttpOnly session cookie', async () => {
    fetchMock = installFetchMock({
      status: 200,
      json: {
        data: { loggedOut: true, futureHint: 'ignored' },
        meta: { traceId: 'logout-1', requestVersion: 2 },
      },
    });

    await expect(logoutSession()).resolves.toEqual({ loggedOut: true });
    expect(fetchMock.calls).toEqual([
      {
        url: AUTH_LOGOUT_PATH,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: {},
        credentials: 'include',
      },
    ]);
  });

  it.each([
    { name: 'HTTP 错误', response: { status: 503 } },
    { name: '网络错误', response: { networkError: true } },
    { name: '畸形响应', response: { status: 200, json: { data: { loggedOut: false } } } },
  ])('$name returns null so the menu can offer a manual retry', async ({ response }) => {
    fetchMock = installFetchMock(response);
    await expect(logoutSession()).resolves.toBeNull();
  });
});

describe('completeLogout', () => {
  it('always returns to the in-app login page after successful revocation', () => {
    const navigate = vi.fn<(url: string) => void>();
    completeLogout({ loggedOut: true }, navigate);
    expect(navigate).toHaveBeenCalledWith('/login');
  });
});
