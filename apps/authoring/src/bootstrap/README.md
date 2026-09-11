# bootstrap — API 进程组装层

这个目录负责构建 Fastify 应用，注入基础设施容器，注册全局插件、统一错误处理、健康检查和全部业务路由。

## 文件

- `app.ts` 加载环境配置并构造 Fastify。它关闭默认原始请求日志，只记录方法、路由模板、状态和 traceId；认证解析错误不把原始异常写入日志。应用注册 Helmet、精确 CORS、Cookie 和路由级限流插件，认证与 Cookie 鉴权写路由共用同一来源边界。支付启用且不是测试进程时，应用启动多副本安全的充值查单调度器；关闭时先停止调度，再释放数据库、热态 Redis 和对象存储客户端。
- `routes.ts` 把 account、agent-draft、agent-package-release、billing 与浏览器观测路由统一挂到 `/api/v1`，并导出完整端点声明供测试核对。Agent Transfer 与 public-link 入口仅在 `COMBO_ENVIRONMENT=test` 注册；10 个端点将 Desktop 短期上传 secret、浏览器 Cookie 授权/发布与匿名公开回读分开，不开放 Preview/Production 写入。
  匿名接收说明和固定摘要安装器下载同属此边界，不在服务器中执行安装器或取得使用者 Project。

## 上下游

`processes/api.ts` 调用 `buildApp` 后监听端口。`app.ts` 依赖 `platform/config/env.ts`、`platform/infra/index.ts`、`platform/http/`、`platform/observability/node.ts` 和 billing 查单调度器；`routes.ts` 依赖四个业务模块的路由声明。

组合根只负责接线，不实现账号、Draft、Package 发布或充值规则。第一方认证和支付所需的 PostgreSQL、Resend、Redis 与乐收赢端口都由基础设施容器提供，账号事务由 account 模块执行，Transfer 与发布由 agent-package-release 模块执行，充值与入账事务由 billing 模块执行。
