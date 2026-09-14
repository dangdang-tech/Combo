/** Explicit local harness: real PostgreSQL/HTTP/UI, synthetic identity, channel and business. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL, URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import { setInterval, clearInterval } from 'node:timers';
const fetch = globalThis.fetch;
import { buildApp } from '../../apps/billing/dist/app.js';
import { createPgBillingStore } from '../../apps/billing/dist/repo.js';
import { createPgPaymentStore } from '../../apps/billing/dist/payment-repo.js';
import { createPaymentTokenCodec } from '../../apps/billing/dist/payment-service.js';
import { createPgChannelOrderStore } from '../../apps/billing/dist/channel-repo.js';
import { createPaymentChannelService } from '../../apps/billing/dist/channel-service.js';
import { createPgRecoveryStore } from '../../apps/billing/dist/recovery-repo.js';
import { createCheckoutRecovery } from '../../apps/billing/dist/recovery-service.js';
import { PaymentAuthenticationError } from '../../apps/billing/dist/payment-auth.js';

assert.equal(process.env.COMBO_RECOVERY_BROWSER_TEST, '1', 'explicit test opt-in required');
const require = createRequire(new URL('../../apps/billing/package.json', import.meta.url));
const { Client, Pool } = require('pg');
const database = new URL(process.env.BILLING_V2_TEST_DATABASE_URL);
assert.match(database.pathname, /_366_browser$/, 'dedicated browser fixture database required');
const admin = new Client({ connectionString: database.toString() });
await admin.connect();
const userId = randomUUID();
await admin.query('INSERT INTO v2_users(id) VALUES($1)', [userId]);
database.username = 'combo_billing';
database.password = process.env.POSTGRES_BILLING_PASSWORD;
const pool = new Pool({ connectionString: database.toString(), max: 10 });
const base = `http://localhost:${Number(process.env.PORT ?? 17966)}`;
const counters = { prepay: 0, close: 0, query: 0, business: 0 };
const provider = new Map();
const gateway = {
  configured: true,
  environment: 'test',
  institutionNo: 'LOCAL_TEST',
  merchantNo: 'LOCAL_TEST',
  async createPayment(command) {
    counters.prepay++;
    const trade = `fixture-${randomUUID()}`;
    provider.set(command.payTraceNo, { command, trade, status: 'pending' });
    if (counters.prepay === 1) throw Error('controlled first-response loss');
    return {
      status: 'pending',
      platformTradeNo: trade,
      action: {
        kind: 'code_url',
        value: `NOT-A-PAYMENT:${trade}`,
        expiresAt: new Date(Date.now() + 600000),
      },
    };
  },
  async queryPayment(command) {
    counters.query++;
    const order = provider.get(command.payTraceNo);
    return order ? { status: order.status, platformTradeNo: order.trade } : { status: 'unknown' };
  },
  async closePayment(command) {
    counters.close++;
    const order = provider.get(command.payTraceNo);
    assert.equal(order.trade, command.platformTradeNo);
    order.status = 'failed';
    return { status: 'closed' };
  },
  verifyPaymentNotification(input) {
    return input;
  },
};
const payments = createPgPaymentStore(pool, {
  tokens: createPaymentTokenCodec('local-browser-test-key-'.repeat(3)),
  checkoutBaseUrl: base,
});
const call = {
  userId,
  agentId: 'recovery-browser-test',
  operationId: randomUUID(),
  callId: randomUUID(),
  requestFingerprint: 'a'.repeat(64),
  pricingPolicyId: 'fixture',
  estimatedAmount: 2,
};
const requirement = await payments.admitCall(call);
assert.equal(requirement.kind, 'payment_required');
await payments.createPayment({
  userId,
  paymentToken: requirement.requirement.paymentToken,
  requestKey: randomUUID(),
});
const paymentId = requirement.requirement.id;
const recoveryStore = createPgRecoveryStore(pool);
const recovery = createCheckoutRecovery({
  store: recoveryStore,
  payments,
  gateway,
  checkoutBaseUrl: base,
});
const legacy = createPaymentChannelService({
  store: createPgChannelOrderStore(pool, { recovery: true }),
  payments,
  gateway,
});
const authenticateUser = async (request) => {
  if (request.method === 'POST' && request.headers.origin !== base)
    throw new PaymentAuthenticationError(403);
  return request.headers.cookie === 'recovery-fixture' ? userId : null;
};
const app = await buildApp({
  store: createPgBillingStore(pool),
  internalToken: 'test-internal-only',
  adminToken: 'test-admin-only',
  overdraftHardLimitCents: 500,
  checkout: {
    payments,
    channel: recovery.legacyChannel(legacy),
    authenticateUser,
    testMode: true,
    recovery,
  },
  recovery: { payments, recovery, authenticateUser, testMode: true },
});
let sdk;
if (process.env.COMBO_RECOVERY_SDK_PATH) {
  const module = await import(pathToFileURL(process.env.COMBO_RECOVERY_SDK_PATH).href);
  sdk = module.createRecoverablePaymentClient({
    paymentUrl: base,
    auth: { kind: 'browser-session' },
    fetchImpl: (url, init) =>
      fetch(url, {
        ...init,
        headers: { ...init.headers, cookie: 'recovery-fixture', origin: base },
      }),
  });
}
app.get('/__test/state', async () => ({
  paymentId,
  counters,
  payment: await recovery.view(paymentId, userId),
  sdk: sdk ? await sdk.get(paymentId) : null,
}));
app.post('/__test/pay', async () => {
  const attempt = (await recoveryStore.snapshot(paymentId, userId)).attempt;
  const order = provider.get(attempt.pay_trace_no);
  order.status = 'succeeded';
  await recovery.notify({
    gatewayEnvironment: 'test',
    institutionNo: gateway.institutionNo,
    merchantNo: gateway.merchantNo,
    payTraceNo: attempt.pay_trace_no,
    payTime: attempt.pay_time,
    amountCents: 2n,
    platformTradeNo: order.trade,
    resultCode: 'PAY_SUCCESS',
    returnCode: 'SUCCESS',
    attach: paymentId,
    eventFingerprint: createHash('sha256').update(order.trade).digest('hex'),
  });
  if (!counters.business) {
    assert.equal((await payments.admitCall(call)).replayed, false);
    counters.business++;
  }
  assert.equal((await payments.admitCall(call)).replayed, true);
  return {
    counters,
    payment: sdk ? await sdk.get(paymentId) : await recovery.view(paymentId, userId),
  };
});
await app.listen({ host: '127.0.0.1', port: Number(process.env.PORT ?? 17966) });
console.log(
  JSON.stringify({
    mode: 'Mixed: PostgreSQL/HTTP/UI real; session/provider/business fixtures',
    paymentId,
    url: `${base}/payments/${paymentId}?version=2`,
    sdkLoaded: !!sdk,
  }),
);
const timer = setInterval(() => void recovery.tick().catch(() => undefined), 3000);
async function stop() {
  clearInterval(timer);
  await app.close();
  await recovery.stop();
  await pool.end();
  await admin.end();
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
