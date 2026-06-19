# Agora 创作者中心主链路 QA 报告

固定入口：`/Users/danielxing/repos/agora-mvp-creator-builder/.gstack/qa-reports/creator-center-mainflow/latest.md`

截图目录：`/Users/danielxing/repos/agora-mvp-creator-builder/.gstack/qa-reports/creator-center-mainflow/screenshots/`

测试时间：2026-06-19 01:25-01:30 Asia/Shanghai

测试对象：生产 Docker 栈，Web `http://localhost/`，API `http://localhost:3000` / `http://localhost/api/v1/...`

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
- 状态：待修 / 已修待回归 / 关闭

## 当前结论

主链路目前没有在 UI 上完整走通。阻断点：headless 浏览器没有真实 Logto 登录态，已打开可见浏览器 handoff 到 Logto 登录页，等待人工登录后继续。

已确认的前端问题数：P0 2 个，P1 3 个，P2 2 个。

三条硬规则当前观察：

- 永不裸转圈：不成立。Dashboard 未登录 401 后长期停在骨架/加载态。
- 绝不裸露错误码：部分成立。后端 ErrorEnvelope 是人话，UI 会显示 traceId 作为反馈代码；但很多页面完全不展示错误态和下一步。
- 已生成内容不丢：未能验证。未登录态无法进入真实导入、提取、结构化、发布链路。

## BUG-001：未登录访问首页直接进入创作者中心，展示已登录外壳与 Wayne 账号区

严重度：P0 阻断

状态：待修

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

![BUG-001 首页未登录仍展示后台外壳](/Users/danielxing/repos/agora-mvp-creator-builder/.gstack/qa-reports/creator-center-mainflow/screenshots/initial-home.png)

![BUG-001 Dashboard 未登录态](/Users/danielxing/repos/agora-mvp-creator-builder/.gstack/qa-reports/creator-center-mainflow/screenshots/dashboard-unauth.png)

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

状态：待修

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

![BUG-002 Dashboard 401 后骨架态](/Users/danielxing/repos/agora-mvp-creator-builder/.gstack/qa-reports/creator-center-mainflow/screenshots/after-domain-cookie-import-home.png)

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

状态：待修

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

![BUG-003 我的能力未登录可见](/Users/danielxing/repos/agora-mvp-creator-builder/.gstack/qa-reports/creator-center-mainflow/screenshots/capabilities-unauth-annotated.png)

![BUG-003 数据分析未登录可见](/Users/danielxing/repos/agora-mvp-creator-builder/.gstack/qa-reports/creator-center-mainflow/screenshots/analytics-unauth-annotated.png)

![BUG-003 收益未登录可见](/Users/danielxing/repos/agora-mvp-creator-builder/.gstack/qa-reports/creator-center-mainflow/screenshots/earnings-unauth-annotated.png)

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

状态：待修

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

![BUG-004 上传页未登录自动建草稿](/Users/danielxing/repos/agora-mvp-creator-builder/.gstack/qa-reports/creator-center-mainflow/screenshots/create-unauth-annotated.png)

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

状态：待修

所在页面/路由：`http://localhost/a/nonexistent-e2e-test-slug`

复现步骤：

1. 打开不存在的公开能力地址 `http://localhost/a/nonexistent-e2e-test-slug`。
2. 观察状态、页面文案和 network。

预期：

不存在的能力 slug 应返回 404 或清晰的人话空态，不能展示伪造的能力详情。公开能力页不应带创作者后台侧栏和账号区。

实际：

页面返回 200，没有任何 API 请求。页面显示“源自一次真实会话”“nonexistent-e2e-test-slug”“这是该能力的公开只读页”等内容，看起来像一张真实公开能力页。

截图：

![BUG-005 假 slug 公开能力页返回 200](/Users/danielxing/repos/agora-mvp-creator-builder/.gstack/qa-reports/creator-center-mainflow/screenshots/public-ability-fake-slug.png)

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

状态：待修

所在页面/路由：`http://localhost/c/nonexistent-creator-e2e`

复现步骤：

1. 打开不存在的公开创作者地址 `http://localhost/c/nonexistent-creator-e2e`。
2. 观察页面状态和文案。

预期：

不存在的创作者主页应返回 404 或清晰的人话空态。不能暴露实现阶段、内部契约前缀等技术占位。

实际：

页面返回 200，显示“未找到页面 页面骨架，Phase 4 实现。链接可能失效或页面尚未上线。后端契约前缀：/api/v1”。

截图：

![BUG-006 公开创作者假 slug 泄漏占位文案](/Users/danielxing/repos/agora-mvp-creator-builder/.gstack/qa-reports/creator-center-mainflow/screenshots/public-creator-fake-slug.png)

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

状态：待修

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

![BUG-007 个人主页未登录无登录 CTA](/Users/danielxing/repos/agora-mvp-creator-builder/.gstack/qa-reports/creator-center-mainflow/screenshots/profile-unauth-annotated.png)

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

![Logto 登录入口](/Users/danielxing/repos/agora-mvp-creator-builder/.gstack/qa-reports/creator-center-mainflow/screenshots/login-entry.png)

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
