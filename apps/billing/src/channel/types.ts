export type PaymentGatewayEnvironment = 'test' | 'production';
export type PaymentChannel = 'qr';
export type PayType = 'wechat' | 'alipay';

export const gatewayFailureReasons = [
  'timeout',
  'transport_error',
  'http_error',
  'unexpected_content_type',
  'response_too_large',
  'missing_response_body',
  'response_read_error',
  'invalid_encoding',
  'invalid_json',
  'invalid_response',
  'invalid_signature',
  'missing_field',
  'invalid_field',
  'ownership_mismatch',
  'missing_qr',
  'invalid_qr',
  'unexpected_error',
] as const;
export const gatewayDiagnosticFields = [
  'mch_no',
  'pay_trace_no',
  'pay_time',
  'total_amount',
  'pay_type',
  'query_trace_no',
  'trade_no',
  'return_code',
  'result_code',
  'qrcode',
] as const;
export const gatewayTransportCodes = [
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'CERT_HAS_EXPIRED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
] as const;
export interface GatewayFailureDiagnostic {
  reason: (typeof gatewayFailureReasons)[number];
  field?: (typeof gatewayDiagnosticFields)[number];
  httpStatus?: number;
  timeoutMs?: number;
  transportCode?: (typeof gatewayTransportCodes)[number];
}

export interface PaymentAction {
  kind: 'code_url';
  value: string;
  expiresAt: Date;
}

export interface CreatePaymentCommand {
  orderNo: string;
  payTraceNo: string;
  payTime: string;
  amountCents: bigint;
  channel: PaymentChannel;
  payType: PayType;
}

export interface PaymentSubmission {
  status: 'pending' | 'failed' | 'unknown';
  gatewayResultCode?: string;
  platformTradeNo?: string;
  action?: PaymentAction;
}

export interface QueryPaymentCommand {
  payTraceNo: string;
  payTime: string;
  amountCents: bigint;
  platformTradeNo?: string;
}

export interface PaymentQueryResult {
  status: 'succeeded' | 'pending' | 'failed' | 'unknown';
  gatewayResultCode?: string;
  platformTradeNo?: string;
  paidAt?: Date;
}

export interface VerifiedPaymentNotification {
  eventFingerprint: string;
  gatewayEnvironment: PaymentGatewayEnvironment;
  institutionNo: string;
  merchantNo: string;
  payTraceNo: string;
  payTime: string;
  amountCents: bigint;
  platformTradeNo: string;
  resultCode: string;
  returnCode: string;
  tradeType?: string;
  attach?: string;
  paidAt?: Date;
}

export interface PaymentGateway {
  readonly configured: boolean;
  readonly environment: PaymentGatewayEnvironment;
  readonly institutionNo: string;
  readonly merchantNo: string;
  createPayment(command: CreatePaymentCommand): Promise<PaymentSubmission>;
  queryPayment(command: QueryPaymentCommand): Promise<PaymentQueryResult>;
  verifyPaymentNotification(input: unknown): VerifiedPaymentNotification;
}

/** 固定错误文案不包含网关响应、URL、签名参数或密钥。 */
export class PaymentGatewayUnavailableError extends Error {
  constructor() {
    super('payment gateway is unavailable');
    this.name = 'PaymentGatewayUnavailableError';
  }
}

/** 下单结果不确定时只能查原订单，不允许上层盲目重下。 */
export class PaymentGatewayUncertainError extends Error {
  constructor(readonly diagnostic: GatewayFailureDiagnostic = { reason: 'unexpected_error' }) {
    super('payment gateway outcome is uncertain');
    this.name = 'PaymentGatewayUncertainError';
  }
}

export class InvalidPaymentNotificationError extends Error {
  constructor(
    readonly reason: 'invalid_signature' | 'invalid_payload' = 'invalid_payload',
    readonly signatureValid = false,
  ) {
    super('payment notification is invalid');
    this.name = 'InvalidPaymentNotificationError';
  }
}
