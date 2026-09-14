'use client';

import { useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  ExternalLink,
  FileText,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
import ThemeToggle from '../theme-toggle';

type Screen =
  | 'wallet'
  | 'confirm'
  | 'insufficient'
  | 'checkout'
  | 'pending'
  | 'unknown'
  | 'expired'
  | 'success'
  | 'resumed'
  | 'orders';
type OrderStatus = 'unpaid' | 'pending' | 'unknown' | 'expired' | 'paid';
type Plan = {
  id: string;
  name: string;
  points: number;
  yuan: number;
  note: string;
};
type Order = {
  id: string;
  date: string;
  plan: Plan;
  status: OrderStatus;
};

const plans: Plan[] = [
  {
    id: 'small',
    name: '初见',
    points: 100,
    yuan: 10,
    note: '从眼前的一个问题开始',
  },
  {
    id: 'medium',
    name: '慢谈',
    points: 320,
    yuan: 30,
    note: '为几个关心的方向留些余地',
  },
  {
    id: 'large',
    name: '常观',
    points: 800,
    yuan: 68,
    note: '留给日后想看清的时刻',
  },
];
const task = {
  chart: '我的命盘',
  topic: '事业 · 2027 年',
  question: '那 2027 年呢？适合换一个工作方向吗？',
  cost: 30,
};
const scenes: { value: Screen; label: string }[] = [
  { value: 'wallet', label: '01 · 点数充值' },
  { value: 'confirm', label: '02 · 扣点确认' },
  { value: 'insufficient', label: '03 · 点数不足' },
  { value: 'checkout', label: '04 · 收银台' },
  { value: 'pending', label: '05 · 等待确认' },
  { value: 'unknown', label: '06 · 结果未知' },
  { value: 'expired', label: '07 · 订单过期' },
  { value: 'success', label: '08 · 充值成功' },
  { value: 'resumed', label: '09 · 回到原问题' },
  { value: 'orders', label: '10 · 订单记录' },
];
const orderLabels: Record<OrderStatus, string> = {
  unpaid: '待支付',
  pending: '确认中',
  unknown: '待核实',
  expired: '已过期',
  paid: '已到账',
};
const initialOrders: Order[] = [
  {
    id: 'GZ-DEMO-0912-001',
    date: '09 月 12 日 14:20',
    plan: plans[0],
    status: 'paid',
  },
  {
    id: 'GZ-DEMO-0910-001',
    date: '09 月 10 日 09:42',
    plan: plans[1],
    status: 'expired',
  },
];

function Button({
  children,
  secondary = false,
  ...props
}: React.ComponentProps<'button'> & { secondary?: boolean }) {
  return (
    <button
      type="button"
      className={`gpay-button${secondary ? ' gpay-button-secondary' : ''}`}
      {...props}
    >
      {children}
    </button>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="gpay-eyebrow">{children}</p>;
}

function OriginalQuestion({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`gpay-question${compact ? ' gpay-question-compact' : ''}`}>
      <p className="gpay-meta">
        <span className="gpay-mark" aria-hidden="true">
          问
        </span>
        {task.chart}
        <span>／</span>
        {task.topic}
      </p>
      <p className="gpay-question-text">{task.question}</p>
      {!compact && (
        <p className="gpay-muted">命盘、前文和这次的问题都会保留。充值完成后，回到这里继续。</p>
      )}
    </div>
  );
}

export default function PaymentLab() {
  const [screen, setScreen] = useState<Screen>('wallet');
  const [balance, setBalance] = useState(20);
  const [selectedPlan, setSelectedPlan] = useState(plans[1]);
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [taskResumed, setTaskResumed] = useState(false);
  const sequence = useRef(1);
  const creditedOrders = useRef(new Set<string>());
  const order = orders.find((item) => item.id === orderId);
  const activePlan = order?.plan ?? selectedPlan;
  const hasOpenOrder = orders.some((item) =>
    ['unpaid', 'pending', 'unknown'].includes(item.status),
  );

  function navigate(next: Screen) {
    setNotice('');
    setScreen(next);
  }

  function updateOrder(status: OrderStatus) {
    setOrders((items) => items.map((item) => (item.id === orderId ? { ...item, status } : item)));
  }

  function createOrder() {
    const existing = orders.find((item) => ['unpaid', 'pending', 'unknown'].includes(item.status));
    if (existing) {
      setOrderId(existing.id);
      setSelectedPlan(existing.plan);
      setScreen(
        existing.status === 'unpaid'
          ? 'checkout'
          : existing.status === 'unknown'
            ? 'unknown'
            : 'pending',
      );
      setNotice('你还有一笔待处理的订单。先确认这笔订单，避免重复支付。');
      return;
    }
    const id = `GZ-DEMO-0914-${String(sequence.current++).padStart(3, '0')}`;
    setOrders((items) => [
      { id, date: '09 月 14 日 · 刚刚', plan: selectedPlan, status: 'unpaid' },
      ...items,
    ]);
    setOrderId(id);
    navigate('checkout');
  }

  function settleOrder() {
    if (!order || order.status === 'expired') return;
    if (!creditedOrders.current.has(order.id)) {
      creditedOrders.current.add(order.id);
      setBalance((value) => value + order.plan.points);
    }
    updateOrder('paid');
    navigate('success');
  }

  function returnToQuestion() {
    navigate(taskResumed ? 'resumed' : balance < task.cost ? 'insufficient' : 'confirm');
  }

  function resumeTask() {
    if (balance < task.cost) return navigate('insufficient');
    if (!taskResumed) {
      setBalance((value) => value - task.cost);
      setTaskResumed(true);
    }
    navigate('resumed');
  }

  function openOrder(item: Order) {
    setOrderId(item.id);
    setSelectedPlan(item.plan);
    navigate(
      item.status === 'paid' ? 'success' : item.status === 'unpaid' ? 'checkout' : item.status,
    );
  }

  function loadScene(next: Screen) {
    const plan = plans[1];
    const status: OrderStatus =
      next === 'success'
        ? 'paid'
        : ['pending', 'unknown', 'expired'].includes(next)
          ? (next as OrderStatus)
          : 'unpaid';
    const id = `GZ-DEMO-0914-${String(sequence.current++).padStart(3, '0')}`;
    const needsOrder = ['checkout', 'pending', 'unknown', 'expired', 'success'].includes(next);
    setSelectedPlan(plan);
    setOrders(
      needsOrder
        ? [{ id, date: '09 月 14 日 · 刚刚', plan, status }, ...initialOrders]
        : initialOrders,
    );
    setOrderId(needsOrder ? id : null);
    creditedOrders.current = new Set(next === 'success' ? [id] : []);
    setBalance(next === 'confirm' ? 120 : next === 'success' ? 340 : next === 'resumed' ? 90 : 20);
    setTaskResumed(next === 'resumed');
    navigate(next);
  }

  const isOrderScreen = ['checkout', 'pending', 'unknown', 'expired', 'success'].includes(screen);

  return (
    <div className="gpay-page">
      <aside className="gpay-preview" aria-label="设计预览控制">
        <div>
          <span className="gpay-preview-dot" />
          交互预览
          <span className="gpay-preview-note">演示金额与状态，不会创建真实订单或扣费</span>
        </div>
        <div className="gpay-preview-controls">
          <label htmlFor="gpay-scene">查看状态</label>
          <select
            id="gpay-scene"
            value={screen}
            onChange={(event) => loadScene(event.target.value as Screen)}
          >
            {scenes.map((scene) => (
              <option value={scene.value} key={scene.value}>
                {scene.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => loadScene('wallet')} aria-label="重置支付预览">
            <RotateCcw size={16} />
            <span>重置</span>
          </button>
        </div>
      </aside>

      <header className="gpay-header">
        <button type="button" className="gpay-brand" onClick={returnToQuestion}>
          观照<span>GUANZHAO</span>
        </button>
        <nav aria-label="支付页面导航">
          <button
            type="button"
            onClick={returnToQuestion}
            aria-current={
              ['confirm', 'insufficient', 'resumed'].includes(screen) ? 'page' : undefined
            }
          >
            我的问题
          </button>
          <button
            type="button"
            onClick={() => navigate('wallet')}
            aria-current={screen === 'wallet' || isOrderScreen ? 'page' : undefined}
          >
            点数充值
          </button>
          <button
            type="button"
            onClick={() => navigate('orders')}
            aria-current={screen === 'orders' ? 'page' : undefined}
          >
            订单记录
          </button>
          <ThemeToggle />
        </nav>
      </header>

      <main className="gpay-main">
        {notice && (
          <output className="gpay-notice">
            <CircleHelp size={18} />
            <span>{notice}</span>
          </output>
        )}

        {screen === 'wallet' && (
          <>
            <section className="gpay-intro">
              <div>
                <Eyebrow>GUANZHAO POINTS · 观照点</Eyebrow>
                <h1>
                  留一点余地，
                  <br />
                  把问题看清。
                </h1>
                <p>按需充值。每次解读前，都能先看清需要多少点。</p>
              </div>
              <div className="gpay-balance">
                <span>可用观照点</span>
                <p>
                  {balance}
                  <small>点</small>
                </p>
                <button type="button" onClick={() => navigate('orders')}>
                  查看明细 <ArrowRight size={16} />
                </button>
              </div>
            </section>
            <div className="gpay-columns">
              <section className="gpay-plans-section" aria-labelledby="gpay-plans-title">
                <div className="gpay-section-title">
                  <h2 id="gpay-plans-title">选一份，留给自己</h2>
                  <span className="gpay-demo-label">套餐与价格为演示</span>
                </div>
                <fieldset className="gpay-plans" aria-label="充值套餐">
                  {plans.map((plan, index) => (
                    <button
                      type="button"
                      key={plan.id}
                      className={`gpay-plan${selectedPlan.id === plan.id ? ' is-selected' : ''}`}
                      onClick={() => setSelectedPlan(plan)}
                      aria-pressed={selectedPlan.id === plan.id}
                    >
                      <span className="gpay-plan-top">
                        <span>
                          0{index + 1} ／ {plan.name}
                        </span>
                        <span className="gpay-radio">
                          {selectedPlan.id === plan.id && <Check size={12} />}
                        </span>
                      </span>
                      <span className="gpay-plan-points">
                        {plan.points}
                        <small>点</small>
                      </span>
                      <span className="gpay-plan-price">
                        ¥ {plan.yuan}
                        <small>演示价</small>
                      </span>
                      <span className="gpay-plan-note">{plan.note}</span>
                    </button>
                  ))}
                </fieldset>
                <div className="gpay-purchase-row">
                  <div>
                    <strong>{selectedPlan.points} 观照点</strong>
                    <p className="gpay-muted">
                      本次充值 <span>¥ {selectedPlan.yuan}（演示）</span>
                    </p>
                  </div>
                  <Button onClick={createOrder}>
                    {hasOpenOrder ? '查看待处理订单' : '继续充值'}
                    <ArrowRight size={18} />
                  </Button>
                </div>
                <div className="gpay-reassurance">
                  <ShieldCheck size={18} />
                  <p>付款结果确认后，点数才会到账。充值与解读分别确认。</p>
                </div>
                <div className="gpay-explainer">
                  <div>
                    <span>01</span>
                    <h3>先看清，再确认</h3>
                    <p>每次解读都会列出点数，确认后才开始。</p>
                  </div>
                  <div>
                    <span>02</span>
                    <h3>回到原来的问题</h3>
                    <p>充值不会清空命盘、问题或已有的对话。</p>
                  </div>
                </div>
              </section>
              <aside className="gpay-side-card">
                <Eyebrow>留在这里的问题</Eyebrow>
                <OriginalQuestion />
                <div className="gpay-divider" />
                <div className="gpay-detail-row">
                  <span>本次需要</span>
                  <strong>{task.cost} 点</strong>
                </div>
                <div className="gpay-detail-row gpay-muted">
                  <span>当前可用</span>
                  <span>{balance} 点</span>
                </div>
                <p className="gpay-shortfall">
                  {balance < task.cost
                    ? `还差 ${task.cost - balance} 点，就可以继续。`
                    : '点数已足够，可以继续解读。'}
                </p>
                <Button secondary onClick={returnToQuestion}>
                  回到原问题
                  <ArrowRight size={16} />
                </Button>
              </aside>
            </div>
          </>
        )}

        {['confirm', 'insufficient', 'resumed'].includes(screen) && (
          <section className="gpay-task-layout">
            <div className="gpay-task-intro">
              <Eyebrow>YOUR QUESTION · 原来的问题</Eyebrow>
              <h1>
                沿着这个问题，
                <br />
                继续往下看。
              </h1>
              <OriginalQuestion />
              <button type="button" className="gpay-text-link" onClick={() => navigate('wallet')}>
                <WalletCards size={16} />
                可用 {balance} 点
                <span>
                  充值 <ChevronRight size={15} />
                </span>
              </button>
            </div>
            <div className="gpay-action-card" key={screen}>
              {screen === 'resumed' ? (
                <>
                  <span className="gpay-state-icon">
                    <Check size={25} />
                  </span>
                  <Eyebrow>问题已保留</Eyebrow>
                  <h2>回到熟悉的地方</h2>
                  <p className="gpay-muted">
                    命盘、事业主题和 2027 年的问题都在。你可以在这里继续查看解读。
                  </p>
                  <div className="gpay-readback">
                    <span>本次解读</span>
                    <strong>已确认 · {task.cost} 点</strong>
                    <p>从「那 2027 年呢？」继续</p>
                  </div>
                  <p className="gpay-muted gpay-small">无需重新排盘，也无需重复提交问题。</p>
                  <Button secondary onClick={() => navigate('orders')}>
                    查看点数明细 <ArrowRight size={17} />
                  </Button>
                </>
              ) : (
                <>
                  <span className="gpay-card-index">
                    {screen === 'insufficient' ? '还差一点，就可以继续' : '开始之前，先与你确认'}
                  </span>
                  <h2>{screen === 'insufficient' ? '需要补充一些观照点' : '继续这次解读'}</h2>
                  <p className="gpay-muted">围绕你的命盘与前文，继续看 2027 年的事业方向。</p>
                  <dl className="gpay-cost-list">
                    <div>
                      <dt>本次需要</dt>
                      <dd>{task.cost} 点</dd>
                    </div>
                    <div>
                      <dt>当前可用</dt>
                      <dd>{balance} 点</dd>
                    </div>
                    <div className={balance < task.cost ? 'gpay-accent' : ''}>
                      <dt>{balance < task.cost ? '还需补充' : '确认后剩余'}</dt>
                      <dd>{Math.abs(balance - task.cost)} 点</dd>
                    </div>
                  </dl>
                  <Button
                    onClick={screen === 'insufficient' ? () => navigate('wallet') : resumeTask}
                  >
                    {screen === 'insufficient' ? '补充点数，保留问题' : `确认使用 ${task.cost} 点`}
                    <ArrowRight size={18} />
                  </Button>
                  <p className="gpay-small gpay-muted">
                    {screen === 'insufficient'
                      ? '这次尚未扣点。充值后会回到这个问题。'
                      : '本次只确认这一条问题，继续追问时会再次提示。'}
                  </p>
                  <button
                    type="button"
                    className="gpay-text-link gpay-center-link"
                    onClick={() => {
                      navigate('wallet');
                      setNotice('问题已经保留，你可以稍后回来继续。');
                    }}
                  >
                    稍后再说
                  </button>
                </>
              )}
            </div>
          </section>
        )}

        {isOrderScreen && (
          <>
            <button type="button" className="gpay-back" onClick={() => navigate('wallet')}>
              <ArrowLeft size={16} />
              返回点数充值
            </button>
            <div className="gpay-checkout-heading">
              <div>
                <Eyebrow>PAYMENT · 充值订单</Eyebrow>
                <h1>
                  {screen === 'success'
                    ? '点数已到账。'
                    : screen === 'expired'
                      ? '这笔订单已过期。'
                      : screen === 'unknown'
                        ? '我们还在核实结果。'
                        : screen === 'pending'
                          ? '等待付款确认。'
                          : '补充点数，继续观照。'}
                </h1>
              </div>
              <ol className="gpay-steps" aria-label="充值进度">
                <li className="is-done">
                  <Check size={13} />
                  选择套餐
                </li>
                <li className={screen === 'success' ? 'is-done' : 'is-current'}>
                  <span>2</span>完成付款
                </li>
                <li className={screen === 'success' ? 'is-current' : ''}>
                  <span>3</span>回到问题
                </li>
              </ol>
            </div>
            <div className="gpay-checkout-grid">
              <section className="gpay-payment-card" aria-live="polite">
                {screen === 'checkout' && (
                  <>
                    <div className="gpay-payment-card-title">
                      <h2>完成这次充值</h2>
                      <span className="gpay-status">
                        <Clock3 size={14} />
                        待支付
                      </span>
                    </div>
                    <div className="gpay-pay-amount">
                      <small>应付金额 · 演示</small>
                      <strong>
                        <span>¥</span>
                        {activePlan.yuan.toFixed(2)}
                      </strong>
                      <p>到账 {activePlan.points} 观照点</p>
                    </div>
                    <div className="gpay-checkout-placeholder">
                      <WalletCards size={32} />
                      <strong>在收银台选择支付方式</strong>
                      <p>完成付款后，可以回到这里查看结果。</p>
                      <span>设计预览 · 非付款码</span>
                    </div>
                    <Button
                      onClick={() => {
                        updateOrder('pending');
                        navigate('pending');
                      }}
                    >
                      前往收银台
                      <ExternalLink size={17} />
                    </Button>
                    <p className="gpay-small gpay-muted gpay-center">请在订单有效期内完成支付。</p>
                  </>
                )}
                {screen === 'pending' && (
                  <>
                    <span className="gpay-state-icon">
                      <LoaderCircle size={27} className="gpay-spin" />
                    </span>
                    <h2>付款后，稍等片刻</h2>
                    <p className="gpay-muted">
                      支付结果确认后，点数会自动到账。你可以先回到问题，也可以留在这里查看结果。
                    </p>
                    <div className="gpay-waiting">
                      <span className="gpay-wait-dot" />
                      <span>正在等待这笔订单的付款结果</span>
                    </div>
                    <Button
                      onClick={() =>
                        setNotice('还没有收到付款成功的确认，请稍后再查看。无需重复付款。')
                      }
                    >
                      我已付款，查看结果
                      <RotateCcw size={17} />
                    </Button>
                    <Button secondary onClick={returnToQuestion}>
                      先回到原问题
                      <ArrowRight size={17} />
                    </Button>
                    <p className="gpay-small gpay-muted">
                      没有完成付款？
                      <button
                        type="button"
                        className="gpay-inline-link"
                        onClick={() => navigate('checkout')}
                      >
                        返回同一笔订单的收银台
                      </button>
                    </p>
                  </>
                )}
                {screen === 'unknown' && (
                  <>
                    <span className="gpay-state-icon">
                      <CircleHelp size={27} />
                    </span>
                    <h2>暂时无法确认是否到账</h2>
                    <p className="gpay-muted">
                      如果你已经付款，请先不要再次支付。保留这笔订单，稍后可以从订单记录继续核实。
                    </p>
                    <div className="gpay-readback">
                      <span>订单 {order?.id}</span>
                      <strong>付款结果待核实 · 点数尚未更新</strong>
                    </div>
                    <Button
                      onClick={() =>
                        setNotice('正在核实原订单。当前结果仍未确认，点数未发生变化。')
                      }
                    >
                      再次查看这笔订单
                      <RotateCcw size={17} />
                    </Button>
                    <Button secondary onClick={() => navigate('orders')}>
                      前往订单记录
                      <ArrowRight size={17} />
                    </Button>
                    <p className="gpay-small gpay-muted">这不会发起新的支付。</p>
                  </>
                )}
                {screen === 'expired' && (
                  <>
                    <span className="gpay-state-icon">
                      <Clock3 size={27} />
                    </span>
                    <h2>付款窗口已经结束</h2>
                    <p className="gpay-muted">
                      这笔订单已关闭，尚未到账。如果你已经付款，先核实原订单的结果。
                    </p>
                    <Button
                      onClick={() => {
                        updateOrder('unknown');
                        navigate('unknown');
                      }}
                    >
                      我已经付款，核实结果
                      <ArrowRight size={17} />
                    </Button>
                    <Button
                      secondary
                      onClick={() => {
                        navigate('wallet');
                        setNotice('请选择套餐，重新创建一笔充值订单。');
                      }}
                    >
                      尚未付款，重新选择套餐
                    </Button>
                    <p className="gpay-small gpay-muted">原问题仍然保留。</p>
                  </>
                )}
                {screen === 'success' && (
                  <>
                    <span className="gpay-state-icon gpay-state-success">
                      <CheckCircle2 size={28} />
                    </span>
                    <Eyebrow>充值完成</Eyebrow>
                    <h2>{activePlan.points} 观照点，已到账</h2>
                    <p className="gpay-muted">
                      这笔充值已确认。原来的命盘和问题都在，可以回去继续了。
                    </p>
                    <div className="gpay-arrival">
                      <span>当前可用</span>
                      <strong>
                        {balance}
                        <small>点</small>
                      </strong>
                    </div>
                    <Button onClick={returnToQuestion}>
                      回到原问题
                      <ArrowRight size={18} />
                    </Button>
                    <Button secondary onClick={() => navigate('orders')}>
                      查看充值记录
                      <FileText size={17} />
                    </Button>
                    <p className="gpay-small gpay-muted">
                      充值不会直接开始解读，回到问题后再确认使用点数。
                    </p>
                  </>
                )}
              </section>
              <aside className="gpay-receipt">
                <Eyebrow>ORDER DETAILS · 订单详情</Eyebrow>
                <div className="gpay-receipt-plan">
                  <span>{activePlan.name}</span>
                  <strong>
                    {activePlan.points}
                    <small>观照点</small>
                  </strong>
                </div>
                <dl>
                  <div>
                    <dt>充值金额</dt>
                    <dd>
                      ¥ {activePlan.yuan.toFixed(2)} <span>演示</span>
                    </dd>
                  </div>
                  <div>
                    <dt>订单状态</dt>
                    <dd>{order ? orderLabels[order.status] : '待支付'}</dd>
                  </div>
                  <div>
                    <dt>订单编号</dt>
                    <dd className="gpay-order-id">{order?.id}</dd>
                  </div>
                </dl>
                <div className="gpay-divider" />
                <p className="gpay-meta">充值后，继续这个问题</p>
                <OriginalQuestion compact />
                <button type="button" className="gpay-text-link" onClick={returnToQuestion}>
                  回到原问题 <ArrowRight size={16} />
                </button>
              </aside>
            </div>
            {['checkout', 'pending', 'unknown'].includes(screen) && (
              <aside className="gpay-simulator" aria-label="模拟支付结果">
                <strong>预览控制</strong>
                <span>模拟这笔订单返回的结果</span>
                <button type="button" onClick={settleOrder}>
                  已支付到账
                </button>
                <button
                  type="button"
                  onClick={() => {
                    updateOrder('unknown');
                    navigate('unknown');
                  }}
                >
                  结果未知
                </button>
                <button
                  type="button"
                  onClick={() => {
                    updateOrder('expired');
                    navigate('expired');
                  }}
                >
                  订单过期
                </button>
              </aside>
            )}
          </>
        )}

        {screen === 'orders' && (
          <>
            <section className="gpay-orders-heading">
              <div>
                <Eyebrow>YOUR RECORDS · 账户明细</Eyebrow>
                <h1>每一笔，都有来处。</h1>
                <p className="gpay-muted">查看充值结果，也找到还没完成的订单。</p>
              </div>
              <div className="gpay-balance gpay-balance-small">
                <span>可用观照点</span>
                <p>
                  {balance}
                  <small>点</small>
                </p>
                <button type="button" onClick={() => navigate('wallet')}>
                  补充点数 <ArrowRight size={16} />
                </button>
              </div>
            </section>
            <section className="gpay-orders" aria-labelledby="gpay-orders-title">
              <div className="gpay-section-title">
                <h2 id="gpay-orders-title">充值记录</h2>
                <span className="gpay-demo-label">演示记录</span>
              </div>
              <div className="gpay-order-table">
                <div className="gpay-table-heading">
                  <span>充值套餐 / 订单</span>
                  <span>金额</span>
                  <span>状态</span>
                  <span />
                </div>
                {orders.map((item) => (
                  <article className="gpay-order-row" key={item.id}>
                    <div className="gpay-order-description">
                      <span className="gpay-order-symbol">
                        <ArrowDownLeft size={21} />
                      </span>
                      <div>
                        <h3>
                          {item.plan.points} 观照点 <span>／ {item.plan.name}</span>
                        </h3>
                        <p>{item.date}</p>
                        <p className="gpay-order-id">{item.id}</p>
                      </div>
                    </div>
                    <p className="gpay-order-amount">
                      ¥ {item.plan.yuan.toFixed(2)}
                      <small>演示</small>
                    </p>
                    <span className={`gpay-status gpay-status-${item.status}`}>
                      {item.status === 'paid' ? <Check size={13} /> : <Clock3 size={13} />}
                      {orderLabels[item.status]}
                    </span>
                    <button
                      type="button"
                      className="gpay-order-link"
                      onClick={() => openOrder(item)}
                      aria-label={`查看订单 ${item.id}`}
                    >
                      查看
                      <ChevronRight size={16} />
                    </button>
                  </article>
                ))}
              </div>
            </section>
            {taskResumed && (
              <section className="gpay-consumption">
                <div>
                  <Eyebrow>本次使用</Eyebrow>
                  <h3>{task.topic} · 继续解读</h3>
                  <p>{task.question}</p>
                </div>
                <strong>−{task.cost} 点</strong>
                <span className="gpay-status">已确认</span>
              </section>
            )}
            <div className="gpay-history-foot">
              <p>
                <CircleHelp size={16} />
                已付款但尚未到账？打开原订单核实，避免再次支付。
              </p>
              <button type="button" className="gpay-text-link" onClick={returnToQuestion}>
                回到原问题
                <ArrowRight size={16} />
              </button>
            </div>
          </>
        )}
      </main>
      <footer className="gpay-footer">
        <span>观照 · 让问题慢慢清晰</span>
        <span>文化研究与娱乐参考</span>
      </footer>
    </div>
  );
}
