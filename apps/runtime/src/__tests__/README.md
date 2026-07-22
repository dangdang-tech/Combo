# runtime 源码测试

这个目录保存 runtime 的单元测试和轻量集成测试。测试使用内存假件验证业务规则，不依赖正在运行的外部服务。

## 文件

- `auth-session.test.ts` 验证生产与本地 Cookie 选择、父域无前缀 Cookie 忽略、PostgreSQL 不透明会话的摘要查询、账号停用状态、普通请求守卫和流式请求守卫，并确认 401、403、503 的边界。
- `browser-origin.test.ts` 验证凭据型 CORS 只反射唯一公开站点，并确认同站子域即使携带有效格式 Cookie 也不能执行写处理器。
- `env-auth.test.ts` 验证生产配置不包含远端身份服务或本地令牌签名配置，同时继续要求 runtime 自身的数据库、Redis 和对象存储配置。
- `health.test.ts` 验证就绪探针只包含数据库、对象存储、Redis 和模型凭据，不包含远端身份服务。
- `http-logging.test.ts` 验证请求完成日志只使用路由模板，并验证浏览器事件日志只使用固定路由桶，不保留 pathname、查询参数、凭据或用户输入。
- `observability-redaction.test.ts` 使用内存 span 导出器验证查询凭据、客户端地址、请求头、正文和异常文本在导出前被删除。
- `artifact.test.ts` 验证产物工具的写入、覆盖和读取行为。
- `build-agent.test.ts` 验证能力定义、历史消息和模型配置组装为对话代理的规则。
- `loader.test.ts` 验证能力可见性、对象读取和能力定义版本校验。
- `routes.test.ts` 验证路由注册、资源归属校验、会话列表筛选和会话详情。
- `run-turn.test.ts` 验证自治轮次执行、消息落库、产物事件和失败收口。
- `session-repo.test.ts` 验证会话与消息仓储的查询、排序和写入规则。
- `stream-events.test.ts` 验证流式事件编号、补发、去重和心跳相关规则。
- `turn-control.test.ts` 验证轮次打断、超时和终态竞争的处理。
- `turn-repo.test.ts` 验证轮次仓储的创建、终结和孤儿轮次清理。
- `fakes.ts` 提供测试共用的内存数据库、对象存储、事件日志和对话代理假件。

这些测试消费 `platform/` 和 `modules/` 的公开函数。生产源码不反向引用本目录。
