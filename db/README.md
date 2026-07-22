# db — PostgreSQL 迁移

这个目录是数据库结构的唯一真源。迁移基线是 `migrations/0000_baseline_schema.sql`，此后的结构变更只通过新编号文件追加，已经执行的迁移文件不再修改。`0002_drop_stream_events.sql` 删除已经迁移到 Redis Stream 的事件日志表。`0003_turns.sql` 新增自治轮次表，并让新消息按轮次和轮内位置归组。`0004_first_party_email_auth.sql` 在确认 `users` 为空后执行停机式认证切换，删除旧外部身份列，并建立邮箱验证码和 PostgreSQL 不透明会话所需结构。`0005_application_database_roles.sql` 把迁移所有者与三个业务进程的数据库权限分开。

基线定义了 `gen_uuid_v7()` 函数，所有认证表与主要业务表的主键都默认使用时间有序的 UUID。上传原始件、能力定义和会话产物正文等大内容不进入数据库，数据库只保存 MinIO 对象键和状态。

## 表

- `users` 是业务主体与权限的唯一真源。它保存账号、角色、创建时间、最近登录时间和停用时间，全库所有归属字段都引用稳定的 `users.id`。
- `auth_identities` 保存已经验证的规范邮箱。当前只允许 `provider='email'` 与 `issuer='local'`，同一邮箱只能属于一个用户，同一用户只能有一个邮箱身份。
- `auth_otp_challenges` 保存邮箱登录挑战的目标摘要、验证码摘要、尝试次数、五分钟期限、激活时间和互斥终态。该表不保存邮箱或验证码原文。
- `auth_sessions` 保存浏览器会话的 SHA-256 摘要、所属用户、认证方式、固定期限和撤销时间。该表不保存 Cookie 原文，也不提供刷新令牌。
- `auth_audit_events` 保存固定认证事件、固定结果、目标摘要、会话编号、traceId 和受限的低敏结果枚举。该表没有邮箱、验证码、Cookie、供应商令牌或原始错误的字段。
- `tasks` 是一次上传任务的聚合根，用步骤和状态两个正交字段表达进展，并带幂等键、重试计数、最后错误和 worker 租约字段。
- `uploads` 与任务一对一，记录配对码哈希、分片对账表和原始件清除时间。`parts` 列是 worker 逐片读取分片的键清单真源；`storage_key` 已不再写入，保留用于兼容历史清理。
- `capabilities` 是提取产出的能力项轻量索引，发布标记与分享令牌保存在该表，完整可运行定义按 `storage_key` 存入 MinIO。
- `sessions` 是一次试用对话会话，引用被试用的能力项和会话归属人。
- `turns` 是会话下的自治任务，以服务端生成的运行编号为主键，并用运行态条件更新协调收尾。历史只读取已完成轮次，因此运行中、失败或中断轮次的半截消息不可见。
- `messages` 是会话内的定稿消息，内容使用 agent 原生分块格式的 JSON。存量消息保留会话序号；新消息改用轮次编号和轮内位置排序。
- `artifacts` 是会话交互产物的索引，正文存入 MinIO，行内只保存类型、标题和对象键。
- `audit_llm_calls` 为每次大模型调用记录 token 用量与费用，只用于审计，不是计费真源。
- `schema_migrations` 由迁移脚本创建，记录已经执行的迁移文件。

## 第一方认证约束

`0004_first_party_email_auth.sql` 先取得 `users` 的排他锁，再检查表中是否存在任何用户。非空数据库会以 SQLSTATE `55000` 整笔失败，旧身份不会被静默删除。空库通过门禁后，迁移删除 `logto_user_id` 与 `email`，增加 `disabled_at`，把账号限制为 `creator-` 加八位小写 Base32，并把角色限制为唯一的 `creator` 值。

身份、挑战和会话只允许本期邮箱登录值。目标摘要、验证码摘要和会话摘要都必须正好为三十二字节。活动挑战使用部分唯一索引保证同一目标最多一条未结束记录；最近请求、全站预算和清理查询各有对应索引。会话最长七天，撤销时间不得早于创建时间。认证审计的 `details` 只能为空对象或只含一个固定 `result` 枚举。

## 数据库角色

迁移容器使用数据库所有者连接，只负责结构变更和授权。`combo_api` 可以读写认证表以及 authoring 的任务、上传和能力表；`combo_worker` 只能读写提取流水线业务表；`combo_runtime` 只能读取 `users`、`auth_sessions` 与 `capabilities`，并读写试用会话、轮次、消息和产物表。runtime 与 worker 都不能插入或更新认证会话。

## migrate 脚本

`scripts/migrate.ts` 按文件名字典序执行 `migrations/` 下尚未记账的 SQL 文件。每个文件和对应的 `schema_migrations` 记账写入位于同一个事务中。迁移完成后，`scripts/provision-app-roles.ts` 可以从三个独立密码环境变量启用固定应用角色；密码不写入迁移或日志。`pnpm migrate` 执行迁移，`pnpm migrate:status` 只显示状态。本地连接串可以来自环境变量 `DATABASE_URL`。Compose 与 Kubernetes 改用 `PGHOST`、`PGPORT`、`PGUSER`、`PGPASSWORD` 和 `PGDATABASE` 独立字段，使包含 URI 保留字符的数据库所有者密码无需编码也能安全连接。两种连接配置都未设置时，状态模式不连接数据库，只列出迁移清单。

## 测试

`__tests__/migrations.test.ts` 静态守护历史基线、任务双轴状态、租约、幂等字段、轮次状态、索引与消息归属列。`__tests__/gen_uuid_v7.test.ts` 检查 UUID 函数的字节写入类型，并用 TypeScript 复刻打包逻辑验证 UUID v7 的格式和时间顺序。`__tests__/first_party_email_auth_migration.test.ts` 检查空用户门禁、四张认证表、MVP 值域、摘要长度、时限、互斥终态、受限审计详情和查询索引。这些测试不需要真实数据库；迁移执行和并发认证语义由集成测试使用临时 PostgreSQL 验证。

## 读写关系

- authoring 负责写入 `users`、`auth_identities`、`auth_otp_challenges`、`auth_sessions` 和 `auth_audit_events`，并读取它们完成挑战、验证、当前用户和登出。
- runtime 只读取 `auth_sessions`、`users` 和认证上下文所需身份字段，不创建或更新认证记录。
- authoring 的任务和能力模块读写 `tasks`、`uploads` 与 `capabilities`。
- runtime 的会话、轮次、消息和产物模块读写 `sessions`、`turns`、`messages` 与 `artifacts`。
- authoring 的大模型审计实现写入 `audit_llm_calls`。
