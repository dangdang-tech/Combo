// 基础设施容器把数据库、热态 Redis、邮件、支付与认证限流端口注入 Fastify。
// 业务 handler 只经 req.server.infra 使用这些实例，不在模块内自行创建外部客户端。
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { billingConfigurationFromEnv, type BillingConfiguration, type Env } from '../config/env.js';
import { getPool } from './db.js';
import { getHotRedis } from './redis.js';
import { createResendEmailSender, type ResendEmailPort } from './resend.js';
import { createRedisAuthRateLimiter, type AuthRateLimitPort } from './auth-rate-limit.js';
import { createLeshouyingGateway, type PaymentGateway } from './leshouying/index.js';

/** 注入到 Fastify 的基础设施上下文（端口接口，实现可替换/可 mock）。 */
export interface InfraContext {
  env: Env;
  db: Pool;
  redisHot: Redis;
  resend: ResendEmailPort;
  authRateLimiter: AuthRateLimitPort;
  billing: BillingConfiguration;
  paymentGateway: PaymentGateway;
}

/** 组装基础设施上下文（惰性客户端，骨架阶段不强连）。 */
export function buildInfra(env: Env): InfraContext {
  // 热态 Redis 只承载认证软限流；认证事实与计费事实仍在 PostgreSQL。
  const db = getPool(env);
  const redisHot = getHotRedis(env);
  return {
    env,
    db,
    redisHot,
    resend: createResendEmailSender(env),
    authRateLimiter: createRedisAuthRateLimiter(redisHot),
    billing: billingConfigurationFromEnv(env),
    paymentGateway: createLeshouyingGateway(env),
  };
}

export * from './db.js';
export * from './redis.js';
export * from './object-store.js';
export * from './resend.js';
export * from './auth-rate-limit.js';
export * from './auth-session.js';
export * from './leshouying/index.js';
