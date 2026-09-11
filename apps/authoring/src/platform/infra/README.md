# platform/infra — 基础设施客户端

这个目录放外部依赖的客户端与最小接口，包括 PostgreSQL、热态 Redis、MinIO、Resend、乐收赢、认证软限流和本地会话读取。客户端默认惰性连接，业务模块只消费最小查询或存储接口。

## 文件

- `index.ts` 组装并导出基础设施容器。API handler 从容器取得数据库、热态 Redis、对象存储、Resend 邮件端口、认证限流端口、充值配置和支付网关端口。
- `db.ts` 管理 PostgreSQL 连接池，提供可注入的最小查询接口、时间映射、就绪探针和关闭函数。
- `db-tx.ts` 把单连接的开始、提交、回滚和释放收口为事务工具。
- `redis.ts` 管理热态 Redis。它只承载认证软限流，不保存身份或会话真值；命令只允许一次请求重试并使用短连接超时，使 challenge 在连接失败或断线时快速失败关闭、verification 快速回落 PostgreSQL 硬限制，同时保留后台重连。
- `auth-rate-limit.ts` 使用 Lua 原子递增 HMAC 摘要键。新验证码请求按客户端地址每小时限制二十次，验证码验证按目标和客户端地址执行十分钟附加窗口。
- `auth-session.ts` 校验不透明会话值的固定格式，计算完整 Cookie 值的 SHA-256，并只读 `auth_sessions` 与 `users`。Cookie 名由中间件按显式安全策略选择；它把未知、过期和已撤销会话归为无效，把停用用户单独归为禁止访问。
- `resend.ts` 使用 Node 内置 `fetch` 调用 Resend `/emails`。它设置五秒总超时和挑战编号幂等键，只返回受理、永久收件人拒绝、暂时故障或配置故障。四百状态固定视为请求配置故障；四百二十二状态只读取四 KiB 内的错误名和消息，并且只有白名单收件人错误保持防枚举受理语义。供应商正文不会进入日志或外部响应。
- `object-store.ts` 用 AWS S3 客户端对固定 `combo-artifacts` 桶提供不可覆盖字节原语，通过条件写入和有界回读确认幂等重试中的 exact bytes。它不提供预签名、列举、删除或可变对象接口。
- `leshouying/` 实现二维码支付（C扫B `/v3/prepay`）、支付查单、响应验签和交易通知验签。测试与正式基址固定在适配器中，任何有副作用的 POST 都不会自动重试。

## 上下游

`bootstrap/app.ts` 调用 `buildInfra` 并把结果注入 Fastify。account 模块使用数据库事务、Resend 和认证限流；鉴权中间件使用本地会话读取；Agent Draft、Transfer 与发布模块使用数据库和不可变对象存储。

配置来自 `platform/config/env.ts`。就绪探针检查 PostgreSQL、`redis-hot` 和 MinIO；Resend 与可选的乐收赢支付网关不参加就绪探针，因为这些依赖故障不能阻断已有会话和业务读取。
