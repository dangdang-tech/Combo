import { randomBytes } from 'node:crypto';
import {
  asSigningParameters,
  fingerprintPaymentParameters,
  signPaymentParameters,
  verifyPaymentSignature,
  type SigningParameters,
} from './signer.js';
import {
  InvalidPaymentNotificationError,
  PaymentGatewayUncertainError,
  PaymentGatewayUnavailableError,
  gatewayDiagnosticFields,
  gatewayTransportCodes,
  type GatewayFailureDiagnostic,
  type CreatePaymentCommand,
  type PaymentGateway,
  type PaymentGatewayEnvironment,
  type PaymentQueryResult,
  type PaymentSubmission,
  type QueryPaymentCommand,
  type VerifiedPaymentNotification,
} from './types.js';

export const LESHOUYING_BASE_URLS = {
  TEST: 'https://test.gdyfsk.com/yfpay',
  PRODUCTION: 'https://open.gdyfsk.com/yfpay',
} as const;

const MAX_RESPONSE_BYTES = 64 * 1024;
const PAYMENT_ACTION_TTL_MS = 15 * 60 * 1_000;

export interface LeshouyingGatewayConfig {
  environment: 'TEST' | 'PRODUCTION';
  institutionNo: string;
  merchantNo: string;
  institutionKey: string;
  notifyUrl: string;
  timeoutMs: number;
}

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function fieldFailure(reason: GatewayFailureDiagnostic['reason'], field: string) {
  return new PaymentGatewayUncertainError({
    reason,
    field: gatewayDiagnosticFields.find((known) => known === field),
  });
}

function transportCode(error: unknown): GatewayFailureDiagnostic['transportCode'] {
  for (const candidate of [error, isRecord(error) ? error.cause : undefined]) {
    if (isRecord(candidate)) {
      const known = gatewayTransportCodes.find((code) => code === candidate.code);
      if (known) return known;
    }
  }
  return undefined;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw fieldFailure(
      value === undefined || value === null ? 'missing_field' : 'invalid_field',
      key,
    );
  }
  return String(value);
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw fieldFailure('invalid_field', key);
  }
  return String(value);
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function callbackString(
  record: Record<string, unknown>,
  key: string,
  input: { min: number; max: number; pattern?: RegExp },
): string {
  const value = record[key];
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new InvalidPaymentNotificationError('invalid_payload', true);
  }
  const normalized = String(value);
  if (
    normalized.length < input.min ||
    normalized.length > input.max ||
    containsControlCharacter(normalized) ||
    (input.pattern && !input.pattern.test(normalized))
  ) {
    throw new InvalidPaymentNotificationError('invalid_payload', true);
  }
  return normalized;
}

function parseAmount(value: string): bigint {
  if (!/^(0|[1-9][0-9]{0,18})$/u.test(value)) throw fieldFailure('invalid_field', 'total_amount');
  return BigInt(value);
}

function parseGatewayDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/u);
  const displayed = value.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/u,
  );
  const parts = compact ?? displayed;
  if (!parts) return undefined;
  const [, year, month, day, hour, minute, second, fraction] = parts;
  const millisecond = (fraction ?? '').padEnd(3, '0');
  const parsed = new Date(
    `${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond || '000'}+08:00`,
  );
  if (Number.isNaN(parsed.getTime())) return undefined;
  const china = new Date(parsed.getTime() + 8 * 60 * 60 * 1_000);
  if (
    china.getUTCFullYear() !== Number(year) ||
    china.getUTCMonth() + 1 !== Number(month) ||
    china.getUTCDate() !== Number(day) ||
    china.getUTCHours() !== Number(hour) ||
    china.getUTCMinutes() !== Number(minute) ||
    china.getUTCSeconds() !== Number(second)
  ) {
    return undefined;
  }
  return parsed;
}

function safeQrContent(value: string): string {
  if (value.length < 1 || value.length > 2_048 || containsControlCharacter(value)) {
    throw fieldFailure('invalid_qr', 'qrcode');
  }
  return value;
}

function gatewayPayType(payType: CreatePaymentCommand['payType']): string {
  if (payType === 'wechat') return '400';
  if (payType === 'alipay') return '300';
  throw fieldFailure('invalid_field', 'pay_type');
}

function gatewayEnvironment(value: 'TEST' | 'PRODUCTION'): PaymentGatewayEnvironment {
  return value === 'TEST' ? 'test' : 'production';
}

async function readResponseText(response: Response, signal: AbortSignal): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new PaymentGatewayUncertainError({ reason: 'response_too_large' });
  }

  const body = response.body;
  if (!body) throw new PaymentGatewayUncertainError({ reason: 'missing_response_body' });
  const reader = body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', abort, { once: true });
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      if (signal.aborted) {
        abort();
        throw new PaymentGatewayUncertainError({ reason: 'timeout' });
      }
      const { done, value } = await reader.read();
      if (signal.aborted) throw new PaymentGatewayUncertainError({ reason: 'timeout' });
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new PaymentGatewayUncertainError({ reason: 'response_too_large' });
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (error instanceof PaymentGatewayUncertainError) throw error;
    throw new PaymentGatewayUncertainError({
      reason: 'response_read_error',
      transportCode: transportCode(error),
    });
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, receivedBytes));
  } catch {
    throw new PaymentGatewayUncertainError({ reason: 'invalid_encoding' });
  }
}

export class LeshouyingPaymentGateway implements PaymentGateway {
  readonly configured = true;
  readonly environment: PaymentGatewayEnvironment;
  readonly institutionNo: string;
  readonly merchantNo: string;
  readonly #config: LeshouyingGatewayConfig;
  readonly #fetch: FetchPort;

  constructor(config: LeshouyingGatewayConfig, fetchPort: FetchPort = fetch) {
    try {
      const notify = new URL(config.notifyUrl);
      if (
        !['TEST', 'PRODUCTION'].includes(config.environment) ||
        !config.institutionNo ||
        config.institutionNo.length > 32 ||
        !config.merchantNo ||
        config.merchantNo.length > 64 ||
        config.institutionKey.length < 16 ||
        !Number.isSafeInteger(config.timeoutMs) ||
        config.timeoutMs < 100 ||
        config.timeoutMs > 5000 ||
        notify.protocol !== 'https:' ||
        notify.username ||
        notify.password ||
        notify.search ||
        notify.hash
      )
        throw new Error();
    } catch {
      throw new PaymentGatewayUnavailableError();
    }
    this.#config = config;
    this.#fetch = fetchPort;
    this.environment = gatewayEnvironment(config.environment);
    this.institutionNo = config.institutionNo;
    this.merchantNo = config.merchantNo;
  }

  async #post(path: '/v3/prepay' | '/v3/queryorder', body: SigningParameters) {
    const signed = {
      ...body,
      sign: signPaymentParameters(body, this.#config.institutionKey),
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#config.timeoutMs);
    timeout.unref?.();
    let httpStatus: number | undefined;
    try {
      const response = await this.#fetch(
        `${LESHOUYING_BASE_URLS[this.#config.environment]}${path}`,
        {
          method: 'POST',
          redirect: 'error',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json;charset=utf-8',
          },
          body: JSON.stringify(signed),
          signal: controller.signal,
        },
      );
      httpStatus = response.status;
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw new PaymentGatewayUncertainError({ reason: 'http_error' });
      }
      const responseType = response.headers.get('content-type');
      if (responseType && !responseType.toLowerCase().startsWith('application/json')) {
        void response.body?.cancel().catch(() => undefined);
        throw new PaymentGatewayUncertainError({ reason: 'unexpected_content_type' });
      }
      const text = await readResponseText(response, controller.signal);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new PaymentGatewayUncertainError({ reason: 'invalid_json' });
      }
      if (!isRecord(parsed)) throw new PaymentGatewayUncertainError({ reason: 'invalid_response' });
      let signingParameters: SigningParameters;
      try {
        signingParameters = asSigningParameters(parsed);
      } catch {
        throw new PaymentGatewayUncertainError({ reason: 'invalid_response' });
      }
      if (!verifyPaymentSignature(signingParameters, this.#config.institutionKey)) {
        throw new PaymentGatewayUncertainError({ reason: 'invalid_signature' });
      }
      return parsed;
    } catch (error) {
      throw new PaymentGatewayUncertainError({
        ...(error instanceof PaymentGatewayUncertainError
          ? error.diagnostic
          : { reason: 'transport_error' as const, transportCode: transportCode(error) }),
        ...(controller.signal.aborted ? { reason: 'timeout' as const } : {}),
        httpStatus,
        timeoutMs: this.#config.timeoutMs,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async createPayment(command: CreatePaymentCommand): Promise<PaymentSubmission> {
    // 只保留 C扫B 二维码（/v3/prepay）：H5 收银台已移除。prepay 契约没有
    // front_url 字段，请求体只带公共参数 + pay_type + time_expire。
    const common: Record<string, string> = {
      inst_no: this.institutionNo,
      mch_no: this.merchantNo,
      pay_trace_no: command.payTraceNo,
      pay_time: command.payTime,
      total_amount: command.amountCents.toString(),
      order_body: 'Combo余额充值',
      attach: command.orderNo,
      notify_url: this.#config.notifyUrl,
    };
    const request = { ...common, pay_type: gatewayPayType(command.payType), time_expire: '15' };
    const response = await this.#post('/v3/prepay', request);
    this.#assertResponseOwnership(response, command);
    if (requiredString(response, 'pay_type') !== gatewayPayType(command.payType)) {
      throw fieldFailure('ownership_mismatch', 'pay_type');
    }
    const returnCode = requiredString(response, 'return_code');
    const resultCode = optionalString(response, 'result_code');
    if (returnCode !== 'SUCCESS' || resultCode === 'PAY_FAIL') {
      return { status: 'failed', ...(resultCode ? { gatewayResultCode: resultCode } : {}) };
    }
    if (resultCode !== 'PAY_SUCCESS') {
      return { status: 'unknown', ...(resultCode ? { gatewayResultCode: resultCode } : {}) };
    }
    if (response.qrcode === undefined || response.qrcode === null)
      throw fieldFailure('missing_qr', 'qrcode');
    const codeUrl = safeQrContent(requiredString(response, 'qrcode'));
    const tradeNo = optionalString(response, 'trade_no');
    return {
      status: 'pending',
      gatewayResultCode: resultCode,
      ...(tradeNo ? { platformTradeNo: tradeNo } : {}),
      action: {
        kind: 'code_url',
        value: codeUrl,
        // The gateway action is bearer-like, short-lived. Combo stops returning it
        // after this bound even if the provider keeps the code valid.
        expiresAt: new Date(Date.now() + PAYMENT_ACTION_TTL_MS),
      },
    };
  }

  async queryPayment(command: QueryPaymentCommand): Promise<PaymentQueryResult> {
    const queryTraceNo = randomBytes(16).toString('hex');
    const request: Record<string, string> = {
      inst_no: this.institutionNo,
      mch_no: this.merchantNo,
      query_trace_no: queryTraceNo,
      ...(command.platformTradeNo
        ? { trade_no: command.platformTradeNo }
        : { pay_trace_no: command.payTraceNo, pay_time: command.payTime }),
    };
    const response = await this.#post('/v3/queryorder', request);
    const merchantNo = requiredString(response, 'mch_no');
    const responseQueryTraceNo = requiredString(response, 'query_trace_no');
    const payTraceNo = requiredString(response, 'pay_trace_no');
    const payTime = requiredString(response, 'pay_time');
    const amount = parseAmount(requiredString(response, 'total_amount'));
    for (const [field, matches] of [
      ['mch_no', merchantNo === this.merchantNo],
      ['query_trace_no', responseQueryTraceNo === queryTraceNo],
      ['pay_trace_no', payTraceNo === command.payTraceNo],
      ['pay_time', payTime === command.payTime],
      ['total_amount', amount === command.amountCents],
    ] as const) {
      if (!matches) throw fieldFailure('ownership_mismatch', field);
    }
    const returnCode = requiredString(response, 'return_code');
    const resultCode = optionalString(response, 'result_code');
    const platformTradeNo = optionalString(response, 'trade_no');
    if (command.platformTradeNo !== undefined && platformTradeNo !== command.platformTradeNo) {
      throw fieldFailure('ownership_mismatch', 'trade_no');
    }
    if (returnCode !== 'SUCCESS') {
      return { status: 'unknown', ...(resultCode ? { gatewayResultCode: resultCode } : {}) };
    }
    if (resultCode === 'PAY_SUCCESS') {
      if (!platformTradeNo) throw fieldFailure('missing_field', 'trade_no');
      return {
        status: 'succeeded',
        gatewayResultCode: resultCode,
        platformTradeNo,
        ...(parseGatewayDate(optionalString(response, 'end_time'))
          ? { paidAt: parseGatewayDate(optionalString(response, 'end_time')) }
          : {}),
      };
    }
    if (resultCode === 'PAY_IN_PROCESS') {
      return {
        status: 'pending',
        gatewayResultCode: resultCode,
        ...(platformTradeNo ? { platformTradeNo } : {}),
      };
    }
    if (resultCode === 'PAY_FAIL') {
      return {
        status: 'failed',
        gatewayResultCode: resultCode,
        ...(platformTradeNo ? { platformTradeNo } : {}),
      };
    }
    return { status: 'unknown', ...(resultCode ? { gatewayResultCode: resultCode } : {}) };
  }

  verifyPaymentNotification(input: unknown): VerifiedPaymentNotification {
    let parameters: SigningParameters;
    let signatureValid: boolean;
    try {
      parameters = asSigningParameters(input);
      signatureValid = verifyPaymentSignature(parameters, this.#config.institutionKey);
    } catch {
      throw new InvalidPaymentNotificationError('invalid_payload', false);
    }
    if (!signatureValid) {
      throw new InvalidPaymentNotificationError('invalid_signature', false);
    }
    try {
      const record = input as Record<string, unknown>;
      const institutionNo = callbackString(record, 'inst_no', { min: 1, max: 32 });
      const merchantNo = callbackString(record, 'mch_no', { min: 1, max: 64 });
      const payTraceNo = callbackString(record, 'pay_trace_no', { min: 1, max: 64 });
      const payTime = callbackString(record, 'pay_time', {
        min: 14,
        max: 14,
        pattern: /^[0-9]{14}$/u,
      });
      const amountCents = parseAmount(
        callbackString(record, 'total_amount', {
          min: 1,
          max: 18,
          pattern: /^[0-9]+$/u,
        }),
      );
      const platformTradeNo = callbackString(record, 'trade_no', { min: 1, max: 64 });
      if (amountCents <= 0n) {
        throw new InvalidPaymentNotificationError('invalid_payload', true);
      }
      const resultCode = callbackString(record, 'result_code', { min: 1, max: 32 });
      const returnCode = callbackString(record, 'return_code', { min: 1, max: 32 });
      const tradeType = optionalString(record, 'trade_type');
      if (
        tradeType !== undefined &&
        (tradeType.length > 2 || containsControlCharacter(tradeType))
      ) {
        throw new InvalidPaymentNotificationError('invalid_payload', true);
      }
      const attach = optionalString(record, 'attach');
      if (attach !== undefined && (attach.length > 128 || containsControlCharacter(attach))) {
        throw new InvalidPaymentNotificationError('invalid_payload', true);
      }
      const rawPaidAt = optionalString(record, 'end_time');
      if (
        rawPaidAt !== undefined &&
        (rawPaidAt.length > 32 || containsControlCharacter(rawPaidAt))
      ) {
        throw new InvalidPaymentNotificationError('invalid_payload', true);
      }
      const paidAt = parseGatewayDate(rawPaidAt);
      return {
        eventFingerprint: fingerprintPaymentParameters(parameters),
        gatewayEnvironment: this.environment,
        institutionNo,
        merchantNo,
        payTraceNo,
        payTime,
        amountCents,
        platformTradeNo,
        resultCode,
        returnCode,
        ...(tradeType ? { tradeType } : {}),
        ...(attach ? { attach } : {}),
        ...(paidAt ? { paidAt } : {}),
      };
    } catch (error) {
      if (error instanceof InvalidPaymentNotificationError) throw error;
      throw new InvalidPaymentNotificationError('invalid_payload', true);
    }
  }

  #assertResponseOwnership(response: Record<string, unknown>, command: CreatePaymentCommand): void {
    for (const [field, matches] of [
      ['mch_no', requiredString(response, 'mch_no') === this.merchantNo],
      ['pay_trace_no', requiredString(response, 'pay_trace_no') === command.payTraceNo],
      ['pay_time', requiredString(response, 'pay_time') === command.payTime],
      [
        'total_amount',
        parseAmount(requiredString(response, 'total_amount')) === command.amountCents,
      ],
    ] as const) {
      if (!matches) throw fieldFailure('ownership_mismatch', field);
    }
  }
}

export class DisabledPaymentGateway implements PaymentGateway {
  readonly configured = false;
  readonly environment: PaymentGatewayEnvironment = 'test';
  readonly institutionNo = '';
  readonly merchantNo = '';

  async createPayment(): Promise<never> {
    throw new PaymentGatewayUnavailableError();
  }

  async queryPayment(): Promise<never> {
    throw new PaymentGatewayUnavailableError();
  }

  verifyPaymentNotification(): never {
    throw new PaymentGatewayUnavailableError();
  }
}
