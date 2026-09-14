import { createHash, randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPgPaymentStore } from '../payment-repo.js';
import { createPaymentTokenCodec } from '../payment-service.js';
import { createPgRecoveryStore, type ChannelAttempt } from '../recovery-repo.js';
import { createCheckoutRecovery } from '../recovery-service.js';
import { createPgChannelOrderStore } from '../channel-repo.js';
import { createPaymentChannelService } from '../channel-service.js';
import type {
  CreatePaymentCommand,
  RecoveryPaymentGateway,
  VerifiedPaymentNotification,
} from '../channel/index.js';
import { registerRecoveryRoutes } from '../recovery-routes.js';
import Fastify from 'fastify';

const database = process.env.BILLING_V2_TEST_DATABASE_URL;
const password = process.env.POSTGRES_BILLING_PASSWORD;
const suite =
  process.env.BILLING_V2_REPO_PG_TEST === '1' && database && password ? describe : describe.skip;
const scope = {
  environment: 'test' as const,
  institutionNo: 'RECOVERY_INST',
  merchantNo: 'RECOVERY_MERCHANT',
};
suite('recoverable checkout PostgreSQL and API', () => {
  let admin: Client, pool: Pool;
  const providerOrders = new Map<
    string,
    { command: CreatePaymentCommand; trade: string; status: 'pending' | 'failed' | 'succeeded' }
  >();
  beforeAll(async () => {
    admin = new Client({ connectionString: database });
    await admin.connect();
    const url = new URL(database!);
    url.username = 'combo_billing';
    url.password = password!;
    pool = new Pool({ connectionString: url.toString(), max: 12 });
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.end();
  });
  async function fixture(lostFirst = true) {
    const userId = randomUUID();
    await admin.query('INSERT INTO v2_users(id) VALUES($1)', [userId]);
    const payments = createPgPaymentStore(pool, {
      tokens: createPaymentTokenCodec('recovery-test-key-'.repeat(3)),
      checkoutBaseUrl: 'https://pay.test',
    });
    const call = {
      userId,
      agentId: 'recovery-test',
      operationId: randomUUID(),
      callId: randomUUID(),
      requestFingerprint: 'a'.repeat(64),
      pricingPolicyId: 'test',
      estimatedAmount: 2,
    };
    const required = await payments.admitCall(call);
    if (required.kind !== 'payment_required') throw Error('expected 402');
    const requestKey = randomUUID();
    await payments.createPayment({
      userId,
      paymentToken: required.requirement.paymentToken,
      requestKey,
    });
    const paymentId = required.requirement.id;
    const orders = providerOrders;
    let created = 0;
    let lostClose = false;
    const gateway: RecoveryPaymentGateway = {
      configured: true,
      ...scope,
      createPayment: vi.fn<RecoveryPaymentGateway['createPayment']>(async (command) => {
        const trade = `trade-${randomUUID()}`;
        orders.set(command.payTraceNo, { command, trade, status: 'pending' });
        if (lostFirst && ++created === 1)
          throw Error('controlled response loss after provider accepted');
        return {
          status: 'pending',
          platformTradeNo: trade,
          action: {
            kind: 'code_url',
            value: `qr-${trade}`,
            expiresAt: new Date(Date.now() + 600000),
          },
        };
      }),
      queryPayment: vi.fn<RecoveryPaymentGateway['queryPayment']>(async (command) => {
        const old = orders.get(command.payTraceNo);
        if (!old) return { status: 'unknown' };
        expect(command.payTime).toBe(old.command.payTime);
        expect(command.amountCents).toBe(2n);
        return { status: old.status, platformTradeNo: old.trade };
      }),
      closePayment: vi.fn<RecoveryPaymentGateway['closePayment']>(async (command) => {
        const old = orders.get(command.payTraceNo)!;
        expect(command.platformTradeNo).toBe(old.trade);
        old.status = 'failed';
        if (lostClose) throw Error('controlled lost close acknowledgement');
        return { status: 'closed' };
      }),
      verifyPaymentNotification: (input) => input as VerifiedPaymentNotification,
    };
    const store = createPgRecoveryStore(pool);
    const service = createCheckoutRecovery({
      store,
      payments,
      gateway,
      checkoutBaseUrl: 'https://pay.test',
    });
    const open = () => service.create(paymentId, userId, 'wechat');
    const recover = async () => {
      const before = (await service.view(paymentId, userId))!;
      const input = { expectedAttemptId: before.checkout.attemptId!, recoveryKey: randomUUID() };
      await service.recover(paymentId, userId, input);
      await service.stop();
      return input;
    };
    const paid = async (a: ChannelAttempt) => {
      const p = orders.get(a.pay_trace_no)!;
      p.status = 'succeeded';
      await service.notify({
        eventFingerprint: createHash('sha256').update(p.trade).digest('hex'),
        gatewayEnvironment: 'test',
        institutionNo: scope.institutionNo,
        merchantNo: scope.merchantNo,
        payTraceNo: a.pay_trace_no,
        payTime: a.pay_time,
        amountCents: 2n,
        platformTradeNo: p.trade,
        returnCode: 'SUCCESS',
        resultCode: 'PAY_SUCCESS',
        attach: paymentId,
        tradeType: '1',
      });
    };
    return {
      userId,
      paymentId,
      requestKey,
      payments,
      call,
      gateway,
      store,
      service,
      open,
      recover,
      paid,
      orders,
      loseClose: () => {
        lostClose = true;
      },
    };
  }
  it('recovers missing QR with one new channel identity, then admits the original call once', async () => {
    const f = await fixture();
    await f.open();
    const first = (await f.store.snapshot(f.paymentId, f.userId))!.attempt!;
    expect((await f.service.view(f.paymentId, f.userId))?.checkout.status).toBe('unknown');
    const input = await f.recover();
    const next = (await f.store.snapshot(f.paymentId, f.userId))!.attempt!;
    expect(next.attempt_no).toBe(2);
    expect(next.pay_trace_no).not.toBe(first.pay_trace_no);
    expect((await f.store.attempt(first.id))?.close_verified).toBe(true);
    expect((await f.store.attempt(first.id))?.closed_query_verified).toBe(true);
    expect((await f.service.view(f.paymentId, f.userId))?.checkout.status).toBe('ready');
    await f.service.recover(f.paymentId, f.userId, input);
    await f.service.stop();
    expect(f.gateway.createPayment).toHaveBeenCalledTimes(2);
    expect(f.gateway.closePayment).toHaveBeenCalledTimes(1);
    await f.paid(next);
    await f.paid(next);
    expect((await f.service.view(f.paymentId, f.userId))?.status).toBe('completed');
    const admitted = await f.payments.admitCall(f.call);
    expect(admitted.kind).toBe('admitted');
    expect(await f.payments.admitCall(f.call)).toMatchObject({ kind: 'admitted', replayed: true });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM v2_ledger WHERE user_id=$1 AND kind='recharge'",
          [f.userId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (await pool.query('SELECT count(*)::int n FROM v2_holds WHERE user_id=$1', [f.userId]))
        .rows[0].n,
    ).toBe(1);
  });
  it('serializes duplicate recovery requests and rejects changed/stale keys and other users', async () => {
    const f = await fixture();
    await f.open();
    const old = (await f.service.view(f.paymentId, f.userId))!.checkout.attemptId!;
    const input = { expectedAttemptId: old, recoveryKey: randomUUID() };
    await Promise.all(
      Array.from({ length: 8 }, () => f.service.recover(f.paymentId, f.userId, input)),
    );
    await f.service.stop();
    expect(f.gateway.createPayment).toHaveBeenCalledTimes(2);
    await expect(
      f.service.recover(f.paymentId, f.userId, { ...input, expectedAttemptId: randomUUID() }),
    ).rejects.toThrow();
    await expect(
      f.service.recover(f.paymentId, f.userId, {
        expectedAttemptId: old,
        recoveryKey: randomUUID(),
      }),
    ).rejects.toThrow();
    expect(await f.service.recover(f.paymentId, randomUUID(), input)).toBeNull();
  });
  it('does not resend prepay after a process stops with a committed dispatch intent', async () => {
    const f = await fixture(false);
    const p = await f.store.initial(f.paymentId, f.userId, scope, 'wechat');
    expect(p?.dispatch).toBe(true);
    const reopened = createCheckoutRecovery({
      store: f.store,
      payments: f.payments,
      gateway: f.gateway,
      checkoutBaseUrl: 'https://pay.test',
    });
    await reopened.create(f.paymentId, f.userId, 'wechat');
    expect(f.gateway.createPayment).not.toHaveBeenCalled();
    expect((await reopened.view(f.paymentId, f.userId))?.checkout.status).toBe('submitting');
  });
  it('keeps an unknown close acknowledgement in manual review instead of creating another order', async () => {
    const f = await fixture();
    await f.open();
    f.loseClose();
    await f.recover();
    expect((await f.service.view(f.paymentId, f.userId))?.checkout).toMatchObject({
      status: 'manual_review',
      canRecover: false,
    });
    await f.service.tick();
    expect(f.gateway.createPayment).toHaveBeenCalledTimes(1);
    expect(f.gateway.closePayment).toHaveBeenCalledTimes(1);
  });
  it('shares v1/v2 channel creation ownership inside the database transaction', async () => {
    const f = await fixture(false);
    const legacy = createPaymentChannelService({
      store: createPgChannelOrderStore(pool, { recovery: true }),
      payments: f.payments,
      gateway: f.gateway,
    });
    await Promise.all([
      legacy.create({ paymentId: f.paymentId, userId: f.userId, payType: 'wechat' }),
      f.open(),
    ]);
    expect(f.gateway.createPayment).toHaveBeenCalledTimes(1);
    expect((await f.service.view(f.paymentId, f.userId))?.checkout.status).toBe('ready');
  });
  it('preserves a late v1 QR response when its submitting order was adopted by v2', async () => {
    const f = await fixture(false);
    const original = f.gateway.createPayment;
    let release!: () => void, start!: () => void;
    const began = new Promise<void>((r) => {
      start = r;
    });
    const gate = new Promise<void>((r) => {
      release = r;
    });
    f.gateway.createPayment = vi.fn(async (cmd) => {
      start();
      await gate;
      return original(cmd);
    });
    const legacy = createPaymentChannelService({
      store: createPgChannelOrderStore(pool, { recovery: true }),
      payments: f.payments,
      gateway: f.gateway,
    });
    const sending = legacy.create({ paymentId: f.paymentId, userId: f.userId, payType: 'wechat' });
    await began;
    expect((await f.service.view(f.paymentId, f.userId))?.checkout.status).toBe('submitting');
    release();
    await sending;
    expect((await f.service.view(f.paymentId, f.userId))?.checkout.status).toBe('ready');
    expect((await f.service.qr(f.paymentId, f.userId))?.qrContent).toMatch(/^qr-/);
  });
  it('records exceptional second real payment as balanced pending customer funds, without a second business credit', async () => {
    const f = await fixture();
    await f.open();
    const old = (await f.store.snapshot(f.paymentId, f.userId))!.attempt!;
    await f.recover();
    const next = (await f.store.snapshot(f.paymentId, f.userId))!.attempt!;
    await f.paid(next);
    await f.paid(old);
    await f.paid(old);
    expect(
      (await pool.query('SELECT principal_balance FROM v2_wallets WHERE user_id=$1', [f.userId]))
        .rows[0].principal_balance,
    ).toBe('2');
    const exceptional = await pool.query(
      'SELECT account,amount FROM v2_payment_exception_entries WHERE user_id=$1 ORDER BY account',
      [f.userId],
    );
    expect(exceptional.rows).toEqual([
      { account: 'channel_clearing', amount: '2' },
      { account: 'customer_pending', amount: '-2' },
    ]);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM v2_payment_channel_receipts WHERE payment_id=$1 AND disposition='review_required'",
          [f.paymentId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect((await f.service.view(f.paymentId, f.userId))?.checkout.attemptId).toBe(next.id);
  });
  it('does not renew a v1 action when recovering an expired logical payment through v2', async () => {
    const userId = randomUUID(),
      call = randomUUID(),
      id = randomUUID();
    await admin.query('INSERT INTO v2_users(id) VALUES($1)', [userId]);
    await admin.query(
      "INSERT INTO v2_billable_calls(id,user_id,agent_id,operation_id,call_id,request_fingerprint,pricing_policy_id,estimated_amount) VALUES($1::uuid,$2,'expired-recovery',$1::text,$1::text,$3,'test',2)",
      [call, userId, 'b'.repeat(64)],
    );
    await admin.query(
      "INSERT INTO v2_payment_requests(id,call_ref,user_id,amount,token_digest,state,created_at,updated_at,expires_at) VALUES($1,$2,$3,2,$4,'waiting',now()-interval '20 minutes',now()-interval '20 minutes',now()-interval '5 minutes')",
      [id, call, userId, createHash('sha256').update(id).digest('hex')],
    );
    const f = await fixture(false);
    expect((await f.payments.getPayment({ userId, paymentRequestId: id }))?.status).toBe('closed');
    expect((await f.service.create(id, userId, 'wechat'))?.checkout.status).toBe('ready');
    expect((await f.payments.getPayment({ userId, paymentRequestId: id }))?.status).toBe('closed');
  });
  it('enforces identity, receipt ownership and signed-close/query evidence before another attempt', async () => {
    const f = await fixture();
    await f.open();
    const a = (await f.store.snapshot(f.paymentId, f.userId))!.attempt!;
    await expect(
      pool.query('UPDATE v2_payment_channel_attempts SET amount=3 WHERE id=$1', [a.id]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      admin.query('UPDATE v2_payment_channel_attempts SET pay_trace_no=$2 WHERE id=$1', [
        a.id,
        `cbr${randomUUID().replaceAll('-', '')}`,
      ]),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      pool.query(
        'INSERT INTO v2_payment_channel_receipts(channel_transaction_id,attempt_id,payment_id,amount) VALUES($1,$2,$3,3)',
        ['f'.repeat(64), a.id, f.paymentId],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await f.store.request(f.paymentId, f.userId, a.id, randomUUID());
    const job = await f.store.lease();
    expect(job).not.toBeNull();
    await expect(f.store.next(job!, scope)).rejects.toThrow();
    await f.store.manual(job!);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM v2_payment_channel_attempts WHERE payment_id=$1',
          [f.paymentId],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it('authenticates recovery APIs, rejects supplied prices and exposes v2 without changing v1', async () => {
    const f = await fixture();
    await f.open();
    const app = Fastify();
    registerRecoveryRoutes(app, {
      recovery: f.service,
      payments: f.payments,
      testMode: true,
      authenticateUser: async (req) => (req.headers.cookie === 'fixture-session' ? f.userId : null),
    });
    try {
      expect((await app.inject({ url: `/v2/payments/${f.paymentId}` })).statusCode).toBe(401);
      const headers = { cookie: 'fixture-session', origin: 'https://pay.test' };
      expect(
        (await app.inject({ url: `/v2/payments/${f.paymentId}`, headers })).json().data.version,
      ).toBe(2);
      const old = (await f.service.view(f.paymentId, f.userId))!.checkout.attemptId!;
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/v2/payments/${f.paymentId}/recover`,
            headers,
            payload: { expectedAttemptId: old, recoveryKey: randomUUID(), amountCents: 1 },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/v2/payments/${f.paymentId}/recover`,
            headers,
            payload: { expectedAttemptId: old, recoveryKey: randomUUID() },
          })
        ).statusCode,
      ).toBe(202);
      await f.service.stop();
      expect(
        (await app.inject({ url: `/v2/payment-checkouts/${f.paymentId}`, headers })).json().data
          .qrImage,
      ).toMatch(/^data:image\/png/);
    } finally {
      await app.close();
    }
  });
  it('caps recovery at three total channel attempts without replacing the business request', async () => {
    const f = await fixture();
    await f.open();
    await f.recover();
    const expire = async () => {
      const a = (await f.store.snapshot(f.paymentId, f.userId))!.attempt!;
      await admin.query(
        "UPDATE v2_payment_channel_attempts SET action_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [a.id],
      );
      return a;
    };
    await expire();
    await f.recover();
    const third = await expire();
    expect(third.attempt_no).toBe(3);
    expect((await f.service.view(f.paymentId, f.userId))?.checkout.canRecover).toBe(false);
    await expect(
      f.service.recover(f.paymentId, f.userId, {
        expectedAttemptId: third.id,
        recoveryKey: randomUUID(),
      }),
    ).rejects.toThrow();
    expect(f.gateway.createPayment).toHaveBeenCalledTimes(3);
  });
  it('retries a transient original query without sending close or a new prepay early', async () => {
    const f = await fixture();
    await f.open();
    const query = f.gateway.queryPayment;
    let fail = true;
    f.gateway.queryPayment = vi.fn(async (input) => {
      if (fail) {
        fail = false;
        throw Error('controlled transient query');
      }
      return query(input);
    });
    const input = await f.recover();
    expect(f.gateway.closePayment).not.toHaveBeenCalled();
    const job = (
      await admin.query(
        'SELECT id FROM v2_payment_recovery_jobs WHERE payment_id=$1 AND recovery_key=$2',
        [f.paymentId, input.recoveryKey],
      )
    ).rows[0];
    await admin.query(
      "UPDATE v2_payment_recovery_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [job.id],
    );
    await f.service.tick(job.id);
    expect((await f.service.view(f.paymentId, f.userId))?.checkout.status).toBe('ready');
    expect(f.gateway.createPayment).toHaveBeenCalledTimes(2);
  });
  it('fences an expired worker and never re-sends a possibly dispatched close', async () => {
    const f = await fixture();
    await f.open();
    const a = (await f.store.snapshot(f.paymentId, f.userId))!.attempt!;
    const requested = await f.store.request(f.paymentId, f.userId, a.id, randomUUID());
    const old = await f.store.lease(requested!.id);
    await f.store.phase(old!, 'closing');
    await admin.query(
      "UPDATE v2_payment_recovery_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [old!.id],
    );
    await f.service.tick(old!.id);
    await expect(f.store.phase(old!, 'requested')).rejects.toThrow();
    expect(f.gateway.closePayment).not.toHaveBeenCalled();
    expect(f.gateway.createPayment).toHaveBeenCalledTimes(1);
    expect((await f.service.view(f.paymentId, f.userId))?.checkout.status).toBe('manual_review');
  });
  it('stops replacement if the original order was already paid before recovery', async () => {
    const f = await fixture();
    await f.open();
    const a = (await f.store.snapshot(f.paymentId, f.userId))!.attempt!;
    f.orders.get(a.pay_trace_no)!.status = 'succeeded';
    await f.recover();
    expect((await f.service.view(f.paymentId, f.userId))?.status).toBe('completed');
    expect(f.gateway.createPayment).toHaveBeenCalledTimes(1);
    expect(f.gateway.closePayment).not.toHaveBeenCalled();
  });
});
