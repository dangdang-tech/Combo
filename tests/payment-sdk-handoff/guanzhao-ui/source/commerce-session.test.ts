import { describe, expect, it, vi } from 'vitest';
import type {
  CommerceAccount,
  CommerceCatalog,
  CommerceClient,
  CommerceOrder,
} from 'combo-agent-sdk';
import { createCommerceSession } from './commerce-session';

const userId = '11111111-1111-4111-8111-111111111111';
const otherUser = '22222222-2222-4222-8222-222222222222';
const orderId = '33333333-3333-4333-8333-333333333333';
const requestKey = '44444444-4444-4444-8444-444444444444';
const version = 'a'.repeat(64);
const catalog: CommerceCatalog = {
  agentId: 'mingli',
  name: '观照',
  version,
  testMode: true,
  packages: [{ id: 'starter', name: '初见', points: 2, amountCents: 20, validDays: 365 }],
  services: [{ id: 'question', name: '问事', points: 2 }],
};
const order: CommerceOrder = {
  id: orderId,
  userId,
  agentId: 'mingli',
  packageId: 'starter',
  packageName: '初见',
  points: 2,
  amountCents: 20,
  validDays: 365,
  payType: 'wechat',
  status: 'pending',
  createdAt: '2026-09-15T00:00:00Z',
  expiresAt: '2026-09-15T00:15:00Z',
  paidAt: null,
  testMode: true,
};
const account: CommerceAccount = {
  userId,
  availablePoints: 0,
  reservedPoints: 0,
  expiringPoints: 0,
  nearestExpiry: null,
  orders: [],
  ledger: [],
  testMode: true,
};

function setup() {
  const saved = new Map<string, string>();
  const storage = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      saved.set(key, value);
    }),
  };
  const client = {
    getCatalog: vi.fn(async () => structuredClone(catalog)),
    getAccount: vi.fn(async () => structuredClone(account)),
    createOrder: vi.fn<CommerceClient['createOrder']>().mockResolvedValue(structuredClone(order)),
    findOrder: vi.fn(async () => structuredClone(order)),
    getOrder: vi.fn(async () => structuredClone(order)),
  } satisfies CommerceClient;
  let queue = Promise.resolve();
  const lock = <T>(_name: string, work: () => Promise<T>) => {
    const next = queue.then(work);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  const currentUser = vi.fn(async () => userId);
  const options = { client, storage, currentUser, newId: () => requestKey, lock };
  return { client, storage, saved, currentUser, options, session: createCommerceSession(options) };
}

describe('真实套餐接入的客户端恢复边界（模拟 API）', () => {
  it('stores the original identity before POST and never stores payment material', async () => {
    const test = setup();
    test.client.createOrder.mockImplementation(async (input) => {
      const saved = JSON.parse([...test.saved.values()][0]);
      expect(saved.input.requestKey).toBe(input.requestKey);
      return { ...order, qrImage: 'data:image/png;base64,fixture' };
    });
    await test.session.purchase('starter', version, 'wechat');
    expect(test.client.createOrder).toHaveBeenCalledWith({
      agentId: 'mingli',
      packageId: 'starter',
      catalogVersion: version,
      requestKey,
      payType: 'wechat',
    });
    expect([...test.saved.values()][0]).not.toContain('qrImage');
  });

  it('finds the original order after a lost response and a new page session', async () => {
    const test = setup();
    test.client.createOrder.mockRejectedValueOnce(new Error('connection lost'));
    await expect(test.session.purchase('starter', version, 'wechat')).rejects.toThrow(
      'connection lost',
    );
    const reloaded = createCommerceSession(test.options);
    expect((await reloaded.restore())?.id).toBe(orderId);
    await reloaded.purchase('starter', version, 'wechat');
    expect(test.client.createOrder).toHaveBeenCalledTimes(1);
    expect(test.client.findOrder).toHaveBeenCalledWith(requestKey);
  });

  it('serializes two tabs into one create with the persisted request key', async () => {
    const test = setup();
    const otherTab = createCommerceSession(test.options);
    const results = await Promise.all([
      test.session.purchase('starter', version, 'wechat'),
      otherTab.purchase('starter', version, 'wechat'),
    ]);
    expect(results.map((item) => item.id)).toEqual([orderId, orderId]);
    expect(test.client.createOrder).toHaveBeenCalledTimes(1);
  });

  it('never creates if durable storage failed', async () => {
    const test = setup();
    test.storage.setItem.mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    await expect(test.session.purchase('starter', version, 'wechat')).rejects.toThrow(
      'quota exceeded',
    );
    expect(test.client.createOrder).not.toHaveBeenCalled();
  });

  it('returns the first order even if it completes while a duplicate click waits for the lock', async () => {
    const test = setup();
    const otherTab = createCommerceSession(test.options);
    test.client.findOrder.mockResolvedValue({ ...order, status: 'completed' });
    await Promise.all([
      test.session.purchase('starter', version, 'wechat'),
      otherTab.purchase('starter', version, 'wechat'),
    ]);
    expect(test.client.createOrder).toHaveBeenCalledTimes(1);
  });

  it('requires re-confirmation when the server catalog changed', async () => {
    const test = setup();
    test.client.getCatalog.mockResolvedValue({ ...catalog, version: 'b'.repeat(64) });
    await expect(test.session.purchase('starter', version, 'wechat')).rejects.toThrow('套餐已更新');
    expect(test.client.createOrder).not.toHaveBeenCalled();
  });

  it('does not treat expiry or a lookup error as permission for a new order', async () => {
    const test = setup();
    await test.session.purchase('starter', version, 'wechat');
    test.client.findOrder.mockResolvedValueOnce({ ...order, status: 'closed' });
    expect((await test.session.purchase('starter', version, 'wechat')).status).toBe('closed');
    test.client.findOrder.mockRejectedValueOnce(new Error('not_found'));
    await expect(test.session.purchase('starter', version, 'wechat')).rejects.toThrow('not_found');
    expect(test.client.createOrder).toHaveBeenCalledTimes(1);
  });

  it('checks identity again after login switches and rejects another user response', async () => {
    const test = setup();
    await test.session.snapshot();
    test.currentUser.mockResolvedValue(otherUser);
    await expect(test.session.query(orderId)).rejects.toThrow('账号已变化');
    expect(test.client.getOrder).not.toHaveBeenCalled();
    const isolated = setup();
    isolated.client.getOrder.mockResolvedValue({ ...order, userId: otherUser });
    await expect(isolated.session.query(orderId)).rejects.toThrow('身份不匹配');
  });

  it('uses server account balance on repeated successful queries without local crediting', async () => {
    const test = setup();
    test.client.getOrder.mockResolvedValue({ ...order, status: 'completed' });
    test.client.getAccount.mockResolvedValue({ ...account, availablePoints: 2 });
    await test.session.query(orderId);
    await test.session.query(orderId);
    expect((await test.session.snapshot()).account.availablePoints).toBe(2);
    expect(test.client.createOrder).not.toHaveBeenCalled();
  });

  it('discards an in-flight response when the browser account changes', async () => {
    const test = setup();
    test.client.getOrder.mockImplementation(async () => {
      test.currentUser.mockResolvedValue(otherUser);
      return order;
    });
    await expect(test.session.query(orderId)).rejects.toThrow('账号已变化');
    const balance = setup();
    balance.client.getAccount.mockImplementation(async () => {
      balance.currentUser.mockResolvedValue(otherUser);
      return account;
    });
    await expect(balance.session.snapshot()).rejects.toThrow('账号已变化');
  });

  it('recovers the server account order after local state is absent', async () => {
    const test = setup();
    test.client.getAccount.mockResolvedValue({ ...account, orders: [order] });
    expect((await test.session.restore())?.id).toBe(orderId);
    expect(test.client.getOrder).toHaveBeenCalledWith(orderId);
    expect(test.client.createOrder).not.toHaveBeenCalled();
  });

  it('keeps paid credits available without creating an order when another page completed the purchase', async () => {
    const test = setup();
    test.client.getAccount.mockResolvedValue({
      ...account,
      availablePoints: 2,
      orders: [{ ...order, status: 'completed' }],
    });
    expect(await test.session.restore()).toBeNull();
    expect((await test.session.snapshot()).account.availablePoints).toBe(2);
    expect(test.client.createOrder).not.toHaveBeenCalled();
    expect(test.saved.size).toBe(0);
  });
});
