import { z } from 'zod';
import {
  gatewayDiagnosticFields,
  gatewayFailureReasons,
  gatewayTransportCodes,
  PaymentGatewayUncertainError,
} from './channel/types.js';

const Event = z.object({
  event: z.literal('payment_diagnostic'),
  phase: z.enum([
    'prepare_order',
    'prepay',
    'persist_prepay',
    'read_order',
    'query',
    'persist_channel_result',
    'credit_payment',
    'checkout_read',
    'render_qr',
  ]),
  outcome: z.enum(['started', 'pending', 'succeeded', 'failed', 'unknown']),
  reason: z.enum([
    ...gatewayFailureReasons,
    'started',
    'accepted',
    'stored',
    'storage_error',
    'provider_rejected',
    'provider_result_unknown',
    'channel_conflict',
    'qr_render_failed',
  ]),
  paymentId: z.string().uuid().optional(),
  traceId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .optional(),
  environment: z.enum(['test', 'production']).optional(),
  source: z.enum(['query', 'callback']).optional(),
  elapsedMs: z.number().int().min(0).max(3_600_000).optional(),
  field: z.enum(gatewayDiagnosticFields).optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  timeoutMs: z.number().int().min(100).max(5000).optional(),
  transportCode: z.enum(gatewayTransportCodes).optional(),
  gatewayResultCode: z.enum(['PAY_SUCCESS', 'PAY_FAIL', 'PAY_IN_PROCESS', 'OTHER']).optional(),
  hasQr: z.boolean().optional(),
});

export type PaymentDiagnosticEvent = z.infer<typeof Event>;
export type PaymentDiagnosticInput = Omit<PaymentDiagnosticEvent, 'event'>;
export type PaymentDiagnosticSink = (event: PaymentDiagnosticEvent) => void;
export type PaymentDiagnosticContext = { traceId?: string };

/** Project a fixed allowlist; neither arbitrary errors nor provider fields reach the sink. */
export function reportPaymentDiagnostic(
  sink: PaymentDiagnosticSink | undefined,
  input: PaymentDiagnosticInput,
): void {
  if (!sink) return;
  try {
    const parsed = Event.safeParse({
      ...input,
      event: 'payment_diagnostic',
      traceId:
        input.traceId && /^[A-Za-z0-9_-]{1,64}$/.test(input.traceId) ? input.traceId : undefined,
    });
    if (parsed.success) sink(parsed.data);
  } catch {
    // Observability must never change admission, accounting, or resubmission behavior.
  }
}

export function gatewayFailure(error: unknown): {
  reason: PaymentDiagnosticInput['reason'];
  field?: PaymentDiagnosticInput['field'];
  httpStatus?: number;
  timeoutMs?: number;
  transportCode?: PaymentDiagnosticInput['transportCode'];
} {
  return error instanceof PaymentGatewayUncertainError
    ? error.diagnostic
    : { reason: 'unexpected_error' };
}

export function knownGatewayResult(
  code: string | undefined,
): PaymentDiagnosticInput['gatewayResultCode'] {
  return code === undefined
    ? undefined
    : code === 'PAY_SUCCESS' || code === 'PAY_FAIL' || code === 'PAY_IN_PROCESS'
      ? code
      : 'OTHER';
}

export function elapsedMilliseconds(start: number): number {
  return Math.min(3_600_000, Math.max(0, Math.round(performance.now() - start)));
}
