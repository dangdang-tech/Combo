# Agora 创作者中心主链路 QA Bug 清单

固定入口：`/Users/danielxing/repos/agora-mvp-creator-builder/docs/测试/创作者中心主链路验收/BUGS.md`

截图目录：`/Users/danielxing/repos/agora-mvp-creator-builder/docs/测试/创作者中心主链路验收/screenshots/`

修复 Agent Prompt：`/Users/danielxing/repos/agora-mvp-creator-builder/docs/测试/创作者中心主链路验收/FIX_AGENT_PROMPT.md`

测试时间：2026-06-19 01:25-01:30 Asia/Shanghai

测试对象：生产 Docker 栈，Web `http://localhost/`，API `http://localhost:3000` / `http://localhost/api/v1/...`

验收真源：

- PRD：`/Users/danielxing/repos/agora-mvp-creator-builder/docs/开工总纲-创作者中心主链路.md`
- 测试验收基准：`/Users/danielxing/repos/agora-mvp-creator-builder/docs/测试验收-创作者中心主链路.md`
- 接口契约：`/Users/danielxing/repos/agora-mvp-creator-builder/creator-builder/docs/contracts/`
- Figma 参考图：`/Users/danielxing/repos/agora-mvp-creator-builder/docs/figma-ref/`

专业验收要求：

- 功能必须符合 PRD 和测试验收基准，不只看“页面能打开”。
- 页面形式必须尽量还原 Figma，包括布局、层级、间距、状态、步骤条、按钮、卡片和错误态。
- 每个 Bug 必须有真实浏览器复现证据，优先包含截图、console、network。
- 只要发现新的 PRD 不符合或 Figma 还原问题，继续追加到本文件。

测试状态：未拿到真实 Logto 登录态。已完成未登录态、登录入口、公开页假 slug、创作者中心外壳部分交互验证。完整登录后五步主链路待继续追加。

## 协作记录规则

后续验证者继续写本文件。每个问题使用递增编号 `BUG-001`、`BUG-002`。

每条问题必须包含：

- 严重度：P0 阻断 / P1 严重 / P2 一般 / P3 细节
- 所在页面或路由
- 复现步骤
- 预期 vs 实际
- 证据：截图、console 原文、network 失败请求
- 初步根因判断
- 状态：已修待回归（修复见文末「修复记录-2026-06-19」，commit c7b1ae1，Codex 对抗门 r3 PASS） / 已修待回归 / 关闭

## 当前结论

主链路目前没有在 UI 上完整走通。阻断点：headless 浏览器没有真实 Logto 登录态，已打开可见浏览器 handoff 到 Logto 登录页，等待人工登录后继续。

已确认的前端问题数：P0 2 个，P1 3 个，P2 2 个。

> 修复进展（2026-06-19）：BUG-001~007 全部已修，状态置「已修待回归」。修复 commit `c7b1ae1`，经 Codex 对抗门三轮（r1/r2 FAIL → r3 PASS，留痕见 `creator-builder/.reviews/qa-frontend-auth-codex-r{1,2,3}.txt`）。新前端镜像已部署（bundle 由 `index-CtCZ_wNu.js` 换为 `index-D8pltqU2.js`）。**修复 Agent 无浏览器自动化能力，浏览器端到端回归请 QA（Codex computer-use）下一轮执行并补新截图。** 详见文末「修复记录-2026-06-19」。

三条硬规则当前观察：

- 永不裸转圈：不成立。Dashboard 未登录 401 后长期停在骨架/加载态。
- 绝不裸露错误码：部分成立。后端 ErrorEnvelope 是人话，UI 会显示 traceId 作为反馈代码；但很多页面完全不展示错误态和下一步。
- 已生成内容不丢：未能验证。未登录态无法进入真实导入、提取、结构化、发布链路。

## BUG-001：未登录访问首页直接进入创作者中心，展示已登录外壳与 Wayne 账号区

严重度：P0 阻断

状态：已修待回归（修复见文末「修复记录-2026-06-19」，commit c7b1ae1，Codex 对抗门 r3 PASS）

所在页面/路由：`http://localhost/` 自动落到 `http://localhost/creator`

复现步骤：

1. 清空/不提供有效 Logto 会话。
2. 打开 `http://localhost/`。
3. 观察落地页面、侧栏、账号区、Dashboard 请求。

预期：

未登录用户应该被引导到登录入口，或至少在创作者中心外壳外显示明确未登录态和“去登录”动作。不应展示创作者后台导航、头像、姓名、职位。

实际：

页面进入 `/creator`，左侧展示创作者中心菜单，底部展示 `Wayne / CGO`，右上展示头像 `W`。Dashboard API 全部 401，但页面仍像已登录后台。

截图：

![BUG-001 首页未登录仍展示后台外壳](/Users/danielxing/repos/agora-mvp-creator-builder/docs/测试/创作者中心主链路验收/screenshots/initial-home.png)

![BUG-001 Dashboard 未登录态](/Users/danielxing/repos/agora-mvp-creator-builder/docs/测试/创作者中心主链路验收/screenshots/dashboard-unauth.png)

Console 原文：

```text
[2026-06-18T17:27:45.010Z] [error] Failed to load resource: the server responded with a status of 401 (Unauthorized)
[2026-06-18T17:27:45.016Z] [error] Failed to load resource: the server responded with a status of 401 (Unauthorized)
[2026-06-18T17:27:45.016Z] [error] Failed to load resource: the server responded with a status of 401 (Unauthorized)
[2026-06-18T17:27:45.016Z] [error] Failed to load resource: the server responded with a status of 401 (Unauthorized)
[2026-06-18T17:27:45.018Z] [error] Failed to load resource: the server responded with a status of 401 (Unauthorized)
```

Network 失败请求：

```text
GET http://localhost/api/v1/dashboard/summary?range=30d -> 401
GET http://localhost/api/v1/dashboard/metrics?range=30d -> 401
GET http://localhost/api/v1/dashboard/token-trend?range=30d&metric=tokens -> 401
GET http://localhost/api/v1/dashboard/capabilities?range=30d -> 401
GET http://localhost/api/v1/dashboard/drafts -> 401
```

响应体示例：

```json
{"error":{"userMessage":"登录态失效了，请重新登录。","retriable":false,"action":"escalate","traceId":"bb9fc6f5-bf6e-4a2c-b9ac-c4c9dcb2c621"}}
```

初步根因判断：

前端路由/auth guard 问题。受保护的 `/creator` 壳层在 `/api/v1/me` 或业务 API 401 时没有重定向登录，也没有切到未登录壳，且默认渲染了 Wayne 账号占位。

## BUG-002：Dashboard 多个 401 后停在骨架态，没有人话错误和下一步动作

严重度：P0 阻断

状态：已修待回归（修复见文末「修复记录-2026-06-19」，commit c7b1ae1，Codex 对抗门 r3 PASS）

所在页面/路由：`http://localhost/creator`

复现步骤：

1. 未登录打开 `http://localhost/creator`。
2. 等待 Dashboard 请求完成。
3. 观察摘要、核心指标、趋势图、能力列表、草稿条区域。

预期：

数据拉取失败时应显示可读错误说明和下一步动作，例如“登录态失效，请重新登录”加“去登录”按钮。不能长期保留骨架条或加载态。

实际：

页面仅显示灰色骨架、趋势图大块占位和能力列表占位。没有错误说明、没有去登录、没有重试。

截图：

![BUG-002 Dashboard 401 后骨架态](/Users/danielxing/repos/agora-mvp-creator-builder/docs/测试/创作者中心主链路验收/screenshots/after-domain-cookie-import-home.png)

Console 原文：

```text
[2026-06-18T17:27:29.964Z] [error] Failed to load resource: the server responded with a status of 401 (Unauthorized)
[2026-06-18T17:27:29.967Z] [error] Failed to load resource: the server responded with a status of 401 (Unauthorized)
[2026-06-18T17:27:29.967Z] [error] Failed to load resource: the server responded with a status of 401 (Unauthorized)
[2026-06-18T17:27:29.968Z] [error] Failed to load resource: the server responded with a status of 401 (Unauthorized)
[2026-06-18T17:27:29.970Z] [error] Failed to load resource: the server responded with a status of 401 (Unauthorized)
```

Network 失败请求：

```text
GET http://localhost/api/v1/dashboard/summary?range=30d -> 401
GET http://localhost/api/v1/dashboard/metrics?range=30d -> 401
GET http://localhost/api/v1/dashboard/token-trend?range=30d&metric=tokens -> 401
GET http://localhost/api/v1/dashboard/capabilities?range=30d -> 401
GET http://localhost/api/v1/dashboard/drafts -> 401
```

初步根因判断：

前端 Dashboard 数据层没有把 rejected/401 状态映射到错误 UI，仍保留 loading skeleton。违反“永不裸转圈”和“错误要给下一步动作”。

## BUG-003：未登录可进入我的能力、数据分析、收益等经营后台页面

严重度：P1 严重

状态：已修待回归（修复见文末「修复记录-2026-06-19」，commit c7b1ae1，Codex 对抗门 r3 PASS）

所在页面/路由：

- `http://localhost/capabilities`
- `http://localhost/analytics`
- `http://localhost/earnings`

复现步骤：

1. 未登录访问以上路由。
2. 观察页面外壳、标题、经营文案和 API 请求。

预期：

未登录用户不能看到创作者经营后台页面。应被登录保护拦截，或展示未登录态并提供登录动作。

实际：

三个页面均返回 200 并渲染创作者中心外壳、Wayne 账号区和经营页面标题。API 401 后页面没有统一错误态。

截图：

![BUG-003 我的能力未登录可见](/Users/danielxing/repos/agora-mvp-creator-builder/docs/测试/创作者中心主链路验收/screenshots/capabilities-unauth-annotated.png)

![BUG-003 数据分析未登录可见](/Users/danielxing/repos/agora-mvp-creator-builder/docs/测试/创作者中心主链路验收/screenshots/analytics-unauth-annotated.png)

![BUG-003 收益未登录可见](/Users/danielxing/repos/agora-mvp-creator-builder/docs/测试/创作者中心主链路验收/screenshots/earnings-unauth-annotated.png)

Console 原文：

```text
[2026-06-18T17:28:16.165Z] [error] Failed to load resource: the server responded with a status of 401 (Unauthorized)
[2026-06-18T17:28:34.030Z] [error] Failed to load resource: the server responded with a status of 401 (Unauthorized)
[2026-06-18T17:28:34.031Z] [error] Failed to load resource: the server responded with a status of 401 (Unauthorized)
[2026-06-18T17:28:34.384Z] [error] Failed to load resource: the server responded with a status of 401 (Unauthorized)
```

Network 失败请求：

```text
GET http://localhost/api/v1/dashboard/capabilities?status=all&range=30d&limit=20 -> 401
GET http://localhost/api/v1/dashboard/metrics?range=30d -> 401
GET http://localhost/api/v1/dashboard/token-trend?range=30d&metric=tokens -> 401
GET http://localhost/api/v1/dashboard/capabilities?status=published&range=30d&limit=20 -> 401
```

初步根因判断：

前端受保护路由没有统一鉴权门禁。API 层拒绝了请求，但页面层仍暴露经营后台结构和占位文案。

## BUG-004：上传能力页未登录时自动创建草稿，401 后没有去登录动作

严重度：P1 严重

状态：已修待回归（修复见文末「修复记录-2026-06-19」，commit c7b1ae1，Codex 对抗门 r3 PASS）

所在页面/路由：`http://localhost/create` 自动到 `http://localhost/create/import`

复现步骤：

1. 未登录打开 `http://localhost/create`。
2. 等待页面加载完成。
3. 观察步骤条、错误文案、底部按钮和 network。

预期：

未登录用户不应触发写接口。页面应先要求登录，给“去登录”动作。若 401，错误态必须包含下一步。

实际：

页面进入 STEP① 导入，并自动请求 `POST /api/v1/drafts`。接口 401 后页面显示“登录态失效了，请重新登录。反馈代码...”，但没有“去登录”按钮，底部“下一步：提取能力项”禁用。

截图：

![BUG-004 上传页未登录自动建草稿](/Users/danielxing/repos/agora-mvp-creator-builder/docs/测试/创作者中心主链路验收/screenshots/create-unauth-annotated.png)

Console 原文：

```text
[2026-06-18T17:28:21.399Z] [error] Failed to load resource: the server responded with a status of 401 (Unauthorized)
```

Network 失败请求：

```text
POST http://localhost/api/v1/drafts -> 401
```

响应体：

```json
{"error":{"userMessage":"登录态失效了，请重新登录。","retriable":false,"action":"escalate","traceId":"bb443e86-64fb-4a0e-8def-744280cd5081"}}
```

初步根因判断：

前端创建向导初始化逻辑先发起写请求，再处理鉴权失败。应该在进入受保护写流程前完成登录态校验，或对 `action:"escalate"` 渲染登录 CTA。

## BUG-005：不存在的公开能力 slug 返回 200，并按 slug 伪造公开能力页

严重度：P1 严重

状态：已修待回归（修复见文末「修复记录-2026-06-19」，commit c7b1ae1，Codex 对抗门 r3 PASS）

所在页面/路由：`http://localhost/a/nonexistent-e2e-test-slug`

复现步骤：

1. 打开不存在的公开能力地址 `http://localhost/a/nonexistent-e2e-test-slug`。
2. 观察状态、页面文案和 network。

预期：

不存在的能力 slug 应返回 404 或清晰的人话空态，不能展示伪造的能力详情。公开能力页不应带创作者后台侧栏和账号区。

实际：

页面返回 200，没有任何 API 请求。页面显示“源自一次真实会话”“nonexistent-e2e-test-slug”“这是该能力的公开只读页”等内容，看起来像一张真实公开能力页。

截图：

![BUG-005 假 slug 公开能力页返回 200](/Users/danielxing/repos/agora-mvp-creator-builder/docs/测试/创作者中心主链路验收/screenshots/public-ability-fake-slug.png)

Console 原文：

```text
(no console errors)
```

Network：

```text
GET http://localhost/a/nonexistent-e2e-test-slug -> 200
GET http://localhost/assets/index-CtCZ_wNu.js -> 200
GET http://localhost/assets/index-CUp4JK3M.css -> 200
```

初步根因判断：

前端公开能力页疑似使用纯前端占位数据按 path slug 渲染，没有调用真实公开能力/市集详情接口，也没有 404 处理。

## BUG-006：不存在的公开创作者 slug 返回 200，并泄漏实现占位文案

严重度：P2 一般

状态：已修待回归（修复见文末「修复记录-2026-06-19」，commit c7b1ae1，Codex 对抗门 r3 PASS）

所在页面/路由：`http://localhost/c/nonexistent-creator-e2e`

复现步骤：

1. 打开不存在的公开创作者地址 `http://localhost/c/nonexistent-creator-e2e`。
2. 观察页面状态和文案。

预期：

不存在的创作者主页应返回 404 或清晰的人话空态。不能暴露实现阶段、内部契约前缀等技术占位。

实际：

页面返回 200，显示“未找到页面 页面骨架，Phase 4 实现。链接可能失效或页面尚未上线。后端契约前缀：/api/v1”。

截图：

![BUG-006 公开创作者假 slug 泄漏占位文案](/Users/danielxing/repos/agora-mvp-creator-builder/docs/测试/创作者中心主链路验收/screenshots/public-creator-fake-slug.png)

Console 原文：

```text
(no console errors)
```

Network：

```text
GET http://localhost/c/nonexistent-creator-e2e -> 200
GET http://localhost/assets/index-CtCZ_wNu.js -> 200
GET http://localhost/assets/index-CUp4JK3M.css -> 200
```

初步根因判断：

前端路由 fallback/占位页面未生产化。需要替换为正式 404/未上线人话页，隐藏内部实现信息。

## BUG-007：个人主页未登录错误态没有去登录动作

严重度：P2 一般

状态：已修待回归（修复见文末「修复记录-2026-06-19」，commit c7b1ae1，Codex 对抗门 r3 PASS）

所在页面/路由：`http://localhost/profile`

复现步骤：

1. 未登录打开 `http://localhost/profile`。
2. 等待 `/api/v1/creators/me/profile` 返回 401。
3. 观察页面错误态。

预期：

页面应展示“请先登录”并提供“去登录”按钮，或自动进入登录流程。

实际：

页面显示“登录后才能查看‘我的个人主页’，请先登录。反馈代码...”，但没有可点击的登录动作。

截图：

![BUG-007 个人主页未登录无登录 CTA](/Users/danielxing/repos/agora-mvp-creator-builder/docs/测试/创作者中心主链路验收/screenshots/profile-unauth-annotated.png)

Console 原文：

```text
[2026-06-18T17:28:42.674Z] [error] Failed to load resource: the server responded with a status of 401 (Unauthorized)
```

Network 失败请求：

```text
GET http://localhost/api/v1/creators/me/profile -> 401
```

响应体：

```json
{"error":{"userMessage":"登录后才能查看“我的个人主页”，请先登录。","retriable":false,"action":"escalate","traceId":"faa46665-19b3-4328-bcb5-f3357730838d"}}
```

初步根因判断：

前端错误组件对 `action:"escalate"` 只渲染文字和 traceId，没有渲染下一步动作。

## 附：登录入口证据

路由：`http://localhost/api/v1/auth/login`

实际跳转：`https://andkzt.logto.app/sign-in?app_id=vbu4vp7h0nczrddmzcpq1`

截图：

![Logto 登录入口](/Users/danielxing/repos/agora-mvp-creator-builder/docs/测试/创作者中心主链路验收/screenshots/login-entry.png)

Console 原文：

```text
(no console errors)
```

Network：

```text
GET http://localhost/api/v1/auth/login -> 302
GET https://andkzt.logto.app/oidc/auth?... -> 303
GET https://andkzt.logto.app/sign-in?app_id=vbu4vp7h0nczrddmzcpq1 -> 200
```

备注：Logto 页显示英文 “You're in development mode”。是否属于配置问题需产品/运维确认。

## 下一步验证待办

拿到真实登录态后继续追加：

1. 登录成功态、用户信息、登出后未登录态。
2. Dashboard 真实数据、时间范围切换、入口跳转。
3. 个人主页六分区、编辑、我的能力/数据分析/收益子页。
4. STEP① 导入：上传文件/连接本机、解析进度、去敏。
5. STEP② 提取：AI 候选逐个浮现、置信度、单项重试。
6. STEP③ 选择：勾选候选、存草稿。
7. STEP④ 结构化：软字段流式生成、软字段可改、硬字段锁定。
8. STEP⑤ 发布：发布门校验、市集卡预览、发布成功、公开页链接。
9. 草稿续传：刷新/关闭再回来，已生成内容是否保留。

## 修复记录-2026-06-19

修复 commit：`c7b1ae1`（分支 `feat/creator-builder-mainflow`）。对抗门：Codex r1 FAIL → r2 FAIL → r3 PASS（`creator-builder/.reviews/qa-frontend-auth-codex-r{1,2,3}.txt`）。

根因汇聚：前端此前**完全没有鉴权概念**——所有路由共用一个创作者后台 Shell、账号区硬编码 `Wayne/CGO`、错误态对 401 不给「去登录」、公开页用前端占位数据按 slug 伪造。一处鉴权门禁即修住 5 个 bug。

### 通用自测证据（适用全部 7 条）

- 代码层：`pnpm -F @cb/web typecheck` / `build` / `lint` / `prettier --check` 全过；单测 **559/559**（新增 `apps/web/src/shell/auth.test.tsx` 17 例，含「裸 MeView 200→error」回归守卫——正是 r2 漏掉、r3 补上的那条）。
- 对抗审查：Codex r3 PASS，逐条确认 7 个 bug 与三铁律。
- 后端可观测（curl，部署后实测）：`GET /api/v1/me` 未登录 → **401**；`GET /api/v1/auth/login?returnTo=%2Fcreate%2Fimport` → **302** 跳 Logto（returnTo 已接住）；`GET /` → 200，新 bundle `index-D8pltqU2.js` 已上线。
- 构件层验证（对线上 bundle `index-D8pltqU2.js` grep，browser-free 证据）：泄漏串「Phase 4 实现 / 后端契约前缀 / 页面骨架」**0 命中**（BUG-006 已根除，dead `Placeholder` 被 tree-shake）；诚实串「去登录」「即将上线」「请先登录」「正在确认登录状态」「暂时无法确认登录状态」「页面不存在」**均在**。残留 1 处「Wayne」经核为 `account.tsx` 的 `DEFAULT_ACCOUNT` 防御默认值——已被 `ProtectedLayout` 用真实 `MeView` 覆盖、且未登录被守卫挡在外壳前，**永不渲染**（profile 的 `fixtures.ts` 标注「仅测试用」，仅 `.test.tsx` 引用，已 tree-shake，不进线上）；残留「源自一次真实会话」为 STEP⑤ 发布市集卡可信标记（Figma `step5-publish-v2.png` 合法文案），非已删除的伪造公开页。
- ⚠️ **浏览器路由 / console / network / 新截图：修复 Agent 无浏览器自动化工具，未亲跑。请 QA（Codex computer-use）下一轮做真实浏览器回归并补 `screenshots/`。** 下列各条「待回归点」即回归清单。

### 逐条修复摘要

- **BUG-001 P0**（未登录落 /creator 展示 Wayne 外壳）：`App.tsx` 路由拆为「受保护组」(`RequireAuth`→`ProtectedLayout`=真实账号+`Shell`) 与「公开组」(`PublicLayout` 裸壳)。未登录访问受保护路由 → 裸登录闸门（人话 + 「去登录」），不再挂后台外壳。账号区改由 `GET /api/v1/me` 的 `MeView` 派生（`accountFromMe`），杀掉 `Wayne/CGO` 活体默认值。新增 `shell/auth.tsx`(`useMe`/`AuthProvider`/`RequireAuth`/`fetchMe`/`loginUrl`)。待回归点：清空 cookie 开 `/` → 应见裸登录闸门，无 Wayne、无侧栏。
- **BUG-002 P0**（Dashboard 401 裸转圈 ~7s）：`main.tsx` 给 `QueryClient` 加 retry 策略——`ApiError` 且非 retriable（401/escalate）**不重试**，立刻进错误态。配合守卫，未登录根本不进 Dashboard。待回归点：mid-session 过期时 Dashboard 应秒进错误态 + 「去登录」，不再长骨架。
- **BUG-003 P1**（未登录可进 /capabilities /analytics /earnings）：同一 `RequireAuth` 守卫覆盖。待回归点：三路由未登录 → 裸登录闸门。
- **BUG-004 P1**（未登录 /create 自动 POST /drafts）：`/create/*` 在守卫内，未登录**根本不挂载**向导 → 不触发任何写。待回归点：未登录开 `/create` → 无 `POST /api/v1/drafts`，见登录闸门。
- **BUG-005 P1**（/a/:slug 伪造能力卡 + 套外壳）：`PublicCapabilityPage` 不再按 slug 伪造卡片，改诚实「公开能力页即将上线」态；移入 `PublicLayout` 裸壳（无侧栏/账号）。注：真实公开详情后端端点（`GET /api/v1/apps/{slug}`）本期契约冻结、范围外，故为诚实占位而非真数据——本期有意为之。待回归点：任意 slug 不再出现「源自一次真实会话」伪卡，无后台侧栏。
- **BUG-006 P2**（/c/:slug 泄漏「Phase 4 实现/契约前缀」）：新增 `/c/:slug`→`PublicCreatorPage` 诚实「即将上线」态；`NotFoundPage` 由 dev `Placeholder` 改为真实人话 404（无内部泄漏）；均走 `PublicLayout`。`Placeholder` 仅余死代码（无路由命中）。待回归点：`/c/任意` 与不存在路由 → 人话 404，无「Phase 4」「/api/v1」。
- **BUG-007 P2**（/profile 未登录无「去登录」动作）：`/profile`（me）在守卫内，未登录直接走登录闸门；mid-session 401 时 `ErrorState` 新增 `escalateLabel="去登录"` + `onEscalate` 跳登录。待回归点：登录态过期后 /profile 错误态有可点「去登录」。

### 剩余风险

1. **未做浏览器端到端回归**（无工具），上述「待回归点」需 QA 下一轮逐条验证；若有不符请按递增编号追加 BUG-008…。
2. **公开链路是诚实占位非真数据**：`/a/:slug`、`/c/:slug` 因后端公开详情端点契约冻结（`docs/contracts/_index.md §2.9 本期范围外`）而显示「即将上线」。这意味着发布(STEP⑤)产出的「公开页链接」当前指向占位页——是否本期补这两个后端端点，需产品决策（已上报）。
3. **次要 nit（非阻塞，Codex r3 记录）**：`fetchMe()` 在「响应已到、读 body 时被 abort」的极窄边界会按解析失败收敛为 error；常规 fetch abort 已正确透传。
4. **`/creators/:creatorId/profile`** 现按 `optionalAuth` 公开语义移入裸壳公开组（r1 修正项）；若产品其实希望它私有，需另行确认。

---

## 修复 Agent 代码层预审新增（2026-06-19，待 QA 浏览器复核）

> 说明：QA 仅测了未登录/公开面，已登录的五步主链路尚未浏览器验收。修复 Agent 趁空档对 `apps/web` 五步向导做了一轮**只读代码预审**（对照 PRD/契约/Figma + 三铁律），发现下列具体缺陷并已修复。**发现与验证均为代码层（非浏览器）**，已修 commit 见各条，过 Codex 对抗门（`creator-builder/.reviews/qa-flow-fixes-codex-r{1,2}.txt`，r2 PASS）。请 QA 拿到登录态后按各条「待回归点」做真实浏览器复核。预审同时确认大量路径**干净**（SSE 看门狗/重连/Last-Event-ID 续传、state_snapshot 重建、错误信封清洗、行级重试不丢、dashboard/profile 分区错误态），详见 Codex 报告。

### BUG-008：STEP④ 结构化——软字段卡住后选「继续用已生成」永久冻在骨架、无法手填

严重度：P1 严重　状态：已修待回归（commit 见下，Codex r2 PASS）　发现方式：代码层预审（非浏览器）

所在页面/路由：`/create/structure`（STEP④ 结构化）

预期（契约 `40-step3-4-structure.md` §3.3 + 验收 选择结构化-16）：软字段触发 `field_stuck` 后，用户选「继续用已生成」应**已生成字段全带走、卡住字段留空可手填**；断线重连（`state_snapshot`）应能重建 continue/regen/wait 三退路（§3.5）。Figma `step4-state3-toolong.png`。

实际（修复前）：① `useSSE` 的 `field_stuck` 只置顶层 `stuck`，不写该字段 `structureState.fields[].status='stuck'` → `buildSoftFields` 仍按 `generating` 渲染骨架；`SoftFieldCard` 的 stuck 分支无内联编辑器。选 continue 后 `released=true` 关 SSE，该字段永久冻在骨架（违反「永不裸转圈」+「已生成内容不丢」+契约可手填）。② `state_snapshot` 无条件清 `stuck`，重连后丢三退路（违反 §3.5）。③ `SlowHint` 的 continue 文案误写「继续生成」，与实际语义相反。

修复点：`useSSE.ts`（`field_stuck` 帧补写字段级 `status='stuck'`+保留 partial+`stuckMs`；`state_snapshot` 从快照 `fields` 派生 stuck payload 重建三退路，无则清空）；`SoftFieldCard.tsx`（stuck 分支新增内联编辑器，空、可手填，走与 done/failed 同一 `onSave` 提交路径，数组按行拆 `string[]`，预填已生成 partial）；`SlowHint.tsx`（文案「继续生成」→「继续用已生成」）。新增/扩充测试：`useSSE.test.tsx`（field_stuck 置 stuck + snapshot 重建/清空）、`SoftFieldCard.test.tsx`（stuck 编辑器手填保存）、`SlowHint.test.tsx`/`StreamLoading.test.tsx`（文案）。

待回归点（QA 浏览器）：构造一个会 `field_stuck` 的软字段 → 卡片应出现可填编辑器、其余字段不丢；选「继续用已生成」后该字段为可填空字段而非骨架；结构化中途刷新/断网重连 → 三退路与已生成内容都在。

剩余风险：代码层已过 Codex；真实 AI 触发 stuck 的时序/后端 `state_snapshot` 实际载荷需浏览器确认。Codex nit（非阻塞）：snapshot 派生用 `next.structureState`，当前调用点 stream kind 固定无碍。

### BUG-009：STEP⑤ 批量发布结果行把内部 UUID 当能力名展示

严重度：P2 一般　状态：已修待回归（commit 见下）　发现方式：代码层预审（非浏览器）

所在页面/路由：`/create/publish`「全部发布」结果列表

预期：展示人话能力名（Figma `step5-publish-v2.png` 为具名卡）。实际（修复前）：`BatchResults.tsx` 回退链 `capabilityId ?? versionId ?? candidateId ?? itemId` 全为不透明 ID（`PublishBatchItemView` 无 name 字段）→ 渲染裸 UUID（违反「绝不裸露」精神 + UX 差）。修复点：改 `能力 {i+1}`（对齐左侧切换器口径），真实 id 仅作非可见 key；前端兜底，未动 shared/后端契约。测试：`BatchResults.test.tsx`（全 ID 项不渲染裸 id）。待回归点：批量发布结果行显示「能力 N」非 UUID。剩余风险：若需真实能力名，需后端/契约加 name 字段（本期未做）。

### BUG-010：Dashboard「编辑」跳转参数 `?capabilityId=` 被向导忽略（静默失效）

严重度：P2 一般　状态：已修待回归（commit 见下）　发现方式：代码层预审（非浏览器）

所在页面/路由：`/creator` Dashboard 草稿/能力行「编辑」→ `/create/import`

预期：编辑入口带的能力标识应被向导读取。实际（修复前）：`DashboardPage.tsx` 发 `?capabilityId=`，但向导各处只读 `?capability=`（`WizardLayout.tsx`、`PublishStepPage.tsx`、`StructureStepPage.tsx`）→ 参数被静默丢弃（编辑既有能力接通后会变成静默 no-op）。修复点：发 `?capability=`（对齐消费方）。测试：`DashboardPage.test.tsx`（点编辑后 search 为 `?capability=...`）。待回归点：编辑入口能把能力标识带进向导。剩余风险：编辑既有能力的完整链路本期仍为占位，仅修正参数名。
