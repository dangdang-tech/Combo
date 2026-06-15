// 运行期 env 加载 + 校验。
//
// 两条铁律（Codex#13）：
//   1) 生产模式（NODE_ENV=production）禁止 DB/对象存储/Redis/Logto 等密钥与连接串用默认 fallback：
//      缺失即【启动失败】（throw），绝不带着 minioadmin/agora:agora 这类默认凭据上生产。
//   2) dev/test 可保留默认便于直跑/冒烟，但加守卫：用了默认值会显式 warn（看得见、可追责）。
//
// redis_hot 默认口径以 compose 独立服务为权威（redis_hot 是独立实例、db 索引 /0，
//   不是与 redis_queue 共实例靠 /1 隔离）；本地直跑映射到宿主 6380（见 .env.local.example / compose）。
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // 一镜像四入口分叉（compose 注入；本地直跑默认 api）。决定生产必填密钥集（见 PRODUCTION_REQUIRED_BY_PROCESS）。
  PROCESS: z.enum(['api', 'worker', 'consumer', 'sweeper']).default('api'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // PostgreSQL
  DATABASE_URL: z.string().default('postgres://agora:agora@localhost:5432/agora'),

  // Redis 双实例（70 §8.1）。redis_hot 以 compose 独立服务为权威：本地直跑 6380/0（非共实例 /1）。
  REDIS_QUEUE_URL: z.string().default('redis://localhost:6379/0'),
  REDIS_HOT_URL: z.string().default('redis://localhost:6380/0'),

  // ObjectStore（70 §8.2）
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_ACCESS_KEY: z.string().default('minioadmin'),
  S3_SECRET_KEY: z.string().default('minioadmin'),
  S3_REGION: z.string().default('us-east-1'),

  // Logto（10 §9）
  LOGTO_ENDPOINT: z.string().default('http://localhost:3001'),
  LOGTO_ISSUER: z.string().default('http://localhost:3001/oidc'),
  LOGTO_JWKS_URI: z.string().default('http://localhost:3001/oidc/jwks'),
  LOGTO_APP_ID: z.string().default(''),
  LOGTO_APP_SECRET: z.string().default(''),
  LOGTO_REDIRECT_URI: z.string().default('http://localhost/api/v1/auth/callback'),
  // JWT 受众（Logto API resource indicator，10-auth §4.1，Codex#2）。
  //   生产【必填】且【无条件】校 aud（见 PRODUCTION_REQUIRED_BY_PROCESS / verifyLogtoJwt）；
  //   dev/test 默认空 → 配了才校（dev 兜底，不强校）。
  LOGTO_AUDIENCE: z.string().default(''),

  // LLM Gateway（70 §8.3）
  ANTHROPIC_API_KEY: z.string().default(''),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * 生产模式必须显式配置的密钥/连接串（不允许默认 fallback），【按进程】区分（Codex#13）。
 * 缺失（未设或为空字符串）即在生产启动时 throw，避免带默认凭据上生产。
 *
 * 必填集与 compose 各进程实际注入的 env 一一对齐——只要进程会用到的密钥，缺了就崩；
 * 不强求后台进程（worker/consumer/sweeper）持有它们不消费的 Logto OIDC 凭据。
 * 注：LLM key（ANTHROPIC_API_KEY）任何进程都不在必填列——上游 degraded 不计 /ready，缺失只降级、不阻塞启动。
 */
const COMMON_REQUIRED = ['DATABASE_URL'] as const;
const LOGTO_REQUIRED = [
  'LOGTO_ENDPOINT',
  'LOGTO_ISSUER',
  'LOGTO_JWKS_URI',
  'LOGTO_APP_ID',
  'LOGTO_APP_SECRET',
  'LOGTO_REDIRECT_URI',
  // 受众必填（Codex#2）：生产无条件校 aud，缺则验签拒所有 token（防「生产可不验 aud」）。
  'LOGTO_AUDIENCE',
] as const;
const S3_REQUIRED = ['S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const;

const PRODUCTION_REQUIRED_BY_PROCESS: Record<Env['PROCESS'], readonly string[]> = {
  // api：HTTP+SSE，做 OIDC 校验 + 入队 + 对象存储 → 全套。
  api: [...COMMON_REQUIRED, 'REDIS_QUEUE_URL', 'REDIS_HOT_URL', ...S3_REQUIRED, ...LOGTO_REQUIRED],
  // worker：消费队列 + 写对象存储 + 推热态事件；不做 OIDC。
  worker: [...COMMON_REQUIRED, 'REDIS_QUEUE_URL', 'REDIS_HOT_URL', ...S3_REQUIRED],
  // consumer：仅 outbox 顺序消费 + 热态水位；不碰队列/对象存储/OIDC。
  consumer: [...COMMON_REQUIRED, 'REDIS_HOT_URL'],
  // sweeper：对账/清理/补投，用热态锁 + 对象存储；不做 OIDC、不直连业务队列。
  sweeper: [...COMMON_REQUIRED, 'REDIS_HOT_URL', ...S3_REQUIRED],
};

let cached: Env | undefined;

/**
 * 解析进程 env（缓存）。
 *   - production：PRODUCTION_REQUIRED 任一缺失/为空 → throw（启动即失败，绝不用默认凭据）。
 *   - dev/test：缺失回落默认 + warn（用了默认值看得见）。
 */
export function loadEnv(): Env {
  if (cached) return cached;

  const isProduction = process.env.NODE_ENV === 'production';
  // PROCESS 决定必填集；非法/缺失回落 api（最严格的必填集，宁可多要不可少要）。
  const rawProcess = process.env.PROCESS;
  const proc: Env['PROCESS'] =
    rawProcess === 'worker' || rawProcess === 'consumer' || rawProcess === 'sweeper'
      ? rawProcess
      : 'api';
  const required = PRODUCTION_REQUIRED_BY_PROCESS[proc];

  if (isProduction) {
    const missing = required.filter((k) => {
      const v = process.env[k];
      return v === undefined || v.trim() === '';
    });
    if (missing.length > 0) {
      // 绝不打印值，只打印缺失的 key 名（避免泄密）。生产缺密钥即崩，让编排在启动期就暴露。
      throw new Error(
        `[env] 生产模式（PROCESS=${proc}）缺少必需配置（不允许默认 fallback）：${missing.join(', ')}。` +
          `请在部署环境显式设置后重启。`,
      );
    }
  }

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    if (isProduction) {
      // 生产模式校验失败直接 throw（不回落默认）；只暴露字段名，不暴露值。
      throw new Error(
        `[env] 生产模式环境变量校验失败：${Object.keys(parsed.error.flatten().fieldErrors).join(', ')}`,
      );
    }
    console.warn(
      '[env] 部分环境变量缺失/不合法，回落默认值（dev/test 守卫）：',
      parsed.error.flatten().fieldErrors,
    );
    cached = EnvSchema.parse({});
    return cached;
  }

  cached = parsed.data;

  // dev/test 守卫：用到默认凭据/连接串时显式 warn（生产已在上面拦截，不会走到这）。
  if (!isProduction) {
    const usingDefaults = required.filter((k) => {
      const v = process.env[k];
      return v === undefined || v.trim() === '';
    });
    if (usingDefaults.length > 0) {
      console.warn(
        `[env] dev/test（PROCESS=${proc}）使用默认值（生产将拒绝启动）：${usingDefaults.join(', ')}`,
      );
    }
  }

  return cached;
}
