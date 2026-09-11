import { z } from 'zod';

import { IdSchema, IsoDateTimeSchema } from '../core/ids.js';

const CanonicalUuidSchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const CANONICAL_CENTS_PATTERN = /^(?:0|[1-9][0-9]{0,18})$/u;
const POSTGRES_BIGINT_MAX_CENTS = '9223372036854775807';
const PostgresBigintCentsSchema = z
  .string()
  .regex(CANONICAL_CENTS_PATTERN)
  .refine(
    (value) =>
      !CANONICAL_CENTS_PATTERN.test(value) ||
      value.length < POSTGRES_BIGINT_MAX_CENTS.length ||
      (value.length === POSTGRES_BIGINT_MAX_CENTS.length && value <= POSTGRES_BIGINT_MAX_CENTS),
    'Cents exceed bigint range',
  );
const PositiveCentsSchema = PostgresBigintCentsSchema.refine(
  (value) => value !== '0',
  'Recharge amount must be positive',
);

export const CreateRecoveryRechargeOrderBodySchema = z
  .object({
    recoveryUsageId: CanonicalUuidSchema.optional(),
    rechargeIntentId: CanonicalUuidSchema,
    amountCents: z.number().int().positive().max(99_999_999),
    channel: z.literal('qr'),
    payType: z.enum(['wechat', 'alipay']),
  })
  .strict();
export type CreateRecoveryRechargeOrderBody = z.infer<typeof CreateRecoveryRechargeOrderBodySchema>;

const RecoveryRechargeOrderStatusSchema = z.enum([
  'created',
  'pending',
  'unknown',
  'succeeded',
  'failed',
  'closed',
  'credited',
]);

export const RechargeOrderViewSchema = z
  .object({
    id: IdSchema,
    rechargeIntentId: CanonicalUuidSchema,
    amountCents: PositiveCentsSchema,
    channel: z.literal('qr'),
    payType: z.enum(['wechat', 'alipay']).optional(),
    status: RecoveryRechargeOrderStatusSchema,
    reconciliationActive: z.boolean(),
    paymentAction: z
      .object({
        kind: z.enum(['redirect', 'qr_code']),
        url: z.string().min(1).max(4_096),
      })
      .strict()
      .optional(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();
export type RechargeOrderView = z.infer<typeof RechargeOrderViewSchema>;

export const RecoveryRechargeOrderViewSchema = RechargeOrderViewSchema.extend({
  recoveryUsageId: CanonicalUuidSchema,
}).strict();
export type RecoveryRechargeOrderView = z.infer<typeof RecoveryRechargeOrderViewSchema>;
