import {
  RecoverablePaymentViewSchema,
  type RecoverablePaymentView,
  type RecoverPaymentBody,
} from '@cb/payment-protocol';
import type { PaymentStore } from './payment-service.js';
import type { RecoveryPaymentGateway, PaymentQueryResult } from './channel/index.js';
import { PaymentGatewayUncertainError, type PaymentFailureReason } from './channel/index.js';
import { ChannelConflictError } from './channel-service.js';
import type { PaymentChannelService } from './checkout-service.js';
import {
  MAX_PAYMENT_ATTEMPTS,
  RECOVERY_WINDOW_MS,
  type RecoveryStore,
  type ChannelAttempt,
  type RecoveryJob,
} from './recovery-repo.js';

export interface RecoveryDependencies {
  store: RecoveryStore;
  payments: PaymentStore;
  gateway: RecoveryPaymentGateway;
  checkoutBaseUrl: string;
  log?(event: {
    phase: string;
    outcome: string;
    attemptId: string;
    reason?: PaymentFailureReason;
  }): void;
}

export function createCheckoutRecovery(options: RecoveryDependencies) {
  const { store, payments, gateway } = options;
  const scope = {
    environment: gateway.environment,
    institutionNo: gateway.institutionNo,
    merchantNo: gateway.merchantNo,
  };
  const matches = (a: ChannelAttempt) =>
    a.gateway_environment === scope.environment &&
    a.institution_no === scope.institutionNo &&
    a.merchant_no === scope.merchantNo;
  const command = (a: ChannelAttempt) => ({
    payTraceNo: a.pay_trace_no,
    payTime: a.pay_time,
    amountCents: BigInt(a.amount),
    ...(a.platform_trade_no ? { platformTradeNo: a.platform_trade_no } : {}),
  });
  async function event(
    a: ChannelAttempt,
    phase: Parameters<RecoveryStore['event']>[1],
    outcome: Parameters<RecoveryStore['event']>[2],
    reason?: PaymentFailureReason,
  ) {
    const id = await store.event(a.id, phase, outcome, reason);
    try {
      options.log?.({ phase, outcome, attemptId: a.id, ...(reason ? { reason } : {}) });
    } catch {
      /* A log sink cannot change payment state. */
    }
    return id;
  }
  async function credit(a: ChannelAttempt, transaction: string) {
    const result = await payments.confirmPayment({
      paymentRequestId: a.payment_id,
      channelTransactionId: transaction,
      amountCents: Number(a.amount),
    });
    await store.disposition(
      transaction,
      result.kind === 'completed' ? 'applied' : 'review_required',
    );
    await event(a, 'credit', result.kind === 'completed' ? 'stored' : 'manual_review');
  }
  async function accepted(a: ChannelAttempt, result: PaymentQueryResult) {
    if (!matches(a)) throw new ChannelConflictError();
    if (result.status === 'succeeded') {
      if (!result.platformTradeNo) throw new ChannelConflictError();
      // Persist the incoming money fact BEFORE updating views or attempting accounting.
      const transaction = await store.receipt(a, result.platformTradeNo);
      await store.recordQuery(a, result);
      await credit(a, transaction);
    } else await store.recordQuery(a, result);
  }
  async function query(a: ChannelAttempt) {
    if (!matches(a)) throw new ChannelConflictError();
    let result: PaymentQueryResult;
    try {
      result = await gateway.queryPayment(command(a));
    } catch (error) {
      await event(
        a,
        'query',
        'unknown',
        error instanceof PaymentGatewayUncertainError ? error.reason : 'transport_error',
      );
      throw error;
    }
    await accepted(a, result);
    const recoveryEventId = await event(a, 'query', result.status);
    return { ...result, recoveryEventId };
  }
  async function dispatch(a: ChannelAttempt) {
    if (!matches(a)) throw new ChannelConflictError();
    const snapshot = await store.snapshot(a.payment_id, a.user_id);
    if (!snapshot || snapshot.payment.state === 'completed' || snapshot.needsReview) return;
    // The submitting row is already committed. Neither a request replay nor a new worker re-sends it.
    await event(a, 'prepay', 'started');
    let result;
    try {
      result = await gateway.createPayment({
        ...command(a),
        orderNo: a.payment_id,
        channel: 'qr',
        payType: a.pay_type,
      });
    } catch (error) {
      await event(
        a,
        'prepay',
        'unknown',
        error instanceof PaymentGatewayUncertainError ? error.reason : 'transport_error',
      );
      result = { status: 'unknown' as const };
    }
    await event(a, 'prepay', result.status);
    try {
      const saved = await store.recordSubmission(a, result);
      await event(a, 'persist_prepay', saved ? 'stored' : 'unknown');
    } catch (error) {
      await event(a, 'persist_prepay', 'unknown', 'storage_error').catch(() => undefined);
      throw error;
    }
  }
  async function view(id: string, userId: string): Promise<RecoverablePaymentView | null> {
    const snapshot = await store.snapshot(id, userId);
    if (!snapshot) return null;
    const { payment: p, attempt: a } = snapshot;
    const now = Date.now();
    const until = p.created_at.getTime() + RECOVERY_WINDOW_MS;
    const completed = p.state === 'completed';
    const status = completed ? 'completed' : now >= until ? 'closed' : 'unpaid';
    let state: RecoverablePaymentView['checkout']['status'] = 'not_started';
    if (a) {
      if (completed) state = 'paid';
      else if (a.state === 'pending')
        state =
          a.qr_content && a.action_expires_at && a.action_expires_at.getTime() > now
            ? 'ready'
            : 'missing_qr';
      else state = a.state === 'succeeded' ? 'paid' : a.state;
      if (
        !completed &&
        (snapshot.needsReview ||
          (a.attempt_no >= MAX_PAYMENT_ATTEMPTS &&
            ['missing_qr', 'unknown', 'closed'].includes(state)))
      )
        state = 'manual_review';
    }
    // Payment completion always comes from the accounting transaction, never from prepay or close.
    if (completed && !a) throw new ChannelConflictError();
    const canRecover =
      status === 'unpaid' &&
      !!a &&
      a.attempt_no < MAX_PAYMENT_ATTEMPTS &&
      ['missing_qr', 'unknown', 'closed'].includes(state);
    return RecoverablePaymentViewSchema.parse({
      version: 2,
      paymentRequestId: p.id,
      status,
      amount: { currency: 'CNY', amountCents: p.amount },
      createdAt: p.created_at.toISOString(),
      updatedAt: new Date(
        Math.max(p.updated_at.getTime(), a?.updated_at.getTime() ?? 0),
      ).toISOString(),
      recoverableUntil: new Date(until).toISOString(),
      checkout: {
        ...(a ? { attemptId: a.id, expiresAt: a.expires_at.toISOString() } : {}),
        status: state,
        canRecover,
      },
      ...(status === 'unpaid'
        ? {
            action: {
              kind: 'open_url',
              url: `${options.checkoutBaseUrl}/payments/${p.id}?version=2`,
              expiresAt: new Date(Math.min(until, now + 15 * 60_000)).toISOString(),
            },
          }
        : {}),
    });
  }
  async function work(job: RecoveryJob) {
    const old = await store.attempt(job.source_attempt_id);
    if (!old || !matches(old)) throw new ChannelConflictError();
    const root = await store.snapshot(job.payment_id, job.user_id);
    if (root?.payment.state === 'completed') {
      await store.phase(job, 'done');
      return;
    }
    if (root?.needsReview) {
      await store.manual(job);
      return;
    }
    if (job.phase === 'creating') {
      if (job.result_attempt_id) {
        const a = await store.attempt(job.result_attempt_id);
        if (a) await query(a); // A crashed prepay dispatch is only queried, never replayed.
      }
      await store.phase(job, 'done');
      return;
    }
    if (job.phase === 'closing' && !old.close_verified) {
      // A lease expiry cannot establish whether close was sent or accepted.
      await query(old);
      await store.manual(job);
      return;
    }
    if (job.phase === 'requested') {
      const first = await query(old);
      if (first.status === 'succeeded') {
        await store.phase(job, 'done');
        return;
      }
      const refreshed = await store.attempt(old.id);
      if (!refreshed?.platform_trade_no || first.status === 'unknown') {
        await store.retryQuery(job);
        return;
      }
      await store.phase(job, 'closing');
      await event(old, 'close', 'started');
      let closed;
      try {
        closed = await gateway.closePayment({
          ...command(refreshed),
          closeTraceNo: job.close_trace_no,
          closeTime: job.close_time,
        });
      } catch (error) {
        await event(
          old,
          'close',
          'unknown',
          error instanceof PaymentGatewayUncertainError ? error.reason : 'transport_error',
        );
        throw error;
      }
      if (closed.status !== 'closed') {
        await store.manual(job);
        return;
      }
      const closeEventId = await event(old, 'close', 'succeeded');
      await store.verifiedClose(job, closeEventId);
    }
    const closedQuery = await query((await store.attempt(old.id))!);
    if (closedQuery.status === 'succeeded') {
      await store.phase(job, 'done');
      return;
    }
    if (closedQuery.status !== 'failed') {
      await store.retryQuery(job);
      return;
    }
    if (!closedQuery.platformTradeNo) {
      await store.manual(job);
      return;
    }
    await store.verifiedFailure(job, closedQuery.recoveryEventId, closedQuery.platformTradeNo);
    const next = await store.next(job, scope);
    if (next?.dispatch) {
      await store.phase(job, 'creating'); // Fence a paused worker immediately before its only dispatch.
      await dispatch(next.attempt);
    }
    await store.phase(job, 'done');
  }
  let running: Promise<void> | undefined;
  async function tick(jobId?: string) {
    if (running) return running;
    running = (async () => {
      for (const receipt of await store.pendingReceipts()) {
        const a = await store.attempt(receipt.attempt_id);
        if (a) await credit(a, receipt.channel_transaction_id);
      }
      const job = await store.lease(jobId);
      if (job) {
        try {
          await work(job);
        } catch {
          try {
            if (job.phase === 'requested' || job.phase === 'confirming')
              await store.retryQuery(job);
            else if (job.phase === 'creating') await store.phase(job, 'done');
            else await store.manual(job);
          } catch {
            /* A newer lease owns recovery. */
          }
        }
      }
      for (const a of await store.queries(20)) {
        try {
          await query(a);
        } catch {
          await event(a, 'query', 'unknown').catch(() => undefined);
        }
      }
    })().finally(() => {
      running = undefined;
    });
    return running;
  }
  const api = {
    view,
    async qr(id: string, userId: string) {
      const payment = await view(id, userId);
      if (!payment) return null;
      const a = payment.checkout.attemptId
        ? await store.attempt(payment.checkout.attemptId)
        : undefined;
      return {
        payment,
        ...(payment.status === 'unpaid' && payment.checkout.status === 'ready' && a?.qr_content
          ? { qrContent: a.qr_content }
          : {}),
      };
    },
    async create(id: string, userId: string, payType: 'wechat' | 'alipay') {
      const prepared = await store.initial(id, userId, scope, payType);
      if (!prepared) return null;
      if (prepared.dispatch) await dispatch(prepared.attempt);
      return view(id, userId);
    },
    async recover(id: string, userId: string, input: RecoverPaymentBody) {
      const job = await store.request(id, userId, input.expectedAttemptId, input.recoveryKey);
      if (!job) return null;
      // Durable database state is committed before this best-effort wake-up. Periodic ticks recover it.
      void tick(job.id).catch(() => undefined);
      return view(id, userId);
    },
    tick,
    async stop() {
      await running;
    },
    async notify(input: unknown): Promise<boolean> {
      const n = gateway.verifyPaymentNotification(input);
      if (
        n.gatewayEnvironment !== scope.environment ||
        n.institutionNo !== scope.institutionNo ||
        n.merchantNo !== scope.merchantNo ||
        (n.tradeType !== undefined && n.tradeType !== '1')
      )
        throw new ChannelConflictError();
      const a = await store.find(scope, n.payTraceNo, n.payTime);
      if (!a) return false;
      if (BigInt(a.amount) !== n.amountCents || (n.attach && n.attach !== a.payment_id))
        throw new ChannelConflictError();
      await accepted(a, {
        status:
          n.returnCode === 'SUCCESS' && n.resultCode === 'PAY_SUCCESS'
            ? 'succeeded'
            : n.resultCode === 'PAY_FAIL'
              ? 'failed'
              : 'pending',
        platformTradeNo: n.platformTradeNo,
      });
      return true;
    },
    legacyChannel(legacy: PaymentChannelService): PaymentChannelService {
      return {
        ...legacy,
        async notify(input) {
          return (await api.notify(input)) ? 'recorded' : legacy.notify(input);
        },
      };
    },
  };
  return api;
}
export type CheckoutRecovery = ReturnType<typeof createCheckoutRecovery>;
