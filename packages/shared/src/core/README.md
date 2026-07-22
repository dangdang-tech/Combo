# core — 契约地基

这个目录定义与具体业务无关的基础契约，包括 ID 与时间、响应包络、分页、错误、进度、流式帧、健康检查和链路追踪。domains 与两个服务都建立在这一层之上，core 不引用 domains。

## 文件

- `ids.ts` 定义对外字符串 ID、traceId 和 ISO 8601 时间 schema。全库对外 ID 使用字符串表示。
- `envelope.ts` 定义通用成功响应包络和 schema 工厂函数。包络由 `data` 与可选 `meta` 组成，`meta` 可以携带 traceId、分页、占位说明和降级标记。
- `pagination.ts` 定义游标分页请求与响应形状，并提供不透明游标的编码和解码函数。解码失败由接口层映射为 400。
- `errors.ts` 定义不含公开错误码的对外错误信封、内部错误分类和组装函数。邮箱验证码无效固定映射为 401，停用账号固定映射为 403，数据库、限流存储和邮件依赖故障复用 503 分类。
- `progress.ts` 定义任务进度视图和提取流水线的标准子任务顺序。
- `sse.ts` 定义 SSE（服务端事件推送）的七种帧类型、各帧 schema 和默认心跳间隔。
- `health.ts` 定义 `/health` 与 `/ready` 契约。数据库、两个 Redis 连接和 MinIO 计入就绪，模型服务只影响降级状态；外部邮件供应商不计入就绪。
- `trace.ts` 提供 traceId 工具，包括 UUID 与 W3C traceparent 格式转换、请求值提取和新编号生成。
- `index.ts` 汇总导出以上文件。

## 错误边界

验证码不存在、错误、过期、失效、已消费或尝试耗尽都使用 `AUTH_OTP_INVALID` 的相同内部分类和文案，不能通过响应区分内部状态。`AUTH_ACCOUNT_DISABLED` 表示已经找到有效认证主体但账号被停用。认证响应只包含用户文案、退路动作、可否重试和 traceId，不包含公开或内部错误码、供应商正文或堆栈。

## 上下游

runtime 与 authoring 的全局错误处理、HTTP 辅助函数、健康检查、观测和 SSE 实现使用本目录定义。业务域 schema 引用 ID、时间、错误体与包络工具。认证接口在 domains 中使用 traceId 基础 schema 建立强制 `meta.traceId` 的专用成功包络。
