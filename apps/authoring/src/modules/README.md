# modules — 业务模块层

这个目录按业务领域分成四个模块。`account/` 管邮箱验证码、首次建号和 PostgreSQL 会话，`agent-package-release/` 管 Agent Transfer、公开发布与接收器交付，`agent-draft/` 管私有 Draft V2、J-012 轻量上下文 Draft 与 exact Package 保存、指定版本读取和卡片投影，`billing/` 管钱包读取、配置化充值订单、支付确认和主动查单。

`agent-draft` 的 `routes.ts` 负责认证与 HTTP 边界，`service.ts` 复用公开编译器、既有对象存储与 PostgreSQL 事务。私有快照不是新的 Agent 定义或公共 Release，也不取得可信 Desktop 来源证明。

各模块用 `routes.ts` 或职责明确的路由文件声明端点，并用 `service.ts` 与 `repo.ts` 收拢业务编排和 SQL。account 模块另有认证密码学纯函数和事务编排服务。

所有模块路由由 `bootstrap/routes.ts` 挂到 `/api/v1`。billing 通过 platform 的乐收赢端口收款，并在 PostgreSQL 事务中更新钱包与资金流水。模块层只向下依赖 `platform/` 的基础设施和 HTTP 工具，公共类型、错误分类与校验契约来自 `@cb/shared`，canonical Package 合同来自 `@cb/creator-agent-protocol`。
