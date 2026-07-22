# platform/config —— 环境变量

这个目录负责 runtime 进程环境变量的定义、加载与校验，是服务配置的唯一入口。

## 文件

- `env.ts` 使用 zod 定义端口、日志、数据库、Redis、对象存储、模型、公开站点来源和观测配置。`loadEnv` 会缓存解析结果；生产模式缺少数据库、Redis、对象存储或 `PUBLIC_APP_ORIGIN` 时直接拒绝启动，并要求公开站点是 HTTPS origin。开发与测试模式可以使用本地默认值并输出缺失配置名。模型密钥不是启动必填项，缺失时只让对话轮次降级。浏览器认证只读 PostgreSQL 会话，因此这里没有远端身份服务、令牌验签、开发登录或会话签名配置。

## 上下游

`processes/api.ts` 和 `bootstrap/app.ts` 在启动时调用 `loadEnv`。`platform/infra/`、`platform/observability/node.ts` 与 `modules/agent/build-agent.ts` 消费导出的 `Env` 类型。

这个目录只依赖 zod 和 `process.env`，不引用其他项目源码目录。
