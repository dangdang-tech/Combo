import { createRoot } from 'react-dom/client';
import PaymentLab from './source/app/payment-lab/payment-lab';
import './source/app/payment-tokens.css';
import './source/app/payment-lab/payment-lab.css';
import './source/app/payment-lab/payment-responsive.css';

const root = document.getElementById('root');
if (!root) throw new Error('Preview root is missing');
createRoot(root).render(<PaymentLab />);
