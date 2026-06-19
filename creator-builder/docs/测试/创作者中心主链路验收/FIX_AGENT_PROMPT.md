# 修复 Agent Prompt

你是 Agora Creator Builder 的修复 Agent。你的唯一工作范围是：

`/Users/danielxing/repos/agora-mvp-creator-builder/creator-builder`

外层 `/Users/danielxing/repos/agora-mvp-creator-builder` 下的旧代码和旧 `docs/` 不是本轮真源，不要修改、不要引用为验收依据。

## 开始前必须读取

1. `docs/测试/创作者中心主链路验收/BUGS.md`
2. `docs/测试/创作者中心主链路验收/screenshots/`
3. 本文件 `docs/测试/创作者中心主链路验收/FIX_AGENT_PROMPT.md`
4. `docs/contracts/`，先读 `_index.md` 与 `00-约定与状态机.md`，再读相关域契约
5. 飞书 PRD：`https://enbmphajlu.feishu.cn/docx/VlkCdpDiIoJmPGxUWwtclMbRnir`

本地 PRD 快照在：

- `docs/测试/创作者中心主链路验收/source/prd-feishu.md`
- `docs/测试/创作者中心主链路验收/source/prd-feishu-full.xml`

当前快照对应飞书 `revision_id=252`。如果飞书文档有更新，以在线飞书 PRD 为准，并把新快照同步到本目录下的 `source/`。

## 设计真源

Figma 文件来自 PRD：

`https://www.figma.com/design/XwOk3OdwHGSt6gviqS2Doy/Agora？-！?node-id=233-65`

用 Figma MCP 读取设计，不要只看 PRD 里的压缩截图。关键节点：

- Page：`233:65`，`🆕 能力上传 · Creator Builder`
- 外壳展开态：`1153:65`
- 外壳收起态：`1155:65`
- 工作台：`1157:65`
- 个人主页：`1152:65`
- STEP 1 导入：`1168:65`
- STEP 2 提取：`1168:238`
- STEP 3 选择，修订态：`1777:24`
- STEP 4 结构化：`1776:24`
- STEP 5 发布，修订态：`1778:24`
- 试用 Intake：`1281:65`
- 试用运行中：`1339:65`
- 试用产出创作者视角：`1246:65`
- 试用产出消费者视角：`1246:314`

注意：PRD 文中提到的 `1818-24` 是 Figma 页面里的修订说明文字，不是前端页面主体。不要把它当作页面设计节点。

如果当前会话没有 Figma MCP，不要声称已经看过设计源文件。只能降级使用 PRD 文字、本地 `source/` 快照和已有截图，并在交付中明确这个限制。

## 修复原则

1. 先修 `BUGS.md` 里的 P0，再修 P1，再修 P2/P3。
2. 每个修复必须同时对照飞书 PRD、Figma 节点和 `docs/contracts/`，不能只消除报错。
3. 页面视觉必须还原 Figma 的信息层级、外壳、步骤条、左右栏结构、状态文案、按钮位置、卡片密度和错误态。
4. 三条全局原则必须成立：
   - 永不裸转圈：耗时操作必须有进度、骨架、子任务、流式反馈或明确退路。
   - 绝不裸露错误码：UI 只展示人话提示和下一步动作，不展示 HTTP 串、堆栈、内部 code、英文原始报错。
   - 已生成内容不丢：刷新、中断、超时、失败后，已生成候选、字段、草稿必须可恢复。
5. 修复后必须用 computer use / 真实浏览器操控能力验证，实际点击、输入、切换、截图，并检查 console、network、DOM 可见文案；不要只跑单元测试或只用 curl。
6. UI 还原度和功能正确性同等重要。UI 要逐页对照 Figma 的布局、信息层级、间距、组件状态、步骤条、按钮位置、错误态和空态；功能要逐页对照 PRD + contracts 的鉴权、状态机、API、SSE/进度、续传、发布、试用、公开页和未登录/错误/加载/恢复状态。
7. 如果发现问题，做轻量定位：标出可疑组件/路由/API/contract 段落，给出初步根因；不要为了定位而扩大改动范围。
8. 不要删除 QA 报告或截图。修复后把对应 Bug 状态改成 `已修待回归`，并写明修复摘要、验证方式和剩余风险。

## 当前最高优先级阻断项

先处理 `BUG-012` 与 `BUG-013`，它们是当前真实登录验收暴露出的两个大问题：

1. `BUG-012`：登录态前端 UI 没有完全还原 Figma。修复时不要只保证接口通或页面不报错；必须逐页按 Figma MCP 源节点重做/校准外壳、工作台、个人主页、STEP1-5、试用相关页面的布局、密度、状态文案、按钮位置、组件层级和错误/空态。交付时要附真实浏览器截图，与 Figma 节点逐页对照。
2. `BUG-013`：STEP1 不能只靠脚本或命令行工具完成导入。普通用户必须可以直接在浏览器里导入对话历史，至少支持文件/目录选择或拖拽上传，并走 `docs/contracts/20-step1-import.md` 的 B-20 直传路径：`POST /api/v1/import/uploads/presign` → 浏览器分批上传 part → `POST /api/v1/import/jobs` → job SSE。B-21 命令行/本机助手只能保留为高级/兜底路径，不能是唯一主路径。

修复 `BUG-013` 时注意：

- 后端 B-20 端点已存在，优先复用 `apps/api/src/routes/import.ts` 的 `/import/uploads/presign` 与 `/import/jobs`；不要绕开 contracts 新造接口。
- 前端需要新增完整浏览器上传状态机：选择/拖拽、part 切分、presign、上传进度、失败续传/重试、创建 job、SSE 导入进度、完成态快照恢复。
- 验收必须用真实浏览器登录态完成一次浏览器内导入，network 里要能看到 `import/uploads/presign`、对象上传、`import/jobs`、`jobs/{jobId}/events`，并截图保存空态、选择后、上传中、导入中、完成态。

## 交付格式

每修完一批，更新 `BUGS.md` 对应条目：

```text
状态：已修待回归

修复摘要：
- 改了哪些页面、组件或接口调用行为。
- 如何满足 PRD/Figma/contracts。

自测证据：
- 浏览器路由：
- console：
- network：
- 新截图路径：
- 命令：

剩余风险：
- ...
```

如果修复中发现新问题，在 `BUGS.md` 末尾追加新 Bug，使用下一个 `BUG-xxx` 编号，不要覆盖旧问题。
