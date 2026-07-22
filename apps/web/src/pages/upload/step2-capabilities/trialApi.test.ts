import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFetchMock, type FetchMock } from '../../../test/mockFetch.js';
import {
  TrialAuthenticationRequiredError,
  TrialAuthenticationServiceError,
  __setOpenTrialLoginForTests,
  createCapabilityForTrial,
  createRuntimeTrialSession,
  fetchLatestRuntimeTrialSession,
  fetchRuntimeTrialSession,
  resolveTrialAuthenticationError,
} from './trialApi.js';

let mock: FetchMock | undefined;
let restoreOpenLogin: (() => void) | undefined;

afterEach(() => {
  mock?.restore();
  mock = undefined;
  restoreOpenLogin?.();
  restoreOpenLogin = undefined;
  vi.restoreAllMocks();
});

const unauthenticated = {
  status: 401,
  json: {
    error: {
      userMessage: '登录态失效了，请重新登录。',
      retriable: false,
      action: 'escalate',
      traceId: 'auth-trace',
    },
  },
};

describe('runtime trial authentication recovery', () => {
  it('能力准备把 draftId 写入 body，并使用草稿隔离的新版幂等键', async () => {
    mock = installFetchMock({
      status: 201,
      json: {
        data: {
          capabilityId: 'cap-1',
          versionId: 'ver-1',
          slug: 'agent',
          version: '0.1.0',
          manifest: {},
          structureState: { fields: [], totalCount: 0, doneCount: 0 },
        },
      },
    });

    await createCapabilityForTrial('candidate-1', 'draft-1');

    expect(mock.calls[0]).toMatchObject({
      url: '/api/v1/capabilities',
      method: 'POST',
      body: { sourceCandidateId: 'candidate-1', draftId: 'draft-1' },
    });
    expect(mock.calls[0]?.headers['Idempotency-Key']).toBe('trial:create:v2:draft-1:candidate-1');
  });

  it('创建试用会话返回 401 时抛出可跳登录的专用错误', async () => {
    mock = installFetchMock(unauthenticated);

    await expect(
      createRuntimeTrialSession({
        capabilityId: 'cap-1',
        versionId: 'ver-1',
        sourceVersionId: 'source-ver-1',
        title: '试用',
      }),
    ).rejects.toBeInstanceOf(TrialAuthenticationRequiredError);

    expect(mock.calls[0]).toMatchObject({
      url: '/api/v1/runtime/trial-chains/cap-1/sessions',
      method: 'POST',
      credentials: 'include',
      body: { versionId: 'ver-1', sourceVersionId: 'source-ver-1', title: '试用' },
    });
  });

  it('回流校验返回 401 时同样走登录恢复，不冒充 Agent 试用失败', async () => {
    mock = installFetchMock(unauthenticated);

    await expect(fetchRuntimeTrialSession('session-1')).rejects.toBeInstanceOf(
      TrialAuthenticationRequiredError,
    );
  });

  it('按 capability/version/session 读取轻量持久试用状态', async () => {
    const session = {
      id: 'session-1',
      capabilityId: 'cap-1',
      slug: 'agent',
      version: '0.1.0',
      mode: 'trial',
      title: 'Agent 试用',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:01:00.000Z',
    };
    mock = installFetchMock({ status: 200, json: { session, verified: true } });

    await expect(
      fetchLatestRuntimeTrialSession({
        capabilityId: 'cap-1',
        versionId: 'ver-1',
        sessionId: 'session-1',
      }),
    ).resolves.toEqual({ session, verified: true });
    expect(mock.calls[0]).toMatchObject({
      url: '/api/v1/runtime/trial-chains/cap-1/latest-session?versionId=ver-1&sessionId=session-1',
      credentials: 'include',
    });
  });

  it('没有历史试用时返回 null；latest-session 401 延用登录恢复错误', async () => {
    mock = installFetchMock([
      { status: 200, json: { session: null, verified: false } },
      unauthenticated,
    ]);

    await expect(
      fetchLatestRuntimeTrialSession({ capabilityId: 'cap-1', versionId: 'ver-1' }),
    ).resolves.toEqual({ session: null, verified: false });
    await expect(
      fetchLatestRuntimeTrialSession({ capabilityId: 'cap-1', versionId: 'ver-1' }),
    ).rejects.toBeInstanceOf(TrialAuthenticationRequiredError);
  });

  it('Runtime 与 Authoring 都是 401 才跳登录，并带回完整创作深链', async () => {
    const openLogin = vi.fn();
    restoreOpenLogin = __setOpenTrialLoginForTests(openLogin);
    mock = installFetchMock(unauthenticated);
    const returnTo = '/create/capabilities?snapshotId=s1&draftId=d1&extractJobId=j1&candidateId=c1';

    await expect(
      resolveTrialAuthenticationError(
        new TrialAuthenticationRequiredError('登录态失效了，请重新登录。'),
        returnTo,
      ),
    ).resolves.toEqual({ kind: 'redirected' });
    expect(mock.calls[0]).toMatchObject({ url: '/api/v1/me', credentials: 'include' });
    expect(openLogin).toHaveBeenCalledWith(
      `/api/v1/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
    );

    const ordinary = new Error('普通试用错误');
    await expect(resolveTrialAuthenticationError(ordinary, returnTo)).resolves.toEqual({
      kind: 'render',
      error: ordinary,
    });
    expect(openLogin).toHaveBeenCalledTimes(1);
  });

  it('Runtime 401 但 Authoring /me 仍为 200 时不跳登录，降级为试用服务鉴权异常', async () => {
    const openLogin = vi.fn();
    restoreOpenLogin = __setOpenTrialLoginForTests(openLogin);
    mock = installFetchMock({
      status: 200,
      json: {
        data: {
          id: 'user-1',
          logtoUserId: 'sub-1',
          account: 'Wayne',
          email: 'wayne@example.com',
          roles: ['creator'],
          status: 'active',
          hasProfile: true,
          creatorId: 'user-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastLoginAt: null,
        },
      },
    });

    const resolution = await resolveTrialAuthenticationError(
      new TrialAuthenticationRequiredError(),
      '/create/capabilities?snapshotId=s1',
    );

    expect(resolution.kind).toBe('render');
    if (resolution.kind === 'render') {
      expect(resolution.error).toBeInstanceOf(TrialAuthenticationServiceError);
      expect((resolution.error as Error).message).toBe(
        '试用服务暂时无法确认登录状态，请稍后重试。',
      );
    }
    expect(openLogin).not.toHaveBeenCalled();
  });
});
