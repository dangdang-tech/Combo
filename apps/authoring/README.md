# apps/authoring（创作端服务）

本包是 Combo 当前唯一的主栈 API 服务。单一进程提供第一方邮箱验证码认证、账户、余额充值、私有 Agent Draft、Agent Transfer、公开发布和接收器下载接口。

`src/modules/agent-draft/` 提供 J-012 私有 Draft V2、轻量上下文 Draft 与已编译 Package 的严格保存、指定版本读取和只读卡片投影。它复用 `@cb/creator-worker` 的公开编译器，固定声明来源未验证，不创建公共 Release，也不表示 Plugin OAuth 或 Desktop 提取已经接入。

## 目录与文件

- `src/` 保存 API、业务模块、基础设施适配器和测试，并由目录内的 README 继续说明各层职责。
- `package.json` 声明运行依赖、开发依赖以及构建、类型检查、测试和 API 启动命令。
- `tsconfig.json` 定义生产源码的 TypeScript 项目构建配置。
- `tsconfig.vitest.json` 为测试源码提供独立的 TypeScript 诊断配置。
- `vitest.config.ts` 定义 authoring 单元测试与 PostgreSQL 集成测试的发现规则。

`dist/` 和 `tsconfig.tsbuildinfo` 是构建生成物，`node_modules/` 是工作区依赖目录，三者都不是源码事实源。

## 上下游关系

authoring 依赖 `@cb/shared` 的接口契约和 Creator Agent 的 Package 合同，使用 PostgreSQL 保存认证、Draft、发布、充值订单与资金事实，使用 `redis-hot` 承载认证软限流，并通过 `combo-artifacts` 桶保存不可变 Agent Package 字节。浏览器只通过同源 Nginx 访问 API；Resend 与乐收赢只由这个 API 进程访问。
