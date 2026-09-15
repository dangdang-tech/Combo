import type {
  CommerceClient,
  CommerceAccount,
  CommerceCatalog,
  CommerceOrder,
  CommerceOrderSummary,
  CreateCommerceOrderInput,
} from 'combo-agent-sdk';

const agentId = 'mingli';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Draft = { userId: string; input: CreateCommerceOrderInput };
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
export type Snapshot = { catalog: CommerceCatalog; account: CommerceAccount };
export type CommerceSessionOptions = {
  client: CommerceClient;
  storage: Storage;
  currentUser: () => Promise<string>;
  newId: () => string;
  lock: <T>(name: string, work: () => Promise<T>) => Promise<T>;
};

function fail(message: string): never {
  throw new Error(message);
}

/** Only request identity is persisted; QR, credentials and original questions stay out of storage. */
export function createCommerceSession(options: CommerceSessionOptions) {
  const { client, storage, currentUser, newId, lock } = options;
  let userId: string | undefined;
  const key = () => `guanzhao:commerce:${userId}`;

  async function identity() {
    const current = await currentUser();
    if (!uuid.test(current)) fail('登录状态无法确认，请重新登录。');
    if (userId && userId !== current) fail('登录账号已变化，请刷新页面后继续。');
    userId = current;
    return current;
  }

  function readDraft(): Draft | null {
    const raw = storage.getItem(key());
    if (!raw) return null;
    let draft: Draft;
    try {
      draft = JSON.parse(raw) as Draft;
    } catch {
      return fail('本地订单记录无法读取，请通过订单列表核实，暂不创建新单。');
    }
    const input = draft?.input;
    if (
      draft?.userId !== userId ||
      input?.agentId !== agentId ||
      !uuid.test(input?.requestKey ?? '') ||
      !/^[a-f0-9]{64}$/.test(input?.catalogVersion ?? '') ||
      !/^[a-z0-9][a-z0-9-]{0,62}$/.test(input?.packageId ?? '') ||
      !['wechat', 'alipay'].includes(input?.payType)
    )
      fail('本地订单记录不完整，请先核实已有订单。');
    return draft;
  }

  function checkOrder<T extends CommerceOrderSummary>(order: T, draft?: Draft): T {
    if (order.userId !== userId || order.agentId !== agentId) fail('订单身份不匹配。');
    if (
      draft &&
      (order.packageId !== draft.input.packageId || order.payType !== draft.input.payType)
    ) {
      fail('订单与原充值请求不匹配，请先核实。');
    }
    return order;
  }

  async function snapshot(): Promise<Snapshot> {
    await identity();
    const [catalog, account] = await Promise.all([
      client.getCatalog(agentId),
      client.getAccount(agentId),
    ]);
    await identity();
    if (account.userId !== userId) fail('登录账号已变化，请刷新页面后继续。');
    if (catalog.testMode !== account.testMode) fail('支付环境不一致，请稍后重试。');
    account.orders.forEach((order) => checkOrder(order));
    return { catalog, account };
  }

  async function restore(): Promise<CommerceOrder | null> {
    await identity();
    const draft = readDraft();
    if (draft) {
      const order = await client.findOrder(draft.input.requestKey);
      await identity();
      return checkOrder(order, draft);
    }
    const account = await client.getAccount(agentId);
    await identity();
    if (account.userId !== userId) fail('登录账号已变化，请刷新页面后继续。');
    const pending = account.orders.find((order) => order.status !== 'completed');
    return pending ? query(pending.id) : null;
  }

  async function purchase(packageId: string, catalogVersion: string, payType: 'wechat' | 'alipay') {
    const observedRequestKey = userId ? readDraft()?.input.requestKey : undefined;
    await identity();
    return lock(key(), async () => {
      const { catalog, account } = await snapshot();
      const draft = readDraft();
      if (draft) {
        // A missing response is not proof the channel did not create the original order.
        const original = checkOrder(await client.findOrder(draft.input.requestKey), draft);
        await identity();
        if (draft.input.requestKey !== observedRequestKey || original.status !== 'completed')
          return original;
      }
      const unresolved = account.orders.find((order) => order.status !== 'completed');
      if (unresolved) return query(unresolved.id);
      if (
        catalog.version !== catalogVersion ||
        !catalog.packages.some((item) => item.id === packageId)
      ) {
        fail('套餐已更新，请刷新并重新确认价格。');
      }
      const next: Draft = {
        userId: userId!,
        input: { agentId, packageId, catalogVersion, requestKey: newId(), payType },
      };
      // Storage must succeed BEFORE POST. This survives a lost response, refresh or another tab.
      storage.setItem(key(), JSON.stringify(next));
      const created = await client.createOrder(next.input);
      await identity();
      return checkOrder(created, next);
    });
  }

  async function query(orderId: string) {
    await identity();
    const order = await client.getOrder(orderId);
    await identity();
    return checkOrder(order);
  }

  return { snapshot, restore, purchase, query };
}

export type CommerceSession = ReturnType<typeof createCommerceSession>;

export async function readCurrentUser(): Promise<string> {
  const response = await fetch('/mingli/api/combo/session', {
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 401) throw new Error('请先登录观照，再继续充值。');
  if (!response.ok) throw new Error('暂时无法确认登录状态，请稍后重试。');
  const body: unknown = await response.json();
  if (
    typeof body !== 'object' ||
    body === null ||
    !('userId' in body) ||
    typeof body.userId !== 'string'
  ) {
    throw new Error('请先登录观照，再继续充值。');
  }
  return body.userId;
}
