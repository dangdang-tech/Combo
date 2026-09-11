# modules/agent-package-release — Agent Transfer 与公开交付

## 浏览器授权的 Agent Transfer

`transfer-routes.ts` 提供 10 个 Test-only 端点；仅 `COMBO_ENVIRONMENT=test` 注册，Preview/Production 不开放。链接 origin 只来自已验证的 `PUBLIC_APP_ORIGINS` 首项，不读取 Host 头。

- `transfer-contract.ts` 定义严格元数据、精确双摘要确认和白名单回执。Desktop 先在本地生成短期上传 secret，
  服务端只收 SHA-256；secret 不进入 URL、浏览器、回执、日志或公开 Package。数据库固定 10 分钟有效期。
- `transfer-service.ts` 区分 metadata intent、Cookie 账户批准、Bearer 私有上传与只读恢复。只有批准过的精确
  request ID、名称、Draft fingerprint 和 Package digest 才能写入。状态行锁和私有 Draft 仓储复用同一连接/事务，
  不嵌套 checkout；重复请求回读原结果。事务使用局部语句/锁超时；HTTP 对象操作有合计 30 秒与请求中断信号。
- `publication-service.ts` 要求独立 Cookie + exact Origin + `confirmPublic:true`。短期上传 secret 不能发布。
  它回读账户已保存的精确 Draft/Package，先写不可覆盖公共文件，再按账户与原始请求 ID 追加 claim/Release 并推进 phase，
  后三项同事务；失败可留下无公开 Release 的不可变对象，但不能留下部分公开结果。多个账户可以独立发布相同 digest，
  历史 Package owner 不被改写。已上传内容可在 token 过期后由同一 Cookie 账户继续查看和明确发布。
- `publication-objects.ts` 限制 manifest、文件数量、路径和总字节，对每份文件校验 exact digest；资源先于清单写入且全部回读。
  公共 GET 仅返回未撤销的 `public_link` Release 与完整核验后的 Package，下载是裸 Package JSON；不含私有 Draft、
  creator request、账户邮箱、上传 secret 或原对话。公开请求不解析会话，不安装、不试跑，来源固定 `not_verified`。
- `receiver-handoff.ts` 从已核验且未撤销的公开 Release 生成 Codex 或 Claude Code 共用的接收说明与可复制指令。它只由 Creator Worker 的显式 `agent-package-receiver` 出口定位构建目录，读取严格四平台清单，并在二进制下载前用有界流重新核对摘要，绝不在 API 中
  导入或执行安装器。资产缺失、摘要地址过时或 Release 不可用时失败关闭。接收说明不保存 Project 路径、用户
  凭据或运行结果；项目选择、下载后独立验码、安装和当前对话应用都由使用者自己的客户端执行。

匿名 `GET /agent-package-publications/:releaseId/codex-installation` 返回固定版本四平台二进制的地址、摘要、大小、调用参数和
安全步骤；`GET /agent-package-receivers/v2/:artifactFile` 只返回与当前清单匹配且重新核验摘要的原始二进制流。两者不
解析 Cookie、不写数据库、不安装任何内容，仍受 Test-only、无查询参数、速率和 `no-store` 边界约束。接收器只
支持轻量文本方法；文本存储不代表所需工具已满足。安装、离线完整性、同任务应用及真实推理必须分别验收。
路径中的 `codex-installation` 和原 handoff 协议名为兼容保留，不要求另开 Codex 任务。Claude Code 必须明确读取
已经验证的原包，不假定它自动发现 `.agents/skills`；两种客户端都不能从 MCP 工作目录猜测当前项目。

所有新接口返回安全错误与 `no-store`。Desktop 请求拒绝 Cookie、Origin、Fetch Metadata 的 Site、Dest、User
和查询参数凭据；Mode 只允许缺失或 Node 原生 fetch 固定附加的 `cors`，它不提供认证，也不豁免其他浏览器信号。
浏览器写入在解析正文前检查 Cookie 与精确来源。元数据/确认体 4 KiB，上传体 1 MiB，均有独立速率限制。GET 不推进状态。
当前轻量 Test 客户端和页面只使用配置中的同一个规范公开 origin，不支持把第二个登录 allowlist origin 当作分享入口。
错误或超时不得换 request ID 自动发布；应先 GET 原意图确认事实，再由用户明确重试相同请求。
数据库依赖主线 `0020` 私有快照与 `0021` claims、revocations、transfer 状态机；不在请求中建表或修改旧数据。
这些是实现与测试边界，不等同真实对象存储、部署、浏览器 UAT 或使用者实际加载验收已通过。

## 文件

- `transfer-contract.ts` 定义 Transfer 的严格输入、摘要确认和回执。
- `transfer-routes.ts` 注册私有意图、账户批准、上传、恢复、发布与匿名读取端点。
- `transfer-service.ts` 在 PostgreSQL 事务内推进 Transfer 状态机，并复用私有 Draft 仓储。
- `publication-objects.ts` 验证并写入不可覆盖的公开 Package 文件。
- `publication-service.ts` 处理用户明确确认的公开发布事务。
- `receiver-handoff.ts` 生成接收说明并校验接收器构建资产。

## 上下游

路由由 `bootstrap/routes.ts` 在 Test 环境挂到 `/api/v1`。模块使用 Creator Agent 协议校验唯一 Agent Package 与 Release 合同，使用 `platform/infra/object-store.ts` 对固定 `combo-artifacts` 桶执行有界、不可覆盖的字节写入，并通过 `combo_api` 数据库角色访问 Registry。

数据库结构来自主线迁移，模块不在请求中建表或回退创建结构。公开 Release 不维护 latest 指针，不接受客户端对象键或 owner，也不修改支付事实。

接收说明采用 V2 协议，用户无需 Node 或 Bun；首次下载、独立验码及直接执行均由 Host 完成。API 读取小型清单而不在每次交接时加载四份运行时；下载单个产物时保持固定文件描述符、长度上限与摘要校验。旧摘要 URL 不会改指向新内容，原 Agent Package 保持不变。
