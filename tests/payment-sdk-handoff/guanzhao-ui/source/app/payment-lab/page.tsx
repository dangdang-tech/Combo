import type { Metadata } from 'next';
import PaymentLab from './payment-lab';
import './payment-lab.css';
import './payment-responsive.css';

export const metadata: Metadata = {
  title: '观照 · 点数与支付流程预览',
  description: '观照点数、充值、订单与回到原问题的交互设计预览。',
  robots: { index: false, follow: false },
};

export default function PaymentLabPage() {
  return <PaymentLab />;
}
