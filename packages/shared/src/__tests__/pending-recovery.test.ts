import { describe, expect, it } from 'vitest';
import {
  CreateRecoveryRechargeOrderBodySchema,
  RechargeOrderViewSchema,
  RecoveryRechargeOrderViewSchema,
} from '../index.js';

const ORDER_ID = '01982e62-6d6e-7f4d-8fe8-b55f62720b5b';
const INTENT_ID = '11111111-1111-4111-8111-111111111111';
const USAGE_ID = '22222222-2222-4222-8222-222222222222';

function order() {
  return {
    id: ORDER_ID,
    rechargeIntentId: INTENT_ID,
    amountCents: '100',
    channel: 'qr' as const,
    payType: 'wechat' as const,
    status: 'pending' as const,
    reconciliationActive: true,
    paymentAction: { kind: 'qr_code' as const, url: 'https://pay.example.test/order' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:01:00.000Z',
  };
}

describe('retained recharge recovery contracts', () => {
  it('accepts the strict Authoring recharge request and canonicalizes UUIDs', () => {
    expect(
      CreateRecoveryRechargeOrderBodySchema.parse({
        recoveryUsageId: USAGE_ID.toUpperCase(),
        rechargeIntentId: INTENT_ID.toUpperCase(),
        amountCents: 100,
        channel: 'qr',
        payType: 'wechat',
      }),
    ).toEqual({
      recoveryUsageId: USAGE_ID,
      rechargeIntentId: INTENT_ID,
      amountCents: 100,
      channel: 'qr',
      payType: 'wechat',
    });
  });

  it('keeps recharge order views strict and extends recovery views only with usage identity', () => {
    expect(RechargeOrderViewSchema.parse(order())).toEqual(order());
    expect(
      RecoveryRechargeOrderViewSchema.parse({ ...order(), recoveryUsageId: USAGE_ID }),
    ).toEqual({ ...order(), recoveryUsageId: USAGE_ID });
    expect(RechargeOrderViewSchema.safeParse({ ...order(), gatewaySecret: 'hidden' }).success).toBe(
      false,
    );
  });

  it.each(['', '-1', '+1', '01', '1.0', '9223372036854775808'])(
    'rejects non-canonical or out-of-range cents %s',
    (amountCents) => {
      expect(RechargeOrderViewSchema.safeParse({ ...order(), amountCents }).success).toBe(false);
    },
  );
});
