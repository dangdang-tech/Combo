// Fastify 类型增强：声明中间件注入的请求装饰 + app.infra 基础设施容器。
import type { AuthContext } from '@cb/shared';
import type { InfraContext } from '../infra/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** PostgreSQL、热态 Redis、对象存储、邮件、支付与认证限流容器。 */
    infra: InfraContext;
  }
  interface FastifyRequest {
    /** requireAuth 解出的 Cookie 会话上下文。 */
    auth?: AuthContext;
  }
}

export {};
