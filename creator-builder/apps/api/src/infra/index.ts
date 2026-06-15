// 基础设施容器：把 db/redis/queue/objectStore/llm 端口实例聚成一个上下文，注入 Fastify（app.decorate('infra')）。
// 端口接口来自 @cb/shared（B-04/05/06）；实现在本目录。Phase 3 业务 handler 经 req.server.infra 取用。
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import type { LlmGatewayPort, ObjectStorePort, QueuePort } from '@cb/shared';
import type { Env } from '../config/env.js';
import { getPool } from './db.js';
import { getHotRedis, getQueueRedis } from './redis.js';
import { createBullQueuePort } from './queue.js';
import { createS3ObjectStore } from './object-store.js';
import { createLlmGateway } from './llm-gateway.js';

/** 注入到 Fastify 的基础设施上下文（端口接口，实现可替换/可 mock）。 */
export interface InfraContext {
  env: Env;
  db: Pool;
  redisQueue: Redis;
  redisHot: Redis;
  queue: QueuePort;
  objectStore: ObjectStorePort;
  llm: LlmGatewayPort;
}

/** 组装基础设施上下文（惰性客户端，骨架阶段不强连）。 */
export function buildInfra(env: Env): InfraContext {
  return {
    env,
    db: getPool(env),
    redisQueue: getQueueRedis(env),
    redisHot: getHotRedis(env),
    queue: createBullQueuePort(env),
    objectStore: createS3ObjectStore(env),
    llm: createLlmGateway(env),
  };
}

export * from './db.js';
export * from './redis.js';
export * from './queue.js';
export * from './object-store.js';
export * from './llm-gateway.js';
export * from './logto.js';
