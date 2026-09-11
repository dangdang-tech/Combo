// typed client 测试：轻包络解包 / ErrorEnvelope 白名单重建 / 非契约响应兜底人话。
import { describe, it, expect, afterEach, vi } from 'vitest';
import { installFetchMock, type FetchMock } from '../test/mockFetch.js';
import {
  ApiError,
  apiGet,
  apiPost,
  resetUnauthorizedRedirectForTest,
  sanitizeErrorBody,
  unauthorizedNavigation,
} from './client.js';

const TRANSFER_ID = '11111111-1111-4111-8111-111111111111';
const TRANSFER_PAGE = `/agent-transfers/${TRANSFER_ID}`;
const TRANSFER_PATH = `/agent-package-transfers/${TRANSFER_ID}`;

let fm: FetchMock | undefined;
afterEach(() => {
  fm?.restore();
  fm = undefined;
  resetUnauthorizedRedirectForTest();
  vi.restoreAllMocks();
});

describe('apiGet — 轻包络 { data, meta } 解包', () => {
  it('成功：解包当前 Agent 数据；URL 拼 API_PREFIX；credentials include', async () => {
    fm = installFetchMock({ status: 200, json: { data: { ok: true }, meta: {} } });
    const data = await apiGet<{ ok: boolean }>(TRANSFER_PATH);
    expect(data).toEqual({ ok: true });
    expect(fm.calls[0]?.url).toBe(`/api/v1${TRANSFER_PATH}`);
    expect(fm.calls[0]?.method).toBe('GET');
    expect(fm.calls[0]?.credentials).toBe('include');
  });
});

describe('apiPost — JSON body', () => {
  it('序列化 body + Content-Type', async () => {
    fm = installFetchMock({ status: 200, json: { data: { transferId: TRANSFER_ID } } });
    await apiPost(`${TRANSFER_PATH}/approval`, { decision: 'approve' });
    expect(fm.calls[0]?.method).toBe('POST');
    expect(fm.calls[0]?.body).toEqual({ decision: 'approve' });
    expect(fm.calls[0]?.headers['Content-Type']).toBe('application/json');
  });
});

describe('401 fixed session semantics', () => {
  it('surfaces 401 metadata and navigates once without refresh or GET replay', async () => {
    window.history.replaceState({}, '', TRANSFER_PAGE);
    const navigate = vi.spyOn(unauthorizedNavigation, 'assign').mockImplementation(() => undefined);
    fm = installFetchMock({
      status: 401,
      json: {
        error: {
          userMessage: '请先登录。',
          retriable: false,
          action: 'escalate',
          traceId: 'trace-401',
        },
      },
    });

    const error = (await apiGet(TRANSFER_PATH).catch((cause: unknown) => cause)) as ApiError;
    expect(error.userMessage).toBe('请先登录。');
    expect(error.retriable).toBe(false);
    expect(error.httpStatus).toBe(401);
    expect(error.envelope.error).not.toHaveProperty('status');
    expect(Object.keys(error)).not.toContain('httpStatus');
    expect(fm.calls.map((call) => call.url)).toEqual([`/api/v1${TRANSFER_PATH}`]);
    expect(navigate).toHaveBeenCalledWith(`/login?returnTo=${encodeURIComponent(TRANSFER_PAGE)}`);

    await expect(apiGet(TRANSFER_PATH)).rejects.toBeInstanceOf(ApiError);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('never replays a state-changing POST after a 401', async () => {
    const navigate = vi.spyOn(unauthorizedNavigation, 'assign').mockImplementation(() => undefined);
    fm = installFetchMock({
      status: 401,
      json: {
        error: {
          userMessage: '请先登录。',
          retriable: false,
          action: 'escalate',
          traceId: 'trace-post-401',
        },
      },
    });
    const body = { decision: 'approve' };

    await expect(apiPost(`${TRANSFER_PATH}/approval`, body)).rejects.toBeInstanceOf(ApiError);
    expect(fm.calls).toHaveLength(1);
    expect(fm.calls[0]?.body).toEqual(body);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});

describe('非 2xx — ErrorEnvelope 白名单重建，绝不裸露错误码', () => {
  it('契约信封 → ApiError（userMessage/action/retriable/traceId）', async () => {
    fm = installFetchMock({
      status: 409,
      json: {
        error: {
          userMessage: '当前状态不允许这个操作，刷新看看最新状态。',
          retriable: false,
          action: 'change_input',
          traceId: 'trace-409',
        },
      },
    });
    const err = await apiGet(TRANSFER_PATH).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.userMessage).toBe('当前状态不允许这个操作，刷新看看最新状态。');
    expect(apiErr.action).toBe('change_input');
    expect(apiErr.retriable).toBe(false);
    expect(apiErr.traceId).toBe('trace-409');
  });

  it('信封夹带 code/status/stack → 白名单重建后全部剔除', async () => {
    fm = installFetchMock({
      status: 500,
      json: {
        error: {
          userMessage: '服务开小差了，请重试。',
          retriable: true,
          action: 'retry',
          traceId: 't-500',
          code: 'INTERNAL',
          status: 500,
          stack: 'Error: boom',
        },
      },
    });
    const err = (await apiGet(TRANSFER_PATH).catch((e: unknown) => e)) as ApiError;
    expect(err.envelope.error).toEqual({
      userMessage: '服务开小差了，请重试。',
      retriable: true,
      action: 'retry',
      traceId: 't-500',
    });
  });

  it('非契约 JSON（无 userMessage）→ 兜底人话', async () => {
    fm = installFetchMock({ status: 502, json: { message: 'Bad Gateway' } });
    const err = (await apiGet(TRANSFER_PATH).catch((e: unknown) => e)) as ApiError;
    expect(err.userMessage).toBe('服务开小差了，请稍后重试。');
    expect(err.action).toBe('retry');
  });

  it('非 JSON 错误页 → 兜底人话', async () => {
    fm = installFetchMock({ status: 503, notJson: true });
    const err = (await apiGet(TRANSFER_PATH).catch((e: unknown) => e)) as ApiError;
    expect(err.userMessage).toBe('服务暂时没有正确响应，请稍后重试。');
  });

  it('网络断 → 兜底人话（retriable）', async () => {
    fm = installFetchMock({ networkError: true });
    const err = (await apiGet(TRANSFER_PATH).catch((e: unknown) => e)) as ApiError;
    expect(err.userMessage).toBe('网络好像不太稳，检查连接后重试。');
    expect(err.retriable).toBe(true);
  });
});

describe('sanitizeErrorBody — 任意输入收敛为可展示 ErrorBody', () => {
  it('合法 ErrorBody 原样保留安全字段（含 failureId/details）', () => {
    const body = sanitizeErrorBody({
      userMessage: '确认信息不匹配，检查后重新输入。',
      retriable: false,
      action: 'change_input',
      traceId: 't1',
      failureId: 'f1',
      details: { hint: 'x' },
    });
    expect(body).toEqual({
      userMessage: '确认信息不匹配，检查后重新输入。',
      retriable: false,
      action: 'change_input',
      traceId: 't1',
      failureId: 'f1',
      details: { hint: 'x' },
    });
  });

  it('非法 action 归一为 retry；垃圾输入 → 兜底人话', () => {
    expect(sanitizeErrorBody({ userMessage: 'x', action: 'DROP TABLE' }).action).toBe('retry');
    expect(sanitizeErrorBody('boom').userMessage).toBe('服务开小差了，请稍后重试。');
    expect(sanitizeErrorBody(null).userMessage).toBe('服务开小差了，请稍后重试。');
  });
});
