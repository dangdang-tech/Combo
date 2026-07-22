// 运行期 env 加载与校验：生产缺关键基础设施配置即启动失败；dev/test 回落默认值并告警。
// LLM key 不进生产必填集，缺失只让对话轮次降级报错，不阻塞启动。
import { z } from 'zod';

/** 「留空即默认」：compose 注入空串时统一规整成 undefined，交给 schema 使用默认值。 */
const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3100),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Observability（OpenTelemetry）。默认不导出；配置 OTLP endpoint 后才发送 traces。
  OTEL_SERVICE_NAME: z.string().default('cb-runtime'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.preprocess(emptyToUndefined, z.string().optional()),
  OTEL_RESOURCE_ATTRIBUTES: z.string().default(''),
  OTEL_SDK_DISABLED: z.enum(['true', 'false']).default('false'),

  // PostgreSQL 与 authoring 共库。runtime 只读认证表，并读写试用业务表。
  DATABASE_URL: z.string().default('postgres://combo:combo@localhost:5432/combo'),
  REDIS_URL: z.string().trim().min(1).default('redis://localhost:6379'),

  // ObjectStore（MinIO/S3）：读取能力定义并读写产物内容。
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_ACCESS_KEY: z.string().default('minioadmin'),
  S3_SECRET_KEY: z.string().default('minioadmin'),
  S3_REGION: z.string().default('us-east-1'),

  // LLM（pi 执行层）。provider 留空按 key 自动判定；缺 key 时仅轮次失败。
  RUNTIME_LLM_PROVIDER: z.preprocess(
    emptyToUndefined,
    z.enum(['anthropic', 'openrouter']).optional(),
  ),
  ANTHROPIC_API_KEY: z.string().default(''),
  OPENROUTER_API_KEY: z.string().default(''),
  RUNTIME_LLM_MODEL: z.preprocess(emptyToUndefined, z.string().default('')),
  RUNTIME_TURN_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),

  // 浏览器来源唯一真源。凭据型 CORS 与 Cookie 写请求都只接受这个 origin。
  PUBLIC_APP_ORIGIN: z.string().default('http://localhost'),
});
export type Env = z.infer<typeof EnvSchema>;

/** 生产必填。认证只依赖 PostgreSQL，不需要 JWT、OIDC 或本地签名密钥。 */
const PRODUCTION_REQUIRED = [
  'DATABASE_URL',
  'REDIS_URL',
  'S3_ENDPOINT',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'PUBLIC_APP_ORIGIN',
] as const;

let cached: Env | undefined;

/** 解析进程 env（缓存）。生产缺必填时抛错，且错误只包含配置名。 */
export function loadEnv(): Env {
  if (cached) return cached;
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    const missing = PRODUCTION_REQUIRED.filter((key) => {
      const value = process.env[key];
      return value === undefined || value.trim() === '';
    });
    if (missing.length > 0) {
      throw new Error(
        `[env] 生产模式缺少必需配置（不允许默认 fallback）：${missing.join(', ')}。请显式设置后重启。`,
      );
    }
  }

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    if (isProduction) {
      throw new Error(
        `[env] 生产模式环境变量校验失败：${Object.keys(parsed.error.flatten().fieldErrors).join(', ')}`,
      );
    }
    console.warn(
      '[env] 部分环境变量缺失或不合法，回落默认值（dev/test 守卫）：',
      parsed.error.flatten().fieldErrors,
    );
    cached = EnvSchema.parse({});
    return cached;
  }

  cached = parsed.data;

  if (isProduction) {
    const invalidKeys: string[] = [];
    try {
      const origin = new URL(cached.PUBLIC_APP_ORIGIN);
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
      throw new Error(`[env] 生产浏览器来源配置不合法：${invalidKeys.join(', ')}`);
    }
  }

  if (!isProduction) {
    const usingDefaults = PRODUCTION_REQUIRED.filter((key) => {
      const value = process.env[key];
      return value === undefined || value.trim() === '';
    });
    if (usingDefaults.length > 0) {
      console.warn(`[env] dev/test 使用默认值（生产将拒绝启动）：${usingDefaults.join(', ')}`);
    }
  }

  return cached;
}
