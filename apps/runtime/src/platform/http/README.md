# platform/http —— HTTP 公共设施

这个目录保存不属于具体业务模块的路由工具、浏览器来源边界、统一错误回复、Fastify 类型增强、健康检查和浏览器事件接收端点。

## 文件

- `_helpers.ts` 定义统一端点声明、批量注册函数和 `sendError`。对外错误只返回共享错误信封，不暴露内部错误码或堆栈。
- `browser-origin.ts` 校验唯一的 `PUBLIC_APP_ORIGIN`，为凭据型跨域响应执行精确匹配，并拒绝来自同站子域或跨站来源的 Cookie 鉴权写请求。
- `fastify.ts` 为 Fastify 补充 `app.infra`、`app.turns` 和 `req.auth` 类型，由 `bootstrap/app.ts` 以副作用方式加载。
- `health.ts` 注册不带 API 前缀的 `GET /health` 与 `GET /ready`。就绪探针检查数据库、对象存储和 Redis 三项必需依赖，模型凭据缺失只产生降级状态。认证不依赖远端身份服务，邮件供应商也不影响已有会话，所以两者都不在就绪探针中。
- `client-events.ts` 注册 `POST /client-events`。它校验浏览器事件后只记录事件类型、traceId 和服务端固定的低基数路由桶。客户端 URL 与 route 只参与分类，原始 pathname、动态段、查询参数、消息和堆栈都不会写入日志；无法识别时只记录 `unknown`，端点始终返回 204。

## 上下游

业务路由和流式处理器使用 `_helpers.ts`。会话模块的 POST、PATCH 与 DELETE 端点在认证前使用 `browser-origin.ts`，读取端点不要求浏览器来源。`bootstrap/app.ts` 使用同一来源配置注册精确 CORS 和健康检查，并负责关闭 Fastify 默认原始请求日志，只在请求完成时记录方法、路由模板、状态和 traceId。

本目录使用 `platform/infra/` 的就绪探针与 `platform/observability/node.ts` 的追踪字段。错误分类、健康契约和响应信封来自 `@cb/shared`。
