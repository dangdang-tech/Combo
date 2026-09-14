import { Pool } from 'pg';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { RechargeOrderViewSchema } from '@cb/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRechargeOrderHandler } from '../modules/billing/handlers.js';
import { PgBillingRepository } from '../modules/billing/repo.js';
import {
  BillingIdempotencyConflictError,
  BillingRateLimitedError,
} from '../modules/billing/types.js';
import { asTxPool } from '../platform/infra/db-tx.js';
import type { VerifiedPaymentNotification } from '../platform/infra/leshouying/index.js';

const enabled =
  process.env.BILLING_PG_TEST === '1' &&
  Boolean(process.env.BILLING_TEST_DATABASE_URL && process.env.BILLING_AUTHORING_TEST_DATABASE_URL);
const pgDescribe = enabled ? describe : describe.skip;

pgDescribe('billing PostgreSQL concurrency invariants', () => {
  let pool: Pool;
  let apiPool: Pool;
  let repository: PgBillingRepository;
  let ownerId: string;
  let runId: string;
  const intentIds = new Map<string, string>();

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.BILLING_TEST_DATABASE_URL,
      max: 6,
    });
    apiPool = new Pool({
      connectionString: process.env.BILLING_AUTHORING_TEST_DATABASE_URL,
      max: 6,
    });
    const identity = await apiPool.query<{ current_user: string }>(
      'SELECT current_user::text AS current_user',
    );
    if (identity.rows[0]?.current_user !== 'combo_api') {
      throw new Error('billing authoring test connection must use combo_api');
    }
    const schema = await pool.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name IN (
            'billing_accounts',
            'recharge_orders',
            'payment_attempts',
            'payment_callback_events',
            'wallet_ledger'
          )`,
    );
    if (schema.rows.length !== 5) throw new Error('billing migration is not applied');
    repository = new PgBillingRepository(asTxPool(apiPool), apiPool);
  });

  afterAll(async () => {
    await Promise.all([pool?.end(), apiPool?.end()]);
  });

  beforeEach(async () => {
    intentIds.clear();
    ownerId = randomUUID();
    runId = randomBytes(12).toString('hex');
    const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
    const accountSuffix = [...randomBytes(8)]
      .map((value) => alphabet[value % alphabet.length])
      .join('');
    await pool.query(
      `INSERT INTO users (id, account)
       VALUES ($1, $2)`,
      [ownerId, `creator-${accountSuffix}`],
    );
  });

  async function prepareOrder(suffix: string, rechargeIntentId: string, amountCents = 300n) {
    const identity = `${runId}-${suffix}`;
    return repository.prepareRecharge({
      orderNo: `CBR-PG-${identity}`,
      ownerUserId: ownerId,
      clientIdempotencyKey: rechargeIntentId,
      packageId: 'manual',
      amountCents,
      paymentMethod: 'qr',
      payType: 'alipay',
      gatewayEnvironment: 'test',
      institutionNo: 'INST0001',
      merchantNo: 'MCH_TEST_001',
      payTraceNo: `TRACE-PG-${identity}`,
      payTime: '20260728120000',
      requestFingerprint: createHash('sha256').update(identity).digest('hex'),
      submissionRecoveryMs: 10_000,
    });
  }

  async function prepare(suffix: string) {
    const rechargeIntentId = intentIds.get(suffix) ?? randomUUID();
    intentIds.set(suffix, rechargeIntentId);
    return prepareOrder(suffix, rechargeIntentId);
  }

  function notification(
    order: Awaited<ReturnType<typeof prepare>>['order'],
    fingerprint: string,
    tradeNo: string,
  ): VerifiedPaymentNotification {
    return {
      eventFingerprint: fingerprint,
      gatewayEnvironment: 'test',
      institutionNo: 'INST0001',
      merchantNo: 'MCH_TEST_001',
      payTraceNo: order.payTraceNo,
      payTime: order.payTime,
      amountCents: order.amountCents,
      platformTradeNo: tradeNo,
      resultCode: 'PAY_SUCCESS',
      returnCode: 'SUCCESS',
      tradeType: '1',
      attach: order.orderNo,
      paidAt: new Date(),
    };
  }

  async function invokeCreateHandler(body: Record<string, unknown>) {
    const createPayment = vi.fn(async () => ({
      status: 'pending' as const,
      action: {
        kind: 'code_url' as const,
        value: 'https://qr.alipay.com/opaque',
        expiresAt: new Date(Date.now() + 60_000),
      },
    }));
    const reply = {
      statusCode: 200,
      body: undefined as unknown,
      code(statusCode: number) {
        this.statusCode = statusCode;
        return this;
      },
      send(responseBody: unknown) {
        this.body = responseBody;
        return this;
      },
    };
    const request = {
      id: `trace-${randomUUID()}`,
      auth: { userId: ownerId },
      body,
      log: { error: vi.fn() },
      server: {
        infra: {
          db: apiPool,
          billing: { gatewayEnabled: true, submissionRecoveryMs: 10_000 },
          paymentGateway: {
            configured: true,
            environment: 'test',
            institutionNo: 'INST0001',
            merchantNo: 'MCH_TEST_001',
            createPayment,
            queryPayment: vi.fn(),
            verifyPaymentNotification: vi.fn(),
          },
        },
      },
    };
    await createRechargeOrderHandler().call({} as never, request as never, reply as never);
    return { createPayment, reply };
  }

  it('preserves ordinary intent-only creation without a recovery binding', async () => {
    const rechargeIntentId = randomUUID();
    const created = await prepareOrder('legacy-no-recovery', rechargeIntentId);
    const replayed = await prepareOrder('legacy-no-recovery', rechargeIntentId);

    expect(created).toMatchObject({ created: true, shouldSubmit: true });
    expect(created.order.recoveryUsageId).toBeUndefined();
    expect(replayed).toMatchObject({ created: false, shouldSubmit: false });
    expect(replayed.order.id).toBe(created.order.id);

    const persisted = await pool.query<{ recovery_usage_id: string | null }>(
      'SELECT recovery_usage_id FROM recharge_orders WHERE id = $1',
      [created.order.id],
    );
    expect(persisted.rows[0]).toEqual({ recovery_usage_id: null });
  });

  it('commits and serializes the ordinary create response for the existing client schema', async () => {
    const rechargeIntentId = randomUUID();
    const { createPayment, reply } = await invokeCreateHandler({
      rechargeIntentId,
      amountCents: 500,
      channel: 'qr',
      payType: 'alipay',
    });

    expect(reply.statusCode).toBe(201);
    const envelope = reply.body as { data: unknown; meta: { traceId: string } };
    const view = RechargeOrderViewSchema.parse(envelope.data);
    expect(view).toMatchObject({ rechargeIntentId, amountCents: '500', status: 'pending' });
    expect(envelope.data).not.toHaveProperty('recoveryUsageId');
    expect(createPayment).toHaveBeenCalledTimes(1);
    const committed = await pool.query<{ recovery_usage_id: string | null }>(
      `SELECT recovery_usage_id FROM recharge_orders WHERE id = $1`,
      [view.id],
    );
    expect(committed.rows).toEqual([{ recovery_usage_id: null }]);
  });

  it('rejects retired recovery input before creating an order or submitting payment', async () => {
    const { reply, createPayment } = await invokeCreateHandler({
      recoveryUsageId: randomUUID(),
      rechargeIntentId: randomUUID(),
      amountCents: 300,
      channel: 'qr',
      payType: 'alipay',
    });
    expect(reply.statusCode).toBe(400);
    expect(createPayment).not.toHaveBeenCalled();
    expect(
      (await pool.query('SELECT id FROM recharge_orders WHERE owner_user_id = $1', [ownerId])).rows,
    ).toEqual([]);
  });

  it('keeps a fresh submitting order untouched, then recovers the stale trace by query lease', async () => {
    const prepared = await prepare('stale-submit');
    const repeated = await prepare('stale-submit');
    expect(prepared).toMatchObject({ shouldSubmit: true, created: true });
    expect(repeated).toMatchObject({ shouldSubmit: false, created: false });
    expect(repeated.order.paymentStatus).toBe('created');

    await expect(
      repository.leaseRechargeOrderForOwner({
        ownerUserId: ownerId,
        orderId: prepared.order.id,
        leaseOwner: 'fresh-submit-must-not-query',
        leaseMs: 30_000,
      }),
    ).resolves.toBeNull();

    await pool.query(`UPDATE recharge_orders SET next_query_at = now() WHERE id = $1`, [
      prepared.order.id,
    ]);
    const leased = await repository.leaseRechargeOrderForOwner({
      ownerUserId: ownerId,
      orderId: prepared.order.id,
      leaseOwner: 'stale-submit-query-original',
      leaseMs: 30_000,
    });
    expect(leased).toMatchObject({
      id: prepared.order.id,
      payTraceNo: prepared.order.payTraceNo,
      paymentStatus: 'unknown',
    });
    const attempt = await pool.query<{ status: string }>(
      `SELECT status
         FROM payment_attempts
        WHERE recharge_order_id = $1 AND attempt_no = 1`,
      [prepared.order.id],
    );
    expect(attempt.rows[0]?.status).toBe('unknown');
  });

  it('serializes concurrent idempotent preparation into exactly one gateway submission owner', async () => {
    const prepared = await Promise.all([prepare('prepare-race'), prepare('prepare-race')]);
    expect(prepared.filter((result) => result.shouldSubmit)).toHaveLength(1);
    expect(prepared.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(prepared.map((result) => result.order.id)).size).toBe(1);
    expect(new Set(prepared.map((result) => result.order.payTraceNo)).size).toBe(1);
    const linked = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM recharge_orders
       WHERE owner_user_id = $1 AND client_idempotency_key = $2 AND recovery_usage_id IS NULL`,
      [ownerId, intentIds.get('prepare-race')],
    );
    expect(linked.rows[0]?.count).toBe('1');
  });

  it('rejects a changed amount for the same ordinary recharge intent', async () => {
    const intent = randomUUID();
    const first = await prepareOrder('amount-conflict', intent);
    await expect(prepareOrder('amount-conflict', intent, 301n)).rejects.toBeInstanceOf(
      BillingIdempotencyConflictError,
    );
    await expect(repository.findRechargeOrderByIntent(ownerId, intent)).resolves.toMatchObject({
      id: first.order.id,
      amountCents: 300n,
    });
  });

  it('credits a late-successful failed order once after a new ordinary intent was created', async () => {
    const first = await prepare('late-first');
    await repository.recordSubmission(first.order.id, first.order.attemptNo, {
      status: 'failed',
      gatewayResultCode: 'PAY_FAIL',
    });
    const newer = await prepare('late-newer');
    const eventFingerprint = createHash('sha256').update(`${runId}:late-first`).digest('hex');
    const trusted = notification(first.order, eventFingerprint, `TRADE-PG-${runId}-LATE`);
    await expect(repository.processNotification(trusted)).resolves.toBe('processed');
    await expect(repository.processNotification(trusted)).resolves.toBe('duplicate');
    await expect(repository.findRechargeOrder(ownerId, first.order.id)).resolves.toMatchObject({
      id: first.order.id,
      creditStatus: 'credited',
    });
    await expect(
      repository.findRechargeOrderByIntent(ownerId, intentIds.get('late-first')!),
    ).resolves.toMatchObject({ id: first.order.id, creditStatus: 'credited' });
    await expect(
      repository.findRechargeOrderByIntent(ownerId, intentIds.get('late-newer')!),
    ).resolves.toMatchObject({ id: newer.order.id, creditStatus: 'uncredited' });
    await expect(repository.getWallet(ownerId)).resolves.toEqual({
      availableCents: 300n,
      reservedCents: 0n,
    });
    const state = await pool.query<{ credit_count: string; event_count: string }>(
      `SELECT
        (SELECT count(*)::text FROM wallet_ledger
          WHERE recharge_order_id = $1 AND entry_type = 'recharge_credit') AS credit_count,
        (SELECT count(*)::text FROM payment_callback_events
          WHERE event_fingerprint = $2 AND processing_status = 'processed') AS event_count`,
      [first.order.id, eventFingerprint],
    );
    expect(state.rows[0]).toEqual({ credit_count: '1', event_count: '1' });
  });

  it('admits only three active orders per owner while preserving same-intent replay', async () => {
    const first = await prepare('active-1');
    await prepare('active-2');
    await prepare('active-3');

    await expect(prepare('active-1')).resolves.toMatchObject({
      created: false,
      shouldSubmit: false,
      order: { id: first.order.id },
    });
    await expect(prepare('active-4')).rejects.toBeInstanceOf(BillingRateLimitedError);

    await pool.query(`UPDATE recharge_orders SET next_query_at = NULL WHERE id = $1`, [
      first.order.id,
    ]);
    await expect(prepare('active-4')).resolves.toMatchObject({
      created: true,
      shouldSubmit: true,
    });
  });

  it('bounds failed recharge-order creation per owner over a rolling hour', async () => {
    for (let index = 0; index < 10; index += 1) {
      const prepared = await prepare(`hourly-${index}`);
      await repository.recordSubmission(prepared.order.id, prepared.order.attemptNo, {
        status: 'failed',
        gatewayResultCode: 'PAY_FAIL',
      });
    }

    await expect(prepare('hourly-over-limit')).rejects.toMatchObject({
      name: 'BillingRateLimitedError',
      retryAfterSeconds: 3_600,
    });
  });

  it('retires exhausted query compensation but still credits a later trusted callback', async () => {
    const prepared = await prepare('query-cutoff');
    await pool.query(
      `UPDATE recharge_orders
          SET next_query_at = now(), query_attempt_count = 120
        WHERE id = $1`,
      [prepared.order.id],
    );

    await expect(repository.retireExpiredReconciliations({ limit: 1 })).resolves.toBe(1);
    await expect(repository.findRechargeOrder(ownerId, prepared.order.id)).resolves.toMatchObject({
      reconciliationActive: false,
      paymentStatus: 'created',
      creditStatus: 'uncredited',
    });

    await expect(
      repository.processNotification(
        notification(
          prepared.order,
          createHash('sha256').update(`${runId}:late-callback`).digest('hex'),
          `TRADE-PG-${runId}-LATE`,
        ),
      ),
    ).resolves.toBe('processed');
    await expect(repository.getWallet(ownerId)).resolves.toEqual({
      availableCents: 300n,
      reservedCents: 0n,
    });
  });

  it('keeps the first trusted platform order identity across late POST and query races', async () => {
    const callbackFirst = await prepare('pending-callback-first');
    await expect(
      repository.processNotification({
        ...notification(
          callbackFirst.order,
          createHash('sha256').update(`${runId}:pending-first`).digest('hex'),
          `TRADE-PG-${runId}-BOUND`,
        ),
        resultCode: 'PAY_IN_PROCESS',
      }),
    ).resolves.toBe('processed');
    await expect(
      repository.recordSubmission(callbackFirst.order.id, callbackFirst.order.attemptNo, {
        status: 'pending',
        platformTradeNo: `TRADE-PG-${runId}-LATE-POST`,
      }),
    ).resolves.toMatchObject({ platformTradeNo: `TRADE-PG-${runId}-BOUND` });
    await expect(
      repository.recordSubmission(callbackFirst.order.id, callbackFirst.order.attemptNo, {
        status: 'failed',
        gatewayResultCode: 'PAY_FAIL',
      }),
    ).resolves.toMatchObject({
      paymentStatus: 'pending',
      platformTradeNo: `TRADE-PG-${runId}-BOUND`,
      reconciliationActive: true,
    });
    const callbackFirstAttempt = await pool.query<{ status: string }>(
      `SELECT status
         FROM payment_attempts
        WHERE recharge_order_id = $1 AND attempt_no = 1`,
      [callbackFirst.order.id],
    );
    expect(callbackFirstAttempt.rows[0]?.status).toBe('pending');

    const queryRace = await prepare('query-identity-race');
    await pool.query(`UPDATE recharge_orders SET next_query_at = now() WHERE id = $1`, [
      queryRace.order.id,
    ]);
    const leased = await repository.leaseRechargeOrderForOwner({
      ownerUserId: ownerId,
      orderId: queryRace.order.id,
      leaseOwner: 'query-identity-race',
      leaseMs: 30_000,
    });
    expect(leased).not.toBeNull();
    if (!leased) return;
    await repository.recordSubmission(queryRace.order.id, queryRace.order.attemptNo, {
      status: 'pending',
      platformTradeNo: `TRADE-PG-${runId}-POST-WINS`,
    });
    await repository.applyQueryResult(leased, {
      status: 'failed',
      gatewayResultCode: 'PAY_FAIL',
    });

    const state = await pool.query<{
      order_trade_no: string;
      attempt_trade_no: string;
      payment_status: string;
      query_lease_owner: string | null;
    }>(
      `SELECT ro.platform_trade_no AS order_trade_no,
              pa.platform_trade_no AS attempt_trade_no,
              ro.payment_status,
              ro.query_lease_owner
         FROM recharge_orders ro
         JOIN payment_attempts pa ON pa.recharge_order_id = ro.id AND pa.attempt_no = 1
        WHERE ro.id = $1`,
      [queryRace.order.id],
    );
    expect(state.rows[0]).toEqual({
      order_trade_no: `TRADE-PG-${runId}-POST-WINS`,
      attempt_trade_no: `TRADE-PG-${runId}-POST-WINS`,
      payment_status: 'unknown',
      query_lease_owner: null,
    });
  });

  it('clears expired bearer payment actions in bounded batches', async () => {
    const prepared = await prepare('expired-action');
    await repository.recordSubmission(prepared.order.id, prepared.order.attemptNo, {
      status: 'pending',
      action: {
        kind: 'code_url',
        value: 'opaque-expired-action',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await pool.query(
      `UPDATE payment_attempts
          SET started_at = now() - interval '2 minutes',
              action_expires_at = now() - interval '1 minute'
        WHERE recharge_order_id = $1`,
      [prepared.order.id],
    );

    await expect(repository.clearExpiredPaymentActions({ limit: 1 })).resolves.toBe(1);
    const action = await pool.query<{
      action_kind: string | null;
      action_value: string | null;
      action_expires_at: Date | null;
    }>(
      `SELECT action_kind, action_value, action_expires_at
         FROM payment_attempts
        WHERE recharge_order_id = $1`,
      [prepared.order.id],
    );
    expect(action.rows[0]).toEqual({
      action_kind: null,
      action_value: null,
      action_expires_at: null,
    });
  });

  it('serializes callback and query credit into one balance increment and one ledger row', async () => {
    const prepared = await prepare('race-credit');
    await repository.recordSubmission(prepared.order.id, prepared.order.attemptNo, {
      status: 'pending',
      action: {
        kind: 'code_url',
        value: 'opaque-test-action',
        expiresAt: new Date(Date.now() + 15 * 60 * 1_000),
      },
    });
    await pool.query(`UPDATE recharge_orders SET next_query_at = now() WHERE id = $1`, [
      prepared.order.id,
    ]);
    const leased = await repository.leaseRechargeOrderForOwner({
      ownerUserId: ownerId,
      orderId: prepared.order.id,
      leaseOwner: 'pg-race-query',
      leaseMs: 30_000,
    });
    expect(leased).not.toBeNull();
    if (!leased) return;

    const callback = notification(
      prepared.order,
      createHash('sha256').update(`${runId}:callback-race`).digest('hex'),
      `TRADE-PG-${runId}-RACE`,
    );
    await Promise.all([
      repository.processNotification(callback),
      repository.applyQueryResult(leased, {
        status: 'succeeded',
        gatewayResultCode: 'PAY_SUCCESS',
        platformTradeNo: `TRADE-PG-${runId}-RACE`,
        paidAt: new Date(),
      }),
    ]);

    const state = await pool.query<{
      balance_cents: string;
      credit_status: string;
      payment_status: string;
      ledger_count: number;
    }>(
      `SELECT ba.balance_cents::text,
              ro.credit_status,
              ro.payment_status,
              (
                SELECT count(*)::int
                  FROM wallet_ledger wl
                 WHERE wl.recharge_order_id = ro.id
              ) AS ledger_count
         FROM recharge_orders ro
         JOIN billing_accounts ba ON ba.owner_user_id = ro.owner_user_id
        WHERE ro.id = $1`,
      [prepared.order.id],
    );
    expect(state.rows[0]).toEqual({
      balance_cents: '300',
      credit_status: 'credited',
      payment_status: 'succeeded',
      ledger_count: 1,
    });
  });

  it('keeps success terminal when callback commits before the pre-order response is saved', async () => {
    const prepared = await prepare('callback-first');
    await expect(
      repository.processNotification(
        notification(
          prepared.order,
          createHash('sha256').update(`${runId}:callback-first`).digest('hex'),
          `TRADE-PG-${runId}-FIRST`,
        ),
      ),
    ).resolves.toBe('processed');

    const late = await repository.recordSubmission(prepared.order.id, prepared.order.attemptNo, {
      status: 'pending',
      action: {
        kind: 'code_url',
        value: 'late-opaque-action',
        expiresAt: new Date(Date.now() + 15 * 60 * 1_000),
      },
    });
    expect(late).toMatchObject({
      paymentStatus: 'succeeded',
      creditStatus: 'credited',
      platformTradeNo: `TRADE-PG-${runId}-FIRST`,
    });
    const count = await pool.query<{ balance: string; ledger_count: number }>(
      `SELECT ba.balance_cents::text AS balance,
              count(wl.id)::int AS ledger_count
         FROM billing_accounts ba
         JOIN wallet_ledger wl ON wl.owner_user_id = ba.owner_user_id
        WHERE ba.owner_user_id = $1
        GROUP BY ba.balance_cents`,
      [ownerId],
    );
    expect(count.rows[0]).toEqual({ balance: '300', ledger_count: 1 });
  });

  it('0010 upgrade converts stored aggregate_qr rows and tightens the channel constraint', async () => {
    const client = await pool.connect();
    try {
      // 复刻 0010 的约束演进：旧 CHECK 只允许 h5/aggregate_qr → 迁移存量行 → 收紧为 h5/qr。
      await client.query(`
        CREATE TEMP TABLE recharge_orders_upgrade_test (
          id uuid PRIMARY KEY,
          payment_method text NOT NULL,
          CONSTRAINT ck_test_payment_method
            CHECK (payment_method IN ('h5', 'aggregate_qr'))
        )
      `);
      const legacyId = randomUUID();
      await client.query(
        `INSERT INTO recharge_orders_upgrade_test (id, payment_method)
         VALUES ($1, 'aggregate_qr')`,
        [legacyId],
      );
      await client.query(
        'ALTER TABLE recharge_orders_upgrade_test DROP CONSTRAINT ck_test_payment_method',
      );
      await client.query(
        `UPDATE recharge_orders_upgrade_test
            SET payment_method = 'qr'
          WHERE payment_method = 'aggregate_qr'`,
      );
      await client.query(
        `ALTER TABLE recharge_orders_upgrade_test
          ADD CONSTRAINT ck_test_payment_method CHECK (payment_method IN ('h5', 'qr'))`,
      );

      const converted = await client.query<{ payment_method: string }>(
        `SELECT payment_method FROM recharge_orders_upgrade_test WHERE id = $1`,
        [legacyId],
      );
      expect(converted.rows[0]?.payment_method).toBe('qr');

      await expect(
        client.query(
          `INSERT INTO recharge_orders_upgrade_test (id, payment_method) VALUES ($1, 'aggregate_qr')`,
          [randomUUID()],
        ),
      ).rejects.toThrow();
      await client.query(
        `INSERT INTO recharge_orders_upgrade_test (id, payment_method) VALUES ($1, 'qr')`,
        [randomUUID()],
      );
    } finally {
      client.release();
    }
  });

  it('0011 upgrade migrates h5 rows and allows only qr', async () => {
    const client = await pool.connect();
    try {
      // 复刻 0011 的约束演进：承接 0010 的 h5/qr → 迁移存量 h5 → 收紧为只允许 qr。
      await client.query(`
        CREATE TEMP TABLE recharge_orders_0011_test (
          id uuid PRIMARY KEY,
          payment_method text NOT NULL,
          CONSTRAINT ck_test_0011_payment_method
            CHECK (payment_method IN ('h5', 'qr'))
        )
      `);
      const legacyH5Id = randomUUID();
      const qrId = randomUUID();
      await client.query(
        `INSERT INTO recharge_orders_0011_test (id, payment_method) VALUES ($1, 'h5'), ($2, 'qr')`,
        [legacyH5Id, qrId],
      );
      await client.query(
        `UPDATE recharge_orders_0011_test
            SET payment_method = 'qr'
          WHERE payment_method <> 'qr'`,
      );
      await client.query(
        'ALTER TABLE recharge_orders_0011_test DROP CONSTRAINT ck_test_0011_payment_method',
      );
      await client.query(
        `ALTER TABLE recharge_orders_0011_test
          ADD CONSTRAINT ck_test_0011_payment_method CHECK (payment_method IN ('qr'))`,
      );

      const converted = await client.query<{ payment_method: string }>(
        `SELECT payment_method FROM recharge_orders_0011_test WHERE id = $1`,
        [legacyH5Id],
      );
      expect(converted.rows[0]?.payment_method).toBe('qr');

      await expect(
        client.query(
          `INSERT INTO recharge_orders_0011_test (id, payment_method) VALUES ($1, 'h5')`,
          [randomUUID()],
        ),
      ).rejects.toThrow();
      await client.query(
        `INSERT INTO recharge_orders_0011_test (id, payment_method) VALUES ($1, 'qr')`,
        [randomUUID()],
      );
    } finally {
      client.release();
    }
  });
});
