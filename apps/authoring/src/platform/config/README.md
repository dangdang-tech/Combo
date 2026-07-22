# platform/config — 环境配置

这个目录负责解析并校验 authoring 两个进程的环境变量，是服务配置的唯一入口。

## 文件

- `env.ts` 定义 PostgreSQL、双 Redis、MinIO、大模型、链路追踪、公开站点和邮箱认证配置。生产 API 进程必须显式提供 `PUBLIC_APP_ORIGIN`、`RESEND_API_KEY`、语法有效的 `RESEND_FROM_EMAIL` 与不少于三十二字符的 `OTP_HMAC_SECRET`；worker 不要求也不消费这些认证密钥。发件人可以是裸邮箱或带显示名的邮箱，任何非空错误格式都会在启动时被拒绝。生产环境把 Resend 基址固定为官方 HTTPS 地址，并要求公开站点使用 HTTPS origin。校验错误只列配置键名，不输出配置值。

## 上下游

API 与 worker 入口调用 `loadEnv`。`bootstrap/app.ts` 使用公开站点配置建立 CORS 边界，`platform/infra/` 使用其余配置构造数据库、Redis、对象存储、邮件和大模型客户端。

开发和测试环境保留本地基础设施默认值，但邮箱认证调用仍需要显式注入 Resend 与 HMAC 配置。`RESEND_API_BASE_URL` 只允许在开发或测试环境指向本地 mock，生产环境不能覆盖官方基址。
