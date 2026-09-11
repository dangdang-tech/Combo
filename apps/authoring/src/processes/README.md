# processes — 进程入口

这个目录只放可独立启动的 API 进程入口。Authoring 镜像不再按环境变量分叉进程。

## 文件

- `api.ts` 是 HTTP 服务进程入口：加载环境配置，启动链路追踪，调 `bootstrap/app.ts` 的 buildApp 构建 Fastify 应用并监听端口。支付启用时，应用内部同时运行带数据库租约的充值查单调度器；收到 SIGINT/SIGTERM 时先停止应用内调度并关闭 Fastify，再关闭追踪导出器后退出。

## 上下游

`src/index.ts` 和容器入口加载 `api.ts`，没有其他代码导入进程入口。

`api.ts` 使用 `platform/config/env.ts`、`platform/observability/node.ts` 和 `bootstrap/app.ts`。Fastify 应用负责关闭数据库、热态 Redis、对象存储与应用内充值查单调度器。
