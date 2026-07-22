# Combo Builder 创作者中心

本仓库是 Combo Builder 的 pnpm monorepo。它包含创作者写入服务、试用运行服务、两个 React 前端、共享契约、PostgreSQL 迁移和生产基础设施。

当前认证只使用第一方邮件验证码。authoring 通过 Resend HTTP API 发送六位验证码，并把验证码摘要、邮箱身份和会话摘要写入 PostgreSQL。authoring 与 runtime 只接受同一枚不透明 HttpOnly Cookie：生产使用主机限定的 `__Host-cb_session`，本地 HTTP 开发测试使用 `cb_session`。两个服务都不接受 Bearer 令牌、查询参数令牌或刷新令牌。

接口错误统一使用共享的 `ErrorEnvelope`。服务日志只记录方法、路由模板、状态和追踪编号，不记录邮箱、验证码、Cookie、请求体、查询字符串或原始错误。

## 前置要求

| 工具     | 版本或用途                                                              |
| -------- | ----------------------------------------------------------------------- |
| Node.js  | 仓库要求 Node.js 24 或更高版本。迁移脚本会使用 Node.js 的类型擦除能力。 |
| pnpm     | 仓库只使用 pnpm，并固定包管理器版本为 11.0.9。                          |
| Docker   | Compose 全栈和本地邮件认证端到端验收需要可用的 Docker daemon。          |
| Chromium | 浏览器验收使用 Playwright Chromium。首次运行前需要安装一次。            |

产品需求与技术方案的权威来源是飞书知识库“产研方案集合”。运行时接口契约以 `packages/shared` 源码为准，数据库结构以 `db/migrations` 为准。

## 安装与静态质量门

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm typecheck:test
pnpm lint
pnpm format:check
pnpm build
pnpm test
```

`pnpm test` 会运行共享契约、数据库静态契约、authoring、runtime、两个前端和 Resend 模拟服务的测试。需要真实 PostgreSQL 的条件测试只有在显式提供测试开关与本机数据库地址时才执行。

常用的单包命令如下：

```bash
pnpm -F @cb/shared build
pnpm -F @cb/authoring build
pnpm -F @cb/runtime build
pnpm -F @cb/web dev
pnpm -F @cb/runtime-web dev
```

## 第一方邮件认证

公开认证接口只有以下四个：

- `POST /api/v1/auth/email/challenges` 接收邮箱并发送验证码。接口始终返回不枚举账号的成功结构；限流与依赖失败仍使用统一错误信封。
- `POST /api/v1/auth/email/verifications` 校验最新验证码，按需创建用户，并签发七天固定期限的不透明会话 Cookie。
- `GET /api/v1/me` 返回经过确认的用户身份。
- `POST /api/v1/auth/logout` 在 PostgreSQL 中撤销当前会话，并清除 Cookie。

认证错误继续使用统一的 `ErrorEnvelope`，只包含用户文案、是否可重试、退路动作和 traceId。内部错误分类、供应商正文、数据库错误、状态细节与堆栈都不会进入响应。

验证码有效期是五分钟，同一目标六十秒后才能重新发送。每次成功重新发送都会使旧验证码失效，连续五次错误会使当前验证码失效。所有请求目标与全站预算都以 PostgreSQL 为最终依据；Redis 对新验证码请求只执行客户端窗口，对验证码验证执行客户端与目标附加窗口。

会话 Cookie 的路径固定为 `/`，并使用 `HttpOnly` 与 `SameSite=Lax`。生产环境使用 `__Host-cb_session`、`Secure`、无 Domain；同站子域不能投放同名父域 Cookie。本地 HTTP 开发测试显式退回无前缀 `cb_session` 且不使用 Secure。数据库只保存 Cookie 完整值的 SHA-256 摘要。

authoring 是邮件认证唯一写入者，只有 authoring API 持有 `RESEND_API_KEY`、`RESEND_FROM_EMAIL` 与 `OTP_HMAC_SECRET`。数据库所有者只供迁移使用；authoring API、worker 与 runtime 使用三份独立角色凭据。runtime 对 `users` 与 `auth_sessions` 只有读取权限，worker 没有认证表写权限。

## 本地运行

复制本地示例后填写空值，不要把真实凭据提交到仓库：

```bash
cp .env.local.example .env.local
```

构建 shared 与 authoring 后，可以直接运行 API：

```bash
pnpm -F @cb/shared build
pnpm -F @cb/authoring build
node apps/authoring/dist/processes/api.js
```

`GET /health` 只表示进程存活。`GET /ready` 会检查 PostgreSQL、队列 Redis、热点 Redis 和 MinIO；邮件供应商不属于 readiness。

生产镜像为 authoring、runtime 与 web 三个镜像。authoring 镜像根据 `PROCESS=api|worker` 选择入口。runtime 使用独立镜像与独立端口。web 镜像通过同一个 Nginx 站点托管创作者前端和 `/try/` 下的试用前端，并反向代理两个服务。

## 数据库迁移

`db/migrations` 当前包含从 `0000` 到 `0005` 的六个迁移文件。迁移运行器按文件名顺序执行，每个文件使用独立事务，并通过 `schema_migrations` 记账。`0005` 撤销业务角色的默认权限，并把认证写入只授予 authoring API。

```bash
pnpm -F @cb/db migrate
pnpm -F @cb/db migrate:status
```

`0004_first_party_email_auth.sql` 是破坏式空库切换。它会先锁定 `users` 并检查是否已有用户。非空数据库会以 SQLSTATE `55000` 整体失败；空库才会删除旧身份字段并创建四张第一方认证表。

真实 PostgreSQL 集成脚本只接受本机地址。它会验证完整迁移、重复执行、认证约束，并在随机临时数据库中验证非空门禁与事务回滚：

```bash
DATABASE_URL=postgres://<本机测试用户>:<密码>@127.0.0.1:5432/<测试库> \
  bash scripts/integration/db-migrate.sh
```

## Compose 全栈

生产口径编排位于 `infra/docker-compose.yml`。`.env.compose.example` 只列变量名和本地默认结构；运行前必须把它复制到仓库根 `.env`，并填写 PostgreSQL、对象存储、Resend、公开站点与验证码 HMAC 配置。`compose:config` 固定读取该文件并使用静默校验，不会把展开后的密钥打印到终端。

```bash
cp .env.compose.example .env
pnpm -F @cb/infra compose:config
bash scripts/start.sh
bash scripts/smoke.sh
pnpm -F @cb/infra compose:down
```

生产必须提供有效的 `RESEND_API_KEY`、语法有效且已经验证的 `RESEND_FROM_EMAIL`、精确的 HTTPS `PUBLIC_APP_ORIGIN`、至少三十二字符的 `OTP_HMAC_SECRET`，以及迁移所有者和 API、worker、runtime 三份独立数据库凭据。数据库所有者密码通过独立字段进入迁移进程，可以包含 URI 保留字符；三个业务密码仍必须是 URL 安全值。生产固定访问 `https://api.resend.com`。开发测试邮件替身不会进入生产编排或生产镜像。

## 本地认证端到端验收

首次运行前安装 Chromium。Linux CI 使用带系统依赖的安装命令：

```bash
pnpm exec playwright install chromium
# Linux CI 可以使用：pnpm exec playwright install --with-deps chromium
```

随后运行唯一的完整认证入口：

```bash
pnpm e2e:resend-auth
```

该脚本会构建隔离的 Compose 项目，并使用真实 Chromium 操作自定义两步登录页。API 级验收还会覆盖来源校验、畸形与超大请求、冷却限流、验证码轮换、五次错误失效、登录时会话轮换、Redis 故障、供应商收件人永久拒绝、发件配置错误与暂时故障、包含 URI 保留字符的数据库所有者密码、PostgreSQL 故障、Bearer 与查询参数降级攻击、跨服务共享会话、注销、新进度流拒绝和客户端 pathname 日志哨兵。脚本会扫描完整容器日志，退出时只删除自己创建的容器、卷、网络、镜像和权限受限的临时目录。

真实 Resend 投递不属于自动化验收，本轮没有进行或宣称真实投递。

## 真实 Resend 发布前检查表

用户需要在部署 Secret 中提供有效的 `RESEND_API_KEY`、Resend 已验证的 `RESEND_FROM_EMAIL` 和一个明确授权接收测试邮件的收件箱。API Key、发件地址和收件地址不能写入仓库文件、命令参数或日志。

用户还需要提供发件域已经通过 SPF、DKIM 与 DMARC 检查的控制台证据，并确认 Resend 账户设置了配额或金额硬上限、退信与投诉抑制规则，以及可以立即暂停 API Key 或发信域的紧急停发措施。这些证据缺失时不能把 mock 验收解释为可发布的真实投递。

单封真实 smoke 必须在 production 固定官方 API 基址后人工执行。操作者在浏览器自定义登录页交互式输入授权测试收件箱，从收件箱读取邮件，再在页面交互式输入六位验证码，随后检查 authoring `/me`、runtime 页面和登出。验收过程不使用带邮箱或验证码的命令行参数，不保存 Cookie 或响应正文，不开启请求体日志；完成后只记录不含地址、验证码、Cookie 或供应商标识的通过或失败结论。

## CI

`.github/workflows/ci.yml` 包含四个作业：

- `gate` 执行冻结安装、格式检查、静态检查、构建、单元测试和三套 Compose 配置校验。
- `integration` 使用真实 PostgreSQL 与双 Redis 执行迁移、认证事务和 Redis 分工测试。
- `auth_e2e` 安装 Chromium，并通过本地 Resend 兼容替身执行浏览器与 API 认证验收。
- `image` 只在 `gate`、真实 PostgreSQL 与 Redis 集成、完整认证 E2E 全部成功后，构建 authoring、runtime 和 web 三个生产镜像。测试邮件替身没有发布路径。

## 目录结构

```text
packages/shared/   共享 DTO、Zod 契约、错误信封、健康协议和事件协议。
apps/authoring/    Fastify 写入服务，负责邮件验证码、用户、任务和能力管理。
apps/runtime/      Fastify 试用服务，只读共享认证会话并执行试用链路。
apps/web/          创作者 React 应用和唯一的自定义登录页。
apps/runtime-web/  挂载在 /try/ 下的试用 React 应用。
db/                PostgreSQL 迁移、迁移运行器和数据库契约测试。
infra/             Compose、Kubernetes、Nginx、生产镜像和开发测试邮件替身。
scripts/           启动、迁移、健康检查、部署和集成验收脚本。
tests/e2e/         Playwright 跨服务浏览器验收。
```

每个服务端源码目录的 `README.md` 记录该目录的文件职责和上下游关系。

## 当前环境验证状态

本次隔离工作区已经通过冻结离线安装、源码与测试 TypeScript 诊断、ESLint、Prettier、ShellCheck、全部应用构建和生产产物检查。根测试共通过 539 项；另有十三项认证事务测试在临时 PostgreSQL 上全部通过。

基础、生产和开发测试三套 Compose 配置均可解析。生产服务清单不含测试邮件替身，开发测试清单的认证密钥只进入 authoring API。Kubernetes 清单可以完整渲染，真实 PostgreSQL 迁移、幂等执行、非空门禁和事务回滚也已通过。

完整 Docker 端到端验收已经构建 authoring、runtime、web、迁移和测试邮件镜像，并通过一项真实 Chromium 用例与全部 API 反向用例。当前环境没有完整的真实 Resend 验收变量，因此没有进行真实邮件投递。
