# platform/infra —— 外部资源客户端

这个目录封装 runtime 使用的数据库、Redis、对象存储和模型配置，并把常用能力聚合为基础设施容器。客户端采用惰性创建，引入模块本身不会主动连接外部服务。

## 文件

- `index.ts` 定义 `InfraContext` 和 `buildInfra`，并统一导出本目录的基础设施能力。
- `db.ts` 封装 PostgreSQL 连接池，定义仓储与会话读取共用的最小查询接口，并提供事务工具、就绪探针和优雅关闭。
- `auth-session.ts` 校验不透明会话值格式，对完整 Cookie 值计算 SHA-256 摘要，只读联查 `auth_sessions` 与 `users`。Cookie 名由中间件按环境选择；生产只接受 `__Host-cb_session`，本地 HTTP 开发测试只接受 `cb_session`。它把未知、过期和已撤销会话收口为无效状态，把停用账号单独返回，并让数据库异常交给中间件映射为 503。
- `redis.ts` 惰性维护普通命令连接和专用订阅连接，提供就绪探针和统一关闭函数。
- `redis-interrupt-bus.ts` 提供进程内与 Redis 两种打断广播总线。Redis 实现使用固定频道向各实例广播尽力而为的打断信号。
- `redis-event-log.ts` 使用 Redis Stream 保存会话事件，刷新六小时有效期并按两万条上限近似修剪，同时支持按事件编号补发。
- `event-bus.ts` 使用 Redis 发布订阅实现会话事件直播，并保留只供单元测试使用的内存实现。
- `object-store.ts` 封装对象存储，只提供文本读取、字节读取、对象写入、就绪探针和关闭函数。
- `llm.ts` 解析 Anthropic 与 OpenRouter 的模型及凭据，并向就绪探针报告当前是否具备可用模型密钥。

## 上下游

`bootstrap/app.ts` 调用 `buildInfra` 并把结果挂到 Fastify 应用。业务处理器从请求所属应用读取数据库、对象存储、事件总线和事件日志。`platform/middleware/auth.ts` 使用 `auth-session.ts` 读取共享会话，`platform/http/health.ts` 检查数据库、Redis 与对象存储，`modules/agent/` 使用事件和模型基础设施。

本目录读取 `platform/config/env.ts` 的配置，并访问 PostgreSQL、不可驱逐的 `redis_queue` 实例和 S3 协议对象存储。浏览器认证没有远端身份服务依赖，runtime 也不持有验证码、邮件或会话签发密钥。
