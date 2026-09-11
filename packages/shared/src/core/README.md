# core — 契约地基

这个目录定义与具体业务无关的基础契约：ID 与时间格式、响应包络、错误、健康检查、发布身份和链路追踪。domains 与应用都建立在它之上，core 不引用 domains。

## 文件

- `ids.ts` 定义对外字符串 ID、traceId 和 ISO 8601 时间三个基础 schema，全库对外 ID 一律是 UUID v7 字符串。
- `envelope.ts` 定义统一成功响应包络（`data` 加可选 `meta`）和它的 schema 工厂函数，`meta` 里可携带 traceId、占位说明和降级标记。
- `errors.ts` 定义对外错误信封（只含人话文案、退路动作、可否重试和 traceId，绝不含内部错误码）、内部错误码常量表 `ErrorCode`、每个码对应 HTTP 状态与缺省文案的分类表 `ERROR_CLASSIFICATION`，以及按码组装错误体的 `errorBodyFor`。
- `health.ts` 定义 `/health` 与 `/ready` 两个探针的响应契约。数据库、热态 Redis 和 MinIO 计入就绪；外部邮件与支付供应商不计入就绪。
- `trace.ts` 提供 traceId 工具：UUID 与 W3C traceparent 请求头格式互转、从请求头或 URL 参数提取 traceId、生成新的 traceId 和 spanId。
- `release.ts` 定义运行时发布身份 schema、环境变量映射和无缓存加载函数。加载函数校验完整 source SHA、确定性 releaseId、构建时间及两个摘要，并把网络、HTTP 和畸形响应收敛成稳定失败分类。
- `index.ts` 汇总转出以上保留文件。

## 上下游

authoring 用错误码、`errorBodyFor` 和 trace 工具做全局错误处理与链路透传，并用健康契约实现探针。Web 使用 `release.ts` 从同源静态文件读取发布身份；非开发构建只有通过 schema 校验后才渲染应用。

## 错误边界

验证码不存在、错误、过期、失效、已消费或尝试耗尽都使用 `AUTH_OTP_INVALID` 的相同内部分类和文案，不能通过响应区分内部状态。`AUTH_ACCOUNT_DISABLED` 表示已经找到有效认证主体但账号被停用。认证响应只包含用户文案、退路动作、可否重试和 traceId，不包含公开或内部错误码、供应商正文或堆栈。
