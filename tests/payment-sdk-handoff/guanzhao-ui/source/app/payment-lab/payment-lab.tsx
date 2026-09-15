'use client';

import { useEffect, useState } from 'react';
import CommercePage from '../../commerce-page';

/** Defer browser session access until mounted, including when embedded in a Next host. */
export default function PaymentLab() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <CommercePage /> : <p role="status">正在读取观照账户…</p>;
}
