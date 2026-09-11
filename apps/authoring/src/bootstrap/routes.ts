// 业务路由聚合：认证、计费、Agent Draft 与 Agent 交付全部挂在 API_PREFIX 下。
import type { FastifyInstance } from 'fastify';
import { API_PREFIX } from '@cb/shared';
import { ACCOUNT_ENDPOINTS, registerAccountRoutes } from '../modules/account/routes.js';
import { BILLING_ENDPOINTS, registerBillingRoutes } from '../modules/billing/routes.js';
import { registerClientEventRoutes } from '../platform/http/client-events.js';
import type { EndpointDecl } from '../platform/http/_helpers.js';
import { AGENT_DRAFT_ENDPOINTS, registerAgentDraftRoutes } from '../modules/agent-draft/routes.js';
import {
  AGENT_TRANSFER_ENDPOINTS,
  registerAgentTransferRoutes,
} from '../modules/agent-package-release/transfer-routes.js';

/** 全部业务端点声明汇总，供守门测试核对端点数、方法、来源边界和鉴权链。 */
export const ALL_ENDPOINTS: EndpointDecl[] = [
  ...ACCOUNT_ENDPOINTS,
  ...BILLING_ENDPOINTS,
  ...AGENT_DRAFT_ENDPOINTS,
  ...AGENT_TRANSFER_ENDPOINTS,
];

/** 注册全部业务路由（API_PREFIX 子作用域）。 */
export async function registerBusinessRoutes(app: FastifyInstance): Promise<void> {
  await app.register(
    async (scoped) => {
      await registerAccountRoutes(scoped);
      await registerBillingRoutes(scoped);
      await registerAgentDraftRoutes(scoped);
      await registerAgentTransferRoutes(scoped);
      await registerClientEventRoutes(scoped); // 浏览器侧错误/调试事件（只落结构化日志）
    },
    { prefix: API_PREFIX },
  );
}
