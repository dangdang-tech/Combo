// F-10 STEP① 数据层测试：铸码/取消 写命令注入 Idempotency-Key + scope；快照查询解包。
import { describe, it, expect, afterEach } from 'vitest';
import { installFetchMock, type FetchMock } from '../../../test/mockFetch.js';
import {
  createPair,
  cancelImportJob,
  fetchPairStatus,
  fetchSnapshot,
  fetchSnapshotSegments,
  importJobEventsUrl,
} from './importApi.js';

let mock: FetchMock;
afterEach(() => mock?.restore());

describe('importApi', () => {
  it('createPair → POST /import/connect/pair 注入 Idempotency-Key + scope=import.connect.pair', async () => {
    mock = installFetchMock({
      status: 200,
      json: {
        data: {
          pairId: 'p1',
          pairingCode: '123456',
          command: 'cmd',
          curlOneLiner: 'curl -fsSL agora.app/import | sh',
          expiresAt: '2026-06-17T01:00:00Z',
        },
      },
    });
    const res = await createPair();
    expect(res.pairId).toBe('p1');
    const call = mock.calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url).toBe('/api/v1/import/connect/pair');
    expect(call.headers['Idempotency-Key']).toBeTruthy();
    expect(call.headers['X-Idempotency-Scope']).toBe('import.connect.pair');
  });

  it('createPair(draftId) → body 带 draftId（续传草稿挂接）', async () => {
    mock = installFetchMock({
      status: 200,
      json: {
        data: {
          pairId: 'p1',
          pairingCode: '1',
          command: 'c',
          curlOneLiner: 'x',
          expiresAt: '2026-06-17T01:00:00Z',
        },
      },
    });
    await createPair({ draftId: 'd1' });
    expect(mock.calls[0]!.body).toEqual({ draftId: 'd1' });
  });

  it('cancelImportJob → POST /jobs/{id}/cancel 注入 scope=job.cancel', async () => {
    mock = installFetchMock({ status: 204 });
    await cancelImportJob('job1');
    const call = mock.calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url).toBe('/api/v1/jobs/job1/cancel');
    expect(call.headers['X-Idempotency-Scope']).toBe('job.cancel');
    expect(call.headers['Idempotency-Key']).toBeTruthy();
  });

  it('fetchPairStatus → GET 读端点（无幂等头）', async () => {
    mock = installFetchMock({
      status: 200,
      json: { data: { pairId: 'p1', phase: 'uploading', uploadedParts: 2, totalParts: 5 } },
    });
    const res = await fetchPairStatus('p1');
    expect(res.phase).toBe('uploading');
    expect(mock.calls[0]!.url).toBe('/api/v1/import/connect/pair/p1');
    expect(mock.calls[0]!.headers['X-Idempotency-Scope']).toBeUndefined();
  });

  it('fetchSnapshot → 解包统计四格', async () => {
    mock = installFetchMock({
      status: 200,
      json: {
        data: {
          id: 'snap1',
          ownerUserId: 'u1',
          source: 'mixed',
          sources: ['claude'],
          stats: { segmentCount: 215, messageCount: 8420, timeSpan: null, projectCount: 14 },
          redaction: { applied: true, totalRedactions: 0, byCategory: [], rulesetVersion: 'v1' },
          createdAt: '2026-06-17T00:00:00Z',
        },
      },
    });
    const res = await fetchSnapshot('snap1');
    expect(res.stats.segmentCount).toBe(215);
    expect(mock.calls[0]!.url).toBe('/api/v1/snapshots/snap1');
  });

  it('fetchSnapshotSegments → 解包 + 透传分页 meta', async () => {
    mock = installFetchMock({
      status: 200,
      json: {
        data: [
          { segmentId: 's1', dateLabel: '03-20', title: 't', messageCount: 1, readOnly: true },
        ],
        meta: { page: { hasMore: true, nextCursor: 'c2', limit: 30, order: 'desc' } },
      },
    });
    const res = await fetchSnapshotSegments('snap1', { limit: 30 });
    expect(res.segments).toHaveLength(1);
    expect(res.hasMore).toBe(true);
    expect(res.nextCursor).toBe('c2');
    expect(mock.calls[0]!.url).toContain('/api/v1/snapshots/snap1/segments');
  });

  it('importJobEventsUrl → 脊柱 §5 job 流端点', () => {
    expect(importJobEventsUrl('job1')).toBe('/api/v1/jobs/job1/events');
  });
});
