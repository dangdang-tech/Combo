# platform/config — 环境配置

这个目录负责解析并校验 Authoring API 的环境变量，是服务配置的唯一入口。

## 文件

- `env.ts` 定义 PostgreSQL、热态 Redis、MinIO、链路追踪、不可变发布身份、公开站点、邮箱认证和乐收赢支付配置。production 模式必须显式提供严格逗号列表 `PUBLIC_APP_ORIGINS`、布尔字符串 `SESSION_COOKIE_SECURE`、`RESEND_API_KEY`、精确发件身份 `Combo <auth@buildwithcombo.com>` 与不少于三十二字符的 `OTP_HMAC_SECRET`。开发和测试可为本地邮件 mock 使用语法有效的邮箱；安全 Cookie 只与 HTTPS origin 搭配，本地 HTTP Cookie 只与 HTTP origin 搭配。生产模式把 Resend 基址固定为官方 HTTPS 地址，校验错误只列配置键名。

支付默认关闭。充值金额由调用方在 HTTP 边界直接提交，进程内不配置套餐，金额受上下限约束；通知地址必须是 HTTPS 且路径固定为支付通知端点。网关环境只能选择 Test 或 Production，Production 还要求独立开关并且发布身份必须是 production。任何缺失或矛盾配置都会拒绝启用支付，错误只列配置键名，不输出密钥或 URL 值。

## 上下游

API 入口调用 `loadEnv`。`bootstrap/app.ts` 使用公开站点列表建立精确 CORS 边界，认证 handler 与中间件使用显式 Cookie 安全开关；`platform/infra/` 使用其余配置构造数据库、热态 Redis、对象存储、邮件和支付客户端。

开发和测试环境保留本地基础设施默认值，但邮箱认证调用仍需要显式注入 Resend 与 HMAC 配置。`RESEND_API_BASE_URL` 只允许在开发或测试环境指向本地 mock，生产环境不能覆盖官方基址。
