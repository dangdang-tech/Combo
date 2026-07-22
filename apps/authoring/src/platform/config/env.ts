import { z } from 'zod';

export const OFFICIAL_RESEND_API_BASE_URL = 'https://api.resend.com';

const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PROCESS: z.enum(['api', 'worker']).default('api'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),

  OTEL_SERVICE_NAME: z.string().default('cb-authoring'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.preprocess(emptyToUndefined, z.string().optional()),
  OTEL_RESOURCE_ATTRIBUTES: z.string().default(''),
  OTEL_TRACES_SAMPLER: z.string().default(''),
  OTEL_TRACES_SAMPLER_ARG: z.string().default(''),
  OTEL_SDK_DISABLED: z.enum(['true', 'false']).default('false'),

  DATABASE_URL: z.string().default('postgres://combo:combo@localhost:5432/combo'),
  REDIS_QUEUE_URL: z.string().default('redis://localhost:6379/0'),
  REDIS_HOT_URL: z.string().default('redis://localhost:6380/0'),

  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_PUBLIC_ENDPOINT: z.preprocess(emptyToUndefined, z.string().optional()),
  S3_ACCESS_KEY: z.string().default('minioadmin'),
  S3_SECRET_KEY: z.string().default('minioadmin'),
  S3_REGION: z.string().default('us-east-1'),

  // 浏览器来源唯一真源。认证 POST 要求 Origin 精确匹配；Cookie 仍保持 host-only。
  PUBLIC_APP_ORIGIN: z.string().default('http://localhost'),

  // 只有 api 进程消费三项认证密钥。base URL 仅 dev/test 可覆盖到本地 HTTP mock。
  RESEND_API_KEY: z.string().default(''),
  RESEND_FROM_EMAIL: z.string().default(''),
  RESEND_API_BASE_URL: z.preprocess(
    emptyToUndefined,
    z.string().default(OFFICIAL_RESEND_API_BASE_URL),
  ),
  OTP_HMAC_SECRET: z.string().default(''),

  LLM_PROVIDER: z.preprocess(emptyToUndefined, z.enum(['anthropic', 'openrouter']).optional()),
  ANTHROPIC_API_KEY: z.string().default(''),
  OPENROUTER_API_KEY: z.string().default(''),
  LLM_BASE_URL: z.preprocess(emptyToUndefined, z.string().default('https://openrouter.ai/api/v1')),
  LLM_MODEL: z.preprocess(emptyToUndefined, z.string().default('')),
});

export type Env = z.infer<typeof EnvSchema>;

const COMMON_REQUIRED = ['DATABASE_URL'] as const;
const S3_REQUIRED = ['S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const;
const AUTH_API_REQUIRED = [
  'PUBLIC_APP_ORIGIN',
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
  'OTP_HMAC_SECRET',
] as const;

const PRODUCTION_REQUIRED_BY_PROCESS: Record<Env['PROCESS'], readonly string[]> = {
  api: [
    ...COMMON_REQUIRED,
    'REDIS_QUEUE_URL',
    'REDIS_HOT_URL',
    ...S3_REQUIRED,
    ...AUTH_API_REQUIRED,
  ],
  worker: [...COMMON_REQUIRED, 'REDIS_QUEUE_URL', 'REDIS_HOT_URL', ...S3_REQUIRED],
};

let cached: Env | undefined;

const RESEND_MAILBOX_PATTERN = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+$/;
const RESEND_DOMAIN_LABEL_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/** Resend 接受裸邮箱或 `显示名 <邮箱>`；这里只校验固定发件配置，不回显原值。 */
export function isValidResendFromAddress(value: string): boolean {
  if (value.length === 0 || value.length > 320 || value !== value.trim() || /[\r\n]/u.test(value)) {
    return false;
  }

  const displayAddress = value.match(/^([^<>]{1,128})<([^<>]+)>$/u);
  if (value.includes('<') || value.includes('>')) {
    if (!displayAddress || displayAddress[1]?.trim().length === 0) return false;
  }
  const mailbox = (displayAddress?.[2] ?? value).trim();
  if (!RESEND_MAILBOX_PATTERN.test(mailbox)) return false;
  const separator = mailbox.lastIndexOf('@');
  const localPart = mailbox.slice(0, separator);
  const domain = mailbox.slice(separator + 1);
  return (
    localPart.length > 0 &&
    localPart.length <= 64 &&
    !localPart.startsWith('.') &&
    !localPart.endsWith('.') &&
    !localPart.includes('..') &&
    domain.length > 0 &&
    domain.length <= 253 &&
    domain.split('.').every((label) => RESEND_DOMAIN_LABEL_PATTERN.test(label))
  );
}

function validateProductionAuthConfig(env: Env): void {
  const invalidKeys: string[] = [];
  if (env.OTP_HMAC_SECRET.length < 32) invalidKeys.push('OTP_HMAC_SECRET');
  if (env.RESEND_API_BASE_URL !== OFFICIAL_RESEND_API_BASE_URL) {
    invalidKeys.push('RESEND_API_BASE_URL');
  }
  if (!isValidResendFromAddress(env.RESEND_FROM_EMAIL)) invalidKeys.push('RESEND_FROM_EMAIL');
  try {
    const origin = new URL(env.PUBLIC_APP_ORIGIN);
    if (
      origin.protocol !== 'https:' ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash
    ) {
      invalidKeys.push('PUBLIC_APP_ORIGIN');
    }
  } catch {
    invalidKeys.push('PUBLIC_APP_ORIGIN');
  }
  if (invalidKeys.length > 0) {
    throw new Error(`[env] 生产认证配置不合法：${[...new Set(invalidKeys)].join(', ')}`);
  }
}

/** 生产缺配置即失败且只打印 key 名；dev/test 可用默认基础设施，但认证调用仍需显式密钥。 */
export function loadEnv(): Env {
  if (cached) return cached;

  const isProduction = process.env.NODE_ENV === 'production';
  const processType: Env['PROCESS'] = process.env.PROCESS === 'worker' ? 'worker' : 'api';
  const required = PRODUCTION_REQUIRED_BY_PROCESS[processType];

  if (isProduction) {
    const missing = required.filter((key) => {
      const value = process.env[key];
      return value === undefined || value.trim() === '';
    });
    if (missing.length > 0) {
      throw new Error(
        `[env] 生产模式（PROCESS=${processType}）缺少必需配置：${missing.join(', ')}`,
      );
    }
  }

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const keys = Object.keys(parsed.error.flatten().fieldErrors);
    if (isProduction) throw new Error(`[env] 生产模式环境变量校验失败：${keys.join(', ')}`);
    console.warn(`[env] dev/test 环境变量校验失败，使用默认配置：${keys.join(', ')}`);
    cached = EnvSchema.parse({ NODE_ENV: process.env.NODE_ENV, PROCESS: processType });
    return cached;
  }

  cached = parsed.data;
  if (
    cached.PROCESS === 'api' &&
    cached.RESEND_FROM_EMAIL.length > 0 &&
    !isValidResendFromAddress(cached.RESEND_FROM_EMAIL)
  ) {
    throw new Error('[env] 邮件发件配置不合法：RESEND_FROM_EMAIL');
  }
  if (isProduction && cached.PROCESS === 'api') validateProductionAuthConfig(cached);

  if (!isProduction) {
    const usingDefaults = required.filter((key) => {
      const value = process.env[key];
      return value === undefined || value.trim() === '';
    });
    if (usingDefaults.length > 0) {
      console.warn(
        `[env] dev/test（PROCESS=${processType}）使用默认或空配置（生产将拒绝）：${usingDefaults.join(', ')}`,
      );
    }
  }

  return cached;
}
