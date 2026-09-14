import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { LeshouyingPaymentGateway, signPaymentParameters } from '../channel/index.js';
import { reportPaymentDiagnostic, type PaymentDiagnosticInput } from '../payment-diagnostics.js';

const privateValue = 'private-provider-content';
const config = {
  environment: 'TEST' as const,
  institutionNo: 'test-institution',
  merchantNo: 'test-merchant',
  institutionKey: 'test-only-institution-key',
  notifyUrl: 'https://pay.example.test/billing/leshouying/payment-notify',
  timeoutMs: 100,
};
const command = {
  orderNo: randomUUID(),
  payTraceNo: 'original-trace',
  payTime: '20260912000000',
  amountCents: 300n,
  channel: 'qr' as const,
  payType: 'wechat' as const,
};
function signed(patch: Record<string, string | null> = {}) {
  const fields = {
    mch_no: config.merchantNo,
    pay_trace_no: command.payTraceNo,
    pay_time: command.payTime,
    total_amount: '300',
    pay_type: '400',
    return_code: 'SUCCESS',
    result_code: 'PAY_SUCCESS',
    qrcode: privateValue,
    ...patch,
  };
  return new Response(
    JSON.stringify({ ...fields, sign: signPaymentParameters(fields, config.institutionKey) }),
    { headers: { 'content-type': 'application/json' } },
  );
}
describe('payment diagnostic boundary', () => {
  it.each([
    {
      label: 'HTTP rejection',
      response: () => new Response(privateValue, { status: 502 }),
      diagnostic: { reason: 'http_error', httpStatus: 502 },
    },
    {
      label: 'HTML response',
      response: () => new Response(privateValue, { headers: { 'content-type': 'text/html' } }),
      diagnostic: { reason: 'unexpected_content_type', httpStatus: 200 },
    },
    {
      label: 'invalid JSON',
      response: () =>
        new Response(privateValue, { headers: { 'content-type': 'application/json' } }),
      diagnostic: { reason: 'invalid_json' },
    },
    {
      label: 'invalid structure',
      response: () => new Response('[]', { headers: { 'content-type': 'application/json' } }),
      diagnostic: { reason: 'invalid_response' },
    },
    {
      label: 'invalid signature',
      response: () =>
        new Response(JSON.stringify({ sign: '0'.repeat(32), return_msg: privateValue }), {
          headers: { 'content-type': 'application/json' },
        }),
      diagnostic: { reason: 'invalid_signature' },
    },
    {
      label: 'missing QR',
      response: () => signed({ qrcode: null }),
      diagnostic: { reason: 'missing_qr', field: 'qrcode' },
    },
    {
      label: 'unsafe QR',
      response: () => signed({ qrcode: '\u0000' + privateValue }),
      diagnostic: { reason: 'invalid_qr', field: 'qrcode' },
    },
    {
      label: 'wrong merchant',
      response: () => signed({ mch_no: privateValue }),
      diagnostic: { reason: 'ownership_mismatch', field: 'mch_no' },
    },
    {
      label: 'wrong amount',
      response: () => signed({ total_amount: '301' }),
      diagnostic: { reason: 'ownership_mismatch', field: 'total_amount' },
    },
    {
      label: 'missing field',
      response: () => signed({ pay_time: null }),
      diagnostic: { reason: 'missing_field', field: 'pay_time' },
    },
    {
      label: 'oversized body',
      response: () =>
        new Response(privateValue, {
          headers: { 'content-type': 'application/json', 'content-length': '65537' },
        }),
      diagnostic: { reason: 'response_too_large' },
    },
    {
      label: 'invalid encoding',
      response: () =>
        new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }),
      diagnostic: { reason: 'invalid_encoding' },
    },
  ])('classifies $label without retaining raw response data', async ({ response, diagnostic }) => {
    const gateway = new LeshouyingPaymentGateway(config, async () => response());
    await expect(gateway.createPayment(command)).rejects.toMatchObject({
      name: 'PaymentGatewayUncertainError',
      message: 'payment gateway outcome is uncertain',
      diagnostic,
    });
    await gateway.createPayment(command).catch((error: unknown) => {
      const serialized = JSON.stringify(error);
      for (const value of [privateValue, config.institutionKey, command.payTraceNo])
        expect(serialized).not.toContain(value);
    });
  });
  it('separates transport failure from a timed out body and strips error messages and causes', async () => {
    const gateway = new LeshouyingPaymentGateway(config, async () => {
      throw new Error(privateValue, { cause: { code: 'ENOTFOUND', hostname: privateValue } });
    });
    await expect(gateway.createPayment(command)).rejects.toMatchObject({
      diagnostic: { reason: 'transport_error', transportCode: 'ENOTFOUND', timeoutMs: 100 },
    });
    let cancelled = false;
    const stalled = new LeshouyingPaymentGateway(
      config,
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    );
    await expect(stalled.createPayment(command)).rejects.toMatchObject({
      diagnostic: { reason: 'timeout', httpStatus: 200, timeoutMs: 100 },
    });
    expect(cancelled).toBe(true);
  });
  it('strips unknown keys and unsafe trace IDs before invoking the log sink', () => {
    const sink = vi.fn();
    reportPaymentDiagnostic(sink, {
      phase: 'prepay',
      outcome: 'unknown',
      reason: 'invalid_signature',
      paymentId: randomUUID(),
      traceId: privateValue + '\n',
      body: privateValue,
      error: new Error(privateValue),
    } as PaymentDiagnosticInput);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sink.mock.calls)).not.toContain(privateValue);
    expect(sink.mock.calls[0]![0]).not.toHaveProperty('body');
    reportPaymentDiagnostic(sink, {
      phase: 'prepay',
      outcome: 'unknown',
      reason: privateValue,
    } as unknown as PaymentDiagnosticInput);
    expect(sink).toHaveBeenCalledTimes(1);
  });
});
