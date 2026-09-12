import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  channelCheckoutView,
  ChannelConflictError,
  createPaymentChannelService,
  type ChannelOrder,
  type ChannelOrderStore,
} from '../channel-service.js';
import {
  InvalidPaymentNotificationError,
  PaymentGatewayUncertainError,
  type PaymentGateway,
  type VerifiedPaymentNotification,
} from '../channel/index.js';

import type { PaymentDiagnosticEvent, PaymentDiagnosticSink } from '../payment-diagnostics.js';

function setup(diagnostic?: PaymentDiagnosticSink) {
  const order: ChannelOrder = {
    paymentId: randomUUID(),
    userId: randomUUID(),
    amountCents: 300,
    environment: 'test',
    institutionNo: 'inst',
    merchantNo: 'merchant',
    payTraceNo: 'trace',
    payTime: '20260907000000',
    payType: 'wechat',
    state: 'submitting',
    expiresAt: new Date(Date.now() + 900000),
    completed: false,
  };
  let prepared = false;
  const store: ChannelOrderStore = {
    prepare: vi.fn(async (input) => {
      if (input.userId !== order.userId) return null;
      const shouldSubmit = !prepared;
      prepared = true;
      return { order, shouldSubmit };
    }),
    get: vi.fn(async () => order),
    findNotification: vi.fn(async () => order),
    recordSubmission: vi.fn(async (_order, result) => {
      order.state = result.status;
      if (result.action) {
        order.qrContent = result.action.value;
        order.actionExpiresAt = result.action.expiresAt;
      }
    }),
    recordResult: vi.fn(async () => true),
    leaseQueries: vi.fn(async () => [order]),
  };
  const notification: VerifiedPaymentNotification = {
    eventFingerprint: 'a'.repeat(64),
    gatewayEnvironment: 'test',
    institutionNo: 'inst',
    merchantNo: 'merchant',
    payTraceNo: 'trace',
    payTime: order.payTime,
    amountCents: 300n,
    platformTradeNo: 'trade',
    returnCode: 'SUCCESS',
    resultCode: 'PAY_SUCCESS',
    attach: order.paymentId,
  };
  const gateway: PaymentGateway = {
    configured: true,
    environment: 'test',
    institutionNo: 'inst',
    merchantNo: 'merchant',
    createPayment: vi.fn<PaymentGateway['createPayment']>(async () => ({
      status: 'pending',
      action: { kind: 'code_url', value: 'private-qr', expiresAt: new Date(Date.now() + 800000) },
    })),
    queryPayment: vi.fn<PaymentGateway['queryPayment']>(async () => ({
      status: 'succeeded',
      platformTradeNo: 'trade',
    })),
    verifyPaymentNotification: vi.fn(() => notification),
  };
  const payments = {
    confirmPayment: vi.fn(async () => ({ kind: 'completed' as const, replayed: false })),
  };
  const service = createPaymentChannelService({ store, payments, gateway, diagnostic });
  const input = { paymentId: order.paymentId, userId: order.userId, payType: 'wechat' as const };
  return { order, store, gateway, payments, service, input, notification };
}
describe('payment channel orchestration', () => {
  it('retains the first prepay failure when later queries report pending without resubmitting', async () => {
    const events: PaymentDiagnosticEvent[] = [];
    const s = setup((event) => events.push(event));
    vi.mocked(s.gateway.createPayment).mockRejectedValue(
      new PaymentGatewayUncertainError({
        reason: 'invalid_signature',
        httpStatus: 200,
        timeoutMs: 2000,
      }),
    );
    vi.mocked(s.gateway.queryPayment).mockResolvedValue({
      status: 'pending',
      gatewayResultCode: 'PAY_IN_PROCESS',
    });
    await s.service.create(s.input, { traceId: 'req-checkout-1' });
    await s.service.reconcile();
    await s.service.create(s.input, { traceId: 'req-checkout-2' });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          paymentId: s.order.paymentId,
          traceId: 'req-checkout-1',
          environment: 'test',
          phase: 'prepay',
          outcome: 'unknown',
          reason: 'invalid_signature',
          httpStatus: 200,
        }),
        expect.objectContaining({
          paymentId: s.order.paymentId,
          source: 'query',
          phase: 'query',
          outcome: 'pending',
          gatewayResultCode: 'PAY_IN_PROCESS',
        }),
      ]),
    );
    expect(
      events.filter((event) => event.phase === 'prepay' && event.outcome === 'started'),
    ).toHaveLength(1);
    expect(s.gateway.createPayment).toHaveBeenCalledTimes(1);
    expect(s.payments.confirmPayment).not.toHaveBeenCalled();
    const serialized = JSON.stringify(events);
    for (const privateValue of [s.order.userId, 'merchant', 'payTraceNo', 'private-qr'])
      expect(serialized).not.toContain(privateValue);
  });
  it('distinguishes saving a QR response from channel failure and never logs provider values', async () => {
    const events: PaymentDiagnosticEvent[] = [];
    const s = setup((event) => events.push(event));
    const secret = 'provider-secret-qr-and-account-details';
    vi.mocked(s.gateway.createPayment).mockResolvedValue({
      status: 'pending',
      gatewayResultCode: secret,
      action: { kind: 'code_url', value: secret, expiresAt: new Date() },
    });
    vi.mocked(s.store.recordSubmission).mockRejectedValue(new Error(secret));
    await expect(s.service.create(s.input)).rejects.toThrow(secret);
    await s.service.create(s.input);
    expect(s.gateway.createPayment).toHaveBeenCalledTimes(1);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: 'prepay',
          outcome: 'pending',
          hasQr: true,
          gatewayResultCode: 'OTHER',
        }),
        expect.objectContaining({
          phase: 'persist_prepay',
          outcome: 'unknown',
          reason: 'storage_error',
        }),
      ]),
    );
    expect(JSON.stringify(events)).not.toContain(secret);
  });
  it('reports accounting failure separately from successful channel query', async () => {
    const events: PaymentDiagnosticEvent[] = [];
    const s = setup((event) => events.push(event));
    vi.mocked(s.payments.confirmPayment).mockRejectedValue(
      new Error('private database connection'),
    );
    expect(await s.service.reconcile()).toEqual({ queried: 1, failed: 1 });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: 'query', outcome: 'succeeded' }),
        expect.objectContaining({
          phase: 'credit_payment',
          outcome: 'unknown',
          reason: 'storage_error',
        }),
      ]),
    );
    expect(
      events.some((event) => event.phase === 'credit_payment' && event.outcome === 'succeeded'),
    ).toBe(false);
    expect(JSON.stringify(events)).not.toContain('private database connection');
  });
  it('keeps payment behavior unchanged when the diagnostic sink fails', async () => {
    const s = setup(() => {
      throw new Error('log sink offline');
    });
    expect(await s.service.create(s.input)).toHaveProperty('qrContent', 'private-qr');
    expect(await s.service.reconcile()).toEqual({ queried: 1, failed: 0 });
    expect(s.payments.confirmPayment).toHaveBeenCalledTimes(1);
    expect(s.gateway.createPayment).toHaveBeenCalledTimes(1);
  });

  it('uses one persisted order across concurrent or repeated checkout requests', async () => {
    const s = setup();
    await Promise.all([s.service.create(s.input), s.service.create(s.input)]);
    await s.service.create(s.input);
    expect(s.gateway.createPayment).toHaveBeenCalledTimes(1);
    expect(s.gateway.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: 300n,
        orderNo: s.order.paymentId,
        payTraceNo: 'trace',
        payTime: s.order.payTime,
      }),
    );
    await expect(s.service.create({ ...s.input, payType: 'alipay' })).rejects.toBeInstanceOf(
      ChannelConflictError,
    );
    expect(await s.service.create({ ...s.input, userId: randomUUID() })).toBeNull();
  });
  it('never resubmits after a timeout or when saving the prepay response fails', async () => {
    for (const savingFails of [false, true]) {
      const s = setup();
      if (savingFails)
        vi.mocked(s.store.recordSubmission).mockRejectedValue(new Error('storage unavailable'));
      else vi.mocked(s.gateway.createPayment).mockRejectedValue(new Error('provider timeout'));
      await s.service.create(s.input).catch(() => undefined);
      await s.service.create(s.input);
      expect(s.gateway.createPayment).toHaveBeenCalledTimes(1);
      expect(s.payments.confirmPayment).not.toHaveBeenCalled();
      if (!savingFails) expect(s.order.state).toBe('unknown');
    }
  });
  it('only verified, correctly bound success invokes accounting, and late success remains acceptable', async () => {
    const s = setup();
    s.order.expiresAt = new Date(0);
    vi.mocked(s.gateway.verifyPaymentNotification).mockImplementationOnce(() => {
      throw new InvalidPaymentNotificationError();
    });
    await expect(s.service.notify({})).rejects.toBeInstanceOf(InvalidPaymentNotificationError);
    expect(s.store.findNotification).not.toHaveBeenCalled();
    for (const patch of [
      { amountCents: 301n },
      { merchantNo: 'other' },
      { attach: randomUUID() },
      { tradeType: '2' },
    ]) {
      vi.mocked(s.gateway.verifyPaymentNotification).mockReturnValueOnce({
        ...s.notification,
        ...patch,
      });
      await expect(s.service.notify({})).rejects.toBeInstanceOf(ChannelConflictError);
    }
    expect(s.payments.confirmPayment).not.toHaveBeenCalled();
    vi.mocked(s.gateway.verifyPaymentNotification).mockReturnValueOnce({
      ...s.notification,
      resultCode: 'PAY_IN_PROCESS',
    });
    expect(await s.service.notify({})).toBe('recorded');
    expect(s.payments.confirmPayment).not.toHaveBeenCalled();
    expect(await s.service.notify({})).toBe('completed');
    expect(s.payments.confirmPayment).toHaveBeenCalledWith({
      paymentRequestId: s.order.paymentId,
      amountCents: 300,
      channelTransactionId: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });
  it('reconciles only leased orders and does not count channel success as accounting completion', async () => {
    const s = setup();
    vi.mocked(s.payments.confirmPayment).mockRejectedValue(new Error('database unavailable'));
    expect(await s.service.reconcile()).toEqual({ queried: 1, failed: 1 });
    expect(s.gateway.queryPayment).toHaveBeenCalledWith(
      expect.objectContaining({ payTraceNo: 'trace', amountCents: 300n }),
    );
    expect(s.store.leaseQueries).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 20,
        environment: 'test',
        institutionNo: 'inst',
        merchantNo: 'merchant',
      }),
    );
  });
  it('never exposes private channel identity and hides expired or completed QR actions', () => {
    const s = setup();
    s.order.state = 'pending';
    s.order.qrContent = 'private-qr';
    s.order.actionExpiresAt = new Date(Date.now() + 1000);
    expect(channelCheckoutView(s.order)).toHaveProperty('qrContent', 'private-qr');
    expect(channelCheckoutView(s.order)).not.toHaveProperty('payTraceNo');
    expect(channelCheckoutView(s.order, new Date(Date.now() + 2000))).not.toHaveProperty(
      'qrContent',
    );
    s.order.completed = true;
    expect(channelCheckoutView(s.order)).toMatchObject({ status: 'completed' });
    expect(channelCheckoutView(s.order)).not.toHaveProperty('qrContent');
  });
});
