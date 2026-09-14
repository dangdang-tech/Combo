import { z } from 'zod';
import {
  PaymentActionSchema,
  PaymentIdentifierSchema,
  PaymentMetaSchema,
  PaymentMoneySchema,
  PaymentRequestKeySchema,
  PaymentTimestampSchema,
  compareUtcTimestamps,
} from './payment.js';

/** Recovery is explicitly opt-in; the v1 expiry and response contract remain unchanged. */
export const PAYMENT_RECOVERY_VERSION = 2 as const;
export const PaymentCheckoutStateSchema = z.enum([
  'not_started',
  'submitting',
  'ready',
  'missing_qr',
  'unknown',
  'closing',
  'closed',
  'paid',
  'manual_review',
]);
export const RecoverPaymentBodySchema = z
  .object({
    recoveryKey: PaymentRequestKeySchema,
    expectedAttemptId: z.string().uuid(),
  })
  .strict();
export type RecoverPaymentBody = z.infer<typeof RecoverPaymentBodySchema>;

export const RecoverablePaymentViewSchema = z
  .object({
    version: z.literal(PAYMENT_RECOVERY_VERSION),
    paymentRequestId: PaymentIdentifierSchema,
    status: z.enum(['unpaid', 'completed', 'closed']),
    amount: PaymentMoneySchema,
    createdAt: PaymentTimestampSchema,
    updatedAt: PaymentTimestampSchema,
    recoverableUntil: PaymentTimestampSchema,
    checkout: z
      .object({
        attemptId: z.string().uuid().optional(),
        status: PaymentCheckoutStateSchema,
        expiresAt: PaymentTimestampSchema.optional(),
        canRecover: z.boolean(),
      })
      .strict(),
    action: PaymentActionSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const invalid = (path: string[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    if (compareUtcTimestamps(value.updatedAt, value.createdAt) === -1)
      invalid(['updatedAt'], 'update precedes creation');
    if (compareUtcTimestamps(value.recoverableUntil, value.createdAt) !== 1)
      invalid(['recoverableUntil'], 'recovery window precedes creation');
    if (value.status !== 'unpaid' && (value.action || value.checkout.canRecover))
      invalid(['action'], 'terminal payments cannot offer a payment action');
    if (value.checkout.status === 'not_started' && value.checkout.attemptId)
      invalid(['checkout', 'attemptId'], 'not_started cannot identify an attempt');
    if (value.checkout.status !== 'not_started' && !value.checkout.attemptId)
      invalid(['checkout', 'attemptId'], 'checkout state requires an attempt');
    if (
      value.checkout.canRecover &&
      !['missing_qr', 'unknown', 'closed'].includes(value.checkout.status)
    )
      invalid(['checkout', 'canRecover'], 'this checkout state cannot be recovered');
    if (value.checkout.status === 'ready' && !value.checkout.expiresAt)
      invalid(['checkout', 'expiresAt'], 'ready requires an action expiry');
    if (value.status === 'completed' && value.checkout.status !== 'paid')
      invalid(['checkout', 'status'], 'completed requires paid checkout');
    if (
      value.action &&
      (compareUtcTimestamps(value.action.expiresAt, value.recoverableUntil) === 1 ||
        compareUtcTimestamps(value.action.expiresAt, value.updatedAt) !== 1)
    )
      invalid(['action', 'expiresAt'], 'action expiry is outside the recovery window');
  });
export type RecoverablePaymentView = z.infer<typeof RecoverablePaymentViewSchema>;
export const RecoverablePaymentResponseSchema = z
  .object({ data: RecoverablePaymentViewSchema, meta: PaymentMetaSchema })
  .strict();
