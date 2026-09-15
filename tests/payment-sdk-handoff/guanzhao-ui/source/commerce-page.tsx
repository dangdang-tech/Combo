import { useEffect, useRef, useState } from 'react';
import { createCommerceClient, CommerceApiError, type CommerceOrder } from 'combo-agent-sdk';
import { ArrowRight, Check, RotateCcw } from 'lucide-react';
import ThemeToggle from './app/theme-toggle';
import { createCommerceSession, readCurrentUser, type Snapshot } from './commerce-session';

const statusLabels: Record<CommerceOrder['status'], string> = {
  waiting: '待支付',
  submitting: '正在准备付款码',
  pending: '等待付款确认',
  unknown: '结果待核实',
  failed: '暂未取得付款码',
  closed: '付款窗口已结束',
  completed: '点数已到账',
};
const money = (cents: number) => (cents / 100).toFixed(2);
const date = (value: string) => new Date(value).toLocaleString('zh-CN');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function message(error: unknown): string {
  if (error instanceof CommerceApiError) {
    if (error.code === 'not_found') return '尚未查到原订单，请稍后再次查询。请勿重复支付。';
    if (error.code === 'catalog_changed') return '套餐价格已更新，请刷新后重新确认。';
    if (['unauthenticated', 'unauthorized', 'forbidden'].includes(error.code))
      return '登录已失效，请重新登录观照。';
    return '暂时无法确认支付结果，请稍后查询原订单。请勿重复支付。';
  }
  return error instanceof Error ? error.message : '暂时无法完成，请稍后重试。';
}

export default function CommercePage() {
  const [session] = useState(() =>
    createCommerceSession({
      client: createCommerceClient({ baseUrl: window.location.origin }),
      storage: {
        getItem: (key) => {
          try {
            return window.localStorage.getItem(key);
          } catch {
            throw new Error('浏览器无法读取充值记录，请允许本站存储后刷新。');
          }
        },
        setItem: (key, value) => {
          try {
            window.localStorage.setItem(key, value);
          } catch {
            throw new Error('浏览器无法保存充值记录，本次尚未下单。请允许本站存储后重试。');
          }
        },
      },
      currentUser: readCurrentUser,
      newId: () => window.crypto.randomUUID(),
      lock: async (name, work) => {
        if (!window.navigator.locks)
          throw new Error('当前浏览器不支持安全保存充值请求，请使用新版浏览器。');
        return await window.navigator.locks.request(name, work);
      },
    }),
  );
  const [data, setData] = useState<Snapshot>();
  const [order, setOrder] = useState<CommerceOrder>();
  const [plan, setPlan] = useState('');
  const [payType, setPayType] = useState<'wechat' | 'alipay'>('wechat');
  const [view, setView] = useState<'plans' | 'order' | 'history'>('plans');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const working = useRef(false);
  const polling = useRef({ id: '', until: 0 });
  const [operationReady, setOperationReady] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [operationId] = useState(() => {
    const value = new URLSearchParams(window.location.search).get('continue');
    return value && uuid.test(value) ? value : null;
  });
  const originalUrl = operationReady
    ? `/mingli/?resume=${encodeURIComponent(operationId!)}`
    : '/mingli/';
  const loginUrl = `/mingli/login?next=${encodeURIComponent('/mingli/payment-sdk/' + (operationId ? `?continue=${operationId}` : ''))}`;

  async function action(work: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setNotice('');
    try {
      await work();
      setUncertain(false);
    } catch (error) {
      const text = message(error);
      setNotice(text);
      setUncertain(true);
      if (text.includes('登录') || text.includes('账号') || text.includes('身份')) {
        setData(undefined);
        setOrder(undefined);
        setOperationReady(false);
      }
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  async function refresh() {
    const next = await session.snapshot();
    setData(next);
    setPlan((previous) =>
      next.catalog.packages.some((item) => item.id === previous)
        ? previous
        : (next.catalog.packages[0]?.id ?? ''),
    );
  }

  async function restore() {
    await refresh();
    if (operationId) {
      const response = await fetch('/mingli/api/combo/operations', {
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('暂时无法确认原请求，请返回观照查看。');
      const body = (await response.json()) as {
        operations?: {
          id: string;
          serviceCredits: boolean;
          status: string;
          recoverable: boolean;
        }[];
      };
      setOperationReady(
        Array.isArray(body.operations) &&
          body.operations.some(
            (item) =>
              item.id === operationId &&
              item.serviceCredits === true &&
              (['ready', 'waiting_for_payment', 'completed'].includes(item.status) ||
                (item.status === 'outcome_unknown' && item.recoverable === true)),
          ),
      );
    }
    const existing = await session.restore();
    if (existing) {
      setOrder(existing);
      setView('order');
    }
  }

  async function query() {
    if (!order) return restore();
    const next = await session.query(order.id);
    setOrder(next);
    await refresh();
  }

  useEffect(() => {
    void action(restore);
  }, [session]);
  useEffect(() => {
    setNow(Date.now());
    if (!order) return;
    const delay = Math.max(0, new Date(order.expiresAt).getTime() - Date.now());
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(delay + 50, 2147483647));
    return () => window.clearTimeout(timer);
  }, [order?.expiresAt]);
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState !== 'visible') return;
      setNow(Date.now());
      setUncertain(true);
      void action(order ? query : restore);
    };
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [order?.id]);
  useEffect(() => {
    if (!order || order.status === 'completed') return;
    if (polling.current.id !== order.id)
      polling.current = { id: order.id, until: Date.now() + 180000 };
    const timer = window.setInterval(() => {
      if (Date.now() >= polling.current.until) {
        window.clearInterval(timer);
        return;
      }
      if (document.visibilityState === 'visible') void action(query);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [order?.id, order?.status]);

  const selected = data?.catalog.packages.find((item) => item.id === plan);
  const canShowQr =
    order &&
    !uncertain &&
    ['waiting', 'pending'].includes(order.status) &&
    new Date(order.expiresAt).getTime() > now;

  return (
    <div className="gpay-page">
      <header className="gpay-header">
        <a className="gpay-brand" href="/mingli/">
          观照<span>GUANZHAO</span>
        </a>
        <nav aria-label="支付页面导航">
          <a href="/mingli/">我的问题</a>
          <button
            type="button"
            onClick={() => setView('plans')}
            aria-current={view === 'plans' ? 'page' : undefined}
          >
            点数充值
          </button>
          <button
            type="button"
            onClick={() => {
              setView('history');
              void action(refresh);
            }}
            aria-current={view === 'history' ? 'page' : undefined}
          >
            订单记录
          </button>
          <ThemeToggle />
        </nav>
      </header>
      <main className="gpay-main" aria-busy={busy}>
        {data?.catalog.testMode && (
          <p className="gpay-notice">
            V2 测试环境 · 渠道下单与账户查询使用真实服务，付款请按测试安排操作。
          </p>
        )}
        {notice && (
          <p className="gpay-notice" role="alert">
            {notice}
          </p>
        )}
        {!data ? (
          <section className="gpay-action-card">
            <h1>先确认你的观照账号</h1>
            <p className="gpay-muted">登录后读取你的点数、套餐与订单。</p>
            <a className="gpay-button" href={loginUrl}>
              前往观照登录
            </a>
            <button
              className="gpay-button gpay-button-secondary"
              type="button"
              disabled={busy}
              onClick={() => void action(restore)}
            >
              已登录，重新加载
            </button>
          </section>
        ) : (
          <>
            {operationReady && (
              <section className="gpay-notice" aria-label="继续已保存的请求">
                <div>
                  <strong>原请求已经保留</strong>
                  <p>可以使用已有点数继续。观照会先核验额度，这不会创建充值订单。</p>
                </div>
                <a className="gpay-button" href={originalUrl}>
                  确认继续原请求
                  <ArrowRight size={17} />
                </a>
              </section>
            )}
            {view === 'plans' && (
              <>
                <section className="gpay-intro">
                  <div>
                    <p className="gpay-eyebrow">GUANZHAO POINTS · 观照点</p>
                    <h1>
                      留一点余地，
                      <br />
                      把问题看清。
                    </h1>
                    <p>套餐与点数来自当前账户，付款确认后到账。</p>
                  </div>
                  <div className="gpay-balance">
                    <span>可用观照点</span>
                    <p>
                      {data.account.availablePoints}
                      <small>点</small>
                    </p>
                    <span>已预留 {data.account.reservedPoints} 点</span>
                  </div>
                </section>
                <div className="gpay-columns">
                  <section className="gpay-plans-section" aria-label="选择充值套餐">
                    <div className="gpay-section-title">
                      <h2>选一份，留给自己</h2>
                      <button type="button" disabled={busy} onClick={() => void action(refresh)}>
                        刷新余额与套餐
                      </button>
                    </div>
                    <fieldset className="gpay-plans" aria-label="充值套餐" disabled={busy}>
                      {data.catalog.packages.map((item, index) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`gpay-plan${item.id === plan ? ' is-selected' : ''}`}
                          aria-pressed={item.id === plan}
                          onClick={() => setPlan(item.id)}
                        >
                          <span className="gpay-plan-top">
                            <span>
                              0{index + 1} ／ {item.name}
                            </span>
                            <span className="gpay-radio">
                              {item.id === plan && <Check size={12} />}
                            </span>
                          </span>
                          <span className="gpay-plan-points">
                            {item.points}
                            <small>点</small>
                          </span>
                          <span className="gpay-plan-price">¥ {money(item.amountCents)}</span>
                          <span className="gpay-plan-note">有效期 {item.validDays} 天</span>
                        </button>
                      ))}
                    </fieldset>
                    <fieldset className="gpay-channels" disabled={busy}>
                      <legend>支付方式</legend>
                      <label>
                        <input
                          type="radio"
                          name="channel"
                          checked={payType === 'wechat'}
                          onChange={() => setPayType('wechat')}
                        />{' '}
                        微信支付
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="channel"
                          checked={payType === 'alipay'}
                          onChange={() => setPayType('alipay')}
                        />{' '}
                        支付宝
                      </label>
                    </fieldset>
                    <div className="gpay-purchase-row">
                      <div>
                        <strong>{selected?.points ?? '—'} 观照点</strong>
                        <p>本次充值 ¥ {selected ? money(selected.amountCents) : '—'}</p>
                      </div>
                      <button
                        className="gpay-button"
                        disabled={busy || !selected}
                        type="button"
                        onClick={() =>
                          void action(async () => {
                            const next = await session.purchase(
                              plan,
                              data.catalog.version,
                              payType,
                            );
                            setOrder(next);
                            setView('order');
                            await refresh();
                          })
                        }
                      >
                        确认套餐，继续充值
                        <ArrowRight size={18} />
                      </button>
                    </div>
                    <p className="gpay-muted">
                      已有待处理订单会先找回原订单。充值不会自动开始解读。
                    </p>
                  </section>
                  <aside className="gpay-side-card">
                    <p className="gpay-eyebrow">回到观照</p>
                    <h2>{operationReady ? '原请求已保存在观照' : '按需充值，继续探索'}</h2>
                    <p>
                      {operationReady
                        ? '充值不会重新提交问题。回到原请求后，由观照继续已保存的内容与上下文。'
                        : '解读和问事的点数按观照当次确认执行。'}
                    </p>
                    <a href="/mingli/" className="gpay-button gpay-button-secondary">
                      {operationReady ? '返回观照查看原请求' : '返回观照'}
                      <ArrowRight size={16} />
                    </a>
                    <div className="gpay-divider" />
                    {data.catalog.services.map((service) => (
                      <p className="gpay-detail-row" key={service.id}>
                        <span>{service.name}</span>
                        <strong>{service.points} 点</strong>
                      </p>
                    ))}
                  </aside>
                </div>
              </>
            )}
            {view === 'order' && order && (
              <>
                <div className="gpay-checkout-heading">
                  <div>
                    <p className="gpay-eyebrow">PAYMENT · 充值订单</p>
                    <h1>{uncertain ? '结果待核实' : statusLabels[order.status]}</h1>
                  </div>
                </div>
                <div className="gpay-checkout-grid">
                  <section className="gpay-payment-card" aria-label="当前订单">
                    <div className="gpay-pay-amount">
                      <small>{order.status === 'completed' ? '已付金额' : '订单金额'}</small>
                      <strong>
                        <span>¥</span>
                        {money(order.amountCents)}
                      </strong>
                      <p>
                        {order.packageName} · {order.points} 观照点
                      </p>
                    </div>
                    {canShowQr && order.qrImage ? (
                      <img
                        className="gpay-live-qr"
                        src={order.qrImage}
                        alt={`${order.payType === 'wechat' ? '微信' : '支付宝'}付款二维码`}
                      />
                    ) : (
                      order.status !== 'completed' && (
                        <div className="gpay-checkout-placeholder">
                          <strong>
                            {order.status === 'closed' ? '付款窗口已结束' : '暂时没有可用付款码'}
                          </strong>
                          <p>保留原订单继续查询。如果已经付款，请勿再次支付。</p>
                        </div>
                      )
                    )}
                    {order.status === 'completed' && (
                      <p>服务端已确认到账，当前可用 {data.account.availablePoints} 点。</p>
                    )}
                    <button
                      className="gpay-button"
                      type="button"
                      disabled={busy}
                      onClick={() => void action(query)}
                    >
                      查询原订单与余额
                      <RotateCcw size={17} />
                    </button>
                    <a className="gpay-button gpay-button-secondary" href="/mingli/">
                      返回观照
                      <ArrowRight size={17} />
                    </a>
                    <p className="gpay-small gpay-muted">
                      查询不会创建新订单。页面最多自动查询 3 分钟，之后可以手动查询。
                    </p>
                  </section>
                  <aside className="gpay-receipt">
                    <p className="gpay-eyebrow">ORDER DETAILS · 订单详情</p>
                    <dl>
                      <div>
                        <dt>订单号</dt>
                        <dd className="gpay-order-id">{order.id}</dd>
                      </div>
                      <div>
                        <dt>创建时间</dt>
                        <dd>{date(order.createdAt)}</dd>
                      </div>
                      <div>
                        <dt>付款有效期至</dt>
                        <dd>{date(order.expiresAt)}</dd>
                      </div>
                      <div>
                        <dt>点数有效期</dt>
                        <dd>{order.validDays} 天</dd>
                      </div>
                      <div>
                        <dt>状态</dt>
                        <dd>{statusLabels[order.status]}</dd>
                      </div>
                    </dl>
                    <p className="gpay-muted">
                      付款窗口到期不代表渠道已经确认关单。结果不明时先核实原订单。
                    </p>
                  </aside>
                </div>
              </>
            )}
            {view === 'history' && (
              <section>
                <div className="gpay-orders-heading">
                  <h1>点数与订单</h1>
                  <button type="button" disabled={busy} onClick={() => void action(refresh)}>
                    刷新记录
                  </button>
                </div>
                <p>
                  可用 {data.account.availablePoints} 点，已预留 {data.account.reservedPoints}{' '}
                  点。显示服务端最近记录。
                </p>
                {data.account.orders.length === 0 && <p className="gpay-muted">还没有充值订单。</p>}
                {data.account.orders.map((item) => (
                  <article className="gpay-order-row" key={item.id}>
                    <div className="gpay-order-description">
                      <div>
                        <h3>{item.packageName}</h3>
                        <p>{date(item.createdAt)}</p>
                        <p className="gpay-order-id">{item.id}</p>
                      </div>
                    </div>
                    <div className="gpay-order-amount">
                      {item.points} 点<small>¥ {money(item.amountCents)}</small>
                    </div>
                    <span className="gpay-status">{statusLabels[item.status]}</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          setOrder(await session.query(item.id));
                          setView('order');
                        })
                      }
                    >
                      查看订单
                    </button>
                  </article>
                ))}
                <h2>点数流水</h2>
                {data.account.ledger.map((item) => (
                  <p className="gpay-detail-row" key={item.id}>
                    <span>
                      {item.label} · {date(item.created_at)}
                    </span>
                    <strong>
                      {item.kind === 'purchase' ? '+' : '−'}
                      {Math.abs(item.points)} 点
                    </strong>
                  </p>
                ))}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
