import { describe, expect, it } from 'vitest';
import { RecoverablePaymentViewSchema, RecoverPaymentBodySchema } from '../recovery.js';
import { PaymentViewSchema } from '../payment.js';
const id = '00000000-0000-4000-8000-000000000366';
const view = {
  version: 2,
  paymentRequestId: id,
  status: 'unpaid',
  amount: { currency: 'CNY', amountCents: '2' },
  createdAt: '2026-09-14T00:00:00Z',
  updatedAt: '2026-09-14T00:00:01Z',
  recoverableUntil: '2026-09-15T00:00:00Z',
  checkout: { attemptId: id, status: 'missing_qr', canRecover: true },
  action: {
    kind: 'open_url',
    url: `https://pay.test/payments/${id}?version=2`,
    expiresAt: '2026-09-14T00:15:00Z',
  },
};
describe('explicit payment recovery v2 contract', () => {
  it('accepts recovery while preserving the independent v1 contract', () => {
    expect(RecoverablePaymentViewSchema.parse(view).checkout.canRecover).toBe(true);
    expect(PaymentViewSchema.safeParse(view).success).toBe(false);
  });
  it.each(['closing', 'ready', 'submitting', 'manual_review', 'paid'])(
    'does not offer recovery from %s',
    (status) => {
      expect(
        RecoverablePaymentViewSchema.safeParse({
          ...view,
          checkout: { ...view.checkout, status, expiresAt: '2026-09-14T00:10:00Z' },
        }).success,
      ).toBe(false);
    },
  );
  it('requires identity on an existing attempt and none on not_started', () => {
    expect(
      RecoverablePaymentViewSchema.safeParse({
        ...view,
        checkout: { status: 'unknown', canRecover: true },
      }).success,
    ).toBe(false);
    expect(
      RecoverablePaymentViewSchema.safeParse({
        ...view,
        checkout: { ...view.checkout, status: 'not_started', canRecover: false },
      }).success,
    ).toBe(false);
    expect(
      RecoverablePaymentViewSchema.safeParse({
        ...view,
        checkout: { status: 'not_started', canRecover: false },
      }).success,
    ).toBe(true);
  });
  it('rejects terminal actions, invented fields and an unfunded completed checkout', () => {
    expect(RecoverablePaymentViewSchema.safeParse({ ...view, status: 'completed' }).success).toBe(
      false,
    );
    expect(
      RecoverablePaymentViewSchema.safeParse({
        ...view,
        checkout: { ...view.checkout, qrContent: 'provider-secret' },
      }).success,
    ).toBe(false);
    const { action: _action, ...terminal } = view;
    expect(
      RecoverablePaymentViewSchema.safeParse({
        ...terminal,
        status: 'completed',
        checkout: { attemptId: id, status: 'paid', canRecover: false },
      }).success,
    ).toBe(true);
  });
  it('compares action grants at nanosecond precision', () => {
    expect(
      RecoverablePaymentViewSchema.safeParse({
        ...view,
        updatedAt: '2026-09-14T00:00:01.000000002Z',
        action: { ...view.action, expiresAt: '2026-09-14T00:00:01.000000001Z' },
      }).success,
    ).toBe(false);
    expect(
      RecoverablePaymentViewSchema.safeParse({
        ...view,
        updatedAt: '2026-09-14T00:00:01.000000001Z',
        action: { ...view.action, expiresAt: '2026-09-14T00:00:01.000000002Z' },
      }).success,
    ).toBe(true);
  });
  it('binds a recovery key to an existing attempt and rejects client prices', () => {
    expect(
      RecoverPaymentBodySchema.safeParse({ recoveryKey: 'recover-1', expectedAttemptId: id })
        .success,
    ).toBe(true);
    expect(
      RecoverPaymentBodySchema.safeParse({
        recoveryKey: 'recover-1',
        expectedAttemptId: id,
        amountCents: '1',
      }).success,
    ).toBe(false);
    expect(
      RecoverPaymentBodySchema.safeParse({ recoveryKey: 'recover-1', expectedAttemptId: 'other' })
        .success,
    ).toBe(false);
  });
});
