# platform/observability — 链路追踪

这个目录负责进程级链路追踪（OpenTelemetry，分布式调用链追踪标准）的启动，以及把当前追踪上下文转成日志字段和响应头的工具函数。

## 文件

- `node.ts` 启动 NodeSDK 和自动埋点，并在 span 导出前删除原始 URL 查询、客户端地址、请求头、请求正文、异常消息和状态消息。只有配置了 OTLP 导出端点才启用网络导出。该文件还提供当前 traceId、结构化日志字段和 W3C traceparent 响应头的读取函数，并导出可由内存导出器测试的安全包装器。

## 上下游

`processes/api.ts` 启动时调用 `startNodeObservability` 并在退出时关闭；`bootstrap/app.ts` 在请求钩子里使用 `currentTraceId`、`currentTraceLogFields` 和 `currentTraceparent` 写响应头与请求日志；`platform/http/client-events.ts` 记录浏览器上报事件时读取低敏日志字段。

该目录依赖 OpenTelemetry 系列包、`@cb/shared` 的 traceId 转换工具和 `platform/config/env.ts` 的 Env 类型。配置了 `OTEL_EXPORTER_OTLP_ENDPOINT` 时向该 Collector 端点发送 trace 数据，未配置则不发任何网络请求。
