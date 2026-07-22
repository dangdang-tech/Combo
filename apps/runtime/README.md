# apps/runtime（试用端 · 能力项播放器）

创作者对某个 Capability 开会话试用的独立后端：形态类 Claude Artifacts（左聊天流右产物画布）。
对话生成在接收请求的实例内异步运行，生命周期不绑定 HTTP 连接。每次提交都会创建独立自治轮次并返回 202，同一会话可以并发运行多轮。打断请求通过 Redis 广播尽力送达任意实例。

## 与 authoring 的边界（铁律）

- 只依赖 `@cb/shared`，**禁止 import `apps/authoring/**` 的任何代码\*\*。
- 两个服务只在两处相遇：同一个 PG（读 `capabilities` 表并写试用层三表
  `sessions/messages/artifacts`）和 MinIO（按 `capabilities.storage_key`
  读 CapabilityDefinition JSON，桶 `combo-artifacts`）。
- 身份：读取 authoring 签发的同一枚不透明 Cookie。生产只接受主机限定的 `__Host-cb_session`，本地 HTTP 开发测试只接受 `cb_session`。runtime 只计算摘要并只读同库的 `auth_sessions` 与 `users`，不签发会话、不创建用户，也不接受 Bearer 或查询串令牌。

## 结构

- `platform/`：config/env · infra（db / PostgreSQL 会话读取 / redis / object-store / llm provider / Redis 事件日志与跨实例事件总线）· middleware/auth（登录态校验）· http（错误信封 / 健康检查 / 低敏 client-events）· observability。
- `modules/capability/`：loader 只放行本人能力或已发布能力，随后从 MinIO 读取定义并完成 schema 校验；无法识别版本时返回「能力格式过新」。该模块同时提供试用入口列表。
- `modules/session/`：sessions/messages 两表 SQL（按 turnId 与 idx 写入；content 写入前
  过 pi 原生消息块 schema，坏块拒写）· 会话端点 handler。
- `modules/agent/`：build-agent（instructions 组系统提示词 + messages 历史以 pi 原生格式喂回）·
  run-turn（自治轮次编排、pi 事件翻 AG-UI 与事件双写）· stream（SSE，Last-Event-ID 补发 + 实时）·
  event-log / turn-emitter。
- `modules/artifact/`：upsert_artifact pi 工具（内容写 MinIO `artifacts/{sessionId}/{artifactId}`，
  无版本原地覆盖）· 内容回读端点。
- `processes/api.ts`：Fastify HTTP + SSE 单进程入口（默认端口 3100，避开 authoring 的 3000）。

## 对话线协议：AG-UI

pi 是执行层，事件依次翻成标准 AG-UI 的 `RUN_STARTED`、`TEXT_MESSAGE_START/CONTENT/END` 和 `RUN_FINISHED`。失败或打断使用终态 `RUN_ERROR`；产物使用共享状态 `STATE_DELTA`（`add /artifacts/<id>` 和 `/activeArtifactId`）。
Redis Stream 保存进行中轮次的有序事件日志，断线连接凭 Last-Event-ID 补发后切到 Redis 发布订阅直播。事件流最多保留 20000 条，并在六小时闲置后过期；历史轮次以 `messages` 表为真源。
正常结束把整轮 assistant/toolResult 消息落 `messages`（completed），失败/打断落一条 failed 消息。

## LLM provider

`pi` 执行层支持双 provider，按 key 自动判定（或显式 `RUNTIME_LLM_PROVIDER`）：

- `anthropic`：直连，读 `ANTHROPIC_API_KEY`，默认模型 `claude-sonnet-4-5`（可 `RUNTIME_LLM_MODEL` 覆盖）。
- `openrouter`：OpenAI 兼容（与本仓 authoring 同口径），读 `OPENROUTER_API_KEY`，默认 `anthropic/claude-sonnet-4.6`。

缺 key 不阻塞启动，仅对话轮次降级报错、`/ready` 标 degraded。

## 端点

全部在 `/api/v1` 前缀下、全部要求登录态（SSE 仅同源 Cookie）：

- `GET  /runtime/capabilities` 试用入口列表（我的全部 + 已发布的）
- `POST /runtime/sessions` 开会话 · `GET /runtime/sessions` 我的 active 会话列表（可带 `?capabilityId=` 只列某个能力下的会话）
- `GET  /runtime/sessions/:id` 详情（消息按 seq + 产物 + 能力摘要，含定义里的开场表单字段与提示语）
- `PATCH /runtime/sessions/:id` 会话改名 · `DELETE /runtime/sessions/:id` 软归档
- `POST /runtime/sessions/:id/messages` 发消息（异步生成并始终返回 202；并发提交各自创建轮次）
- `POST /runtime/sessions/:id/interrupt` 打断当前轮
- `GET  /runtime/sessions/:id/stream` 流式生成事件（SSE，心跳 15s，Last-Event-ID 续传）
- `GET  /runtime/artifacts/:id/content` 产物内容回读（带正确 Content-Type）
- `GET /health` · `GET /ready`（db/minio/redis_queue 为必需依赖，llm 缺凭据时为 degraded）

## 本地起跑

```bash
# 1) 建库并执行全部迁移后，用 authoring 完成上传与提取来产出能力项，或手工写入 capabilities 行和 MinIO 定义。

# 2) 起 api（默认 3100；REDIS_URL 必须指向不可驱逐的 Redis；数据库需已执行 0004 认证迁移）
DATABASE_URL=... REDIS_URL=redis://localhost:6379 S3_ENDPOINT=http://localhost:9000 \
  OPENROUTER_API_KEY=... RUNTIME_LLM_PROVIDER=openrouter \
  PORT=3100 NODE_ENV=development pnpm -F @cb/runtime dev
```

`REDIS_URL` 是必填连接串，必须指向采用 noeviction 策略的 redis_queue 实例，不能指向会驱逐键的 redis_hot。每个运行实例保留自己的执行句柄，Redis 广播跨实例打断信号并承载事件流。打断是尽力而为的瞬时控制；超过三十分钟仍为 running 的孤儿轮次由周期清扫器补失败消息和终态事件。
