import { useEffect, useState } from 'react';
import { Clock3, RotateCcw, ScanLine } from 'lucide-react';

export type PaymentMethod = 'wechat' | 'alipay';
// Decodes to plain text only. Live checkout must use the authorized order.qrImage.
const previewQr = [
  '000000000000000000000000000000000',
  '000000000000000000000000000000000',
  '000000000000000000000000000000000',
  '000000000000000000000000000000000',
  '000011111110000011110011111110000',
  '000010000010001111111010000010000',
  '000010111010011101100010111010000',
  '000010111010001001101010111010000',
  '000010111010000101100010111010000',
  '000010000010110100111010000010000',
  '000011111110101010101011111110000',
  '000000000000000100000000000000000',
  '000010010110101010001101000000000',
  '000010101001100010001010010010000',
  '000011110010111110110010111000000',
  '000010111100110011101111111110000',
  '000010101011011101111001101010000',
  '000001011100001100101110100110000',
  '000010110111101100111001000000000',
  '000001100101110100100101010110000',
  '000011100110010011011111100100000',
  '000000000000111011001000101010000',
  '000011111110000110111010100000000',
  '000010000010101010001000100010000',
  '000010111010001000001111111000000',
  '000010111010111100011010000100000',
  '000010111010001000001010101010000',
  '000010000010011000101000100010000',
  '000011111110100010001000100010000',
  '000000000000000000000000000000000',
  '000000000000000000000000000000000',
  '000000000000000000000000000000000',
  '000000000000000000000000000000000',
];

export default function PaymentQr({
  orderId,
  pending,
  method,
  amount,
  points,
  expiresAt,
  onQuery,
  onExpired,
}: {
  orderId: string;
  pending: boolean;
  method: PaymentMethod;
  amount: number;
  points: number;
  expiresAt: number;
  onQuery: () => void;
  onExpired: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  useEffect(() => {
    if (seconds === 0) onExpired();
  }, [seconds, onExpired]);
  const label = method === 'wechat' ? '微信支付' : '支付宝';
  return (
    <div className="gpay-qr-checkout">
      <div className="gpay-payment-card-title">
        <h2>完成支付，继续探索</h2>
        <span className="gpay-status">
          <Clock3 size={13} />
          {pending ? '正在确认' : '待支付'}
        </span>
      </div>
      <div className="gpay-pay-amount">
        <small>应付金额 · 演示</small>
        <strong>
          <span>¥</span>
          {amount.toFixed(2)}
        </strong>
        <p>到账 {points} 观照点</p>
      </div>
      <h3 className={`gpay-channel gpay-channel-${method}`}>
        <ScanLine size={19} />
        {label}扫码支付
      </h3>
      <div className="gpay-qr-paper">
        <svg
          className="gpay-qr"
          role="img"
          aria-label={`${label}演示二维码，非付款码`}
          viewBox={`0 0 ${previewQr.length} ${previewQr.length}`}
          shapeRendering="crispEdges"
        >
          <rect width="100%" height="100%" fill="white" />
          {previewQr.flatMap((row, y) =>
            [...row].map((bit, x) =>
              bit === '1' ? (
                <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#111111" />
              ) : null,
            ),
          )}
        </svg>
        <span>演示二维码 · 非付款码</span>
      </div>
      <p className="gpay-qr-instruction">打开{method === 'wechat' ? '微信' : '支付宝'}「扫一扫」</p>
      <p className="gpay-qr-countdown">
        请在{' '}
        <time>
          {String(Math.floor(seconds / 60)).padStart(2, '0')}:
          {String(seconds % 60).padStart(2, '0')}
        </time>{' '}
        内完成支付
      </p>
      <button type="button" className="gpay-button gpay-button-secondary" onClick={onQuery}>
        我已支付，查询状态 <RotateCcw size={16} />
      </button>
      <p className="gpay-small gpay-muted">如果已经扣款，请继续查询原订单，无需重复付款。</p>
      <p className="gpay-qr-order">
        订单编号 <span>{orderId}</span>
      </p>
    </div>
  );
}
