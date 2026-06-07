# Agora MVP 开工方案

> 5 路深读整个项目(设计稿/工程 specs/已落地代码/AVM 地基)+ 合成。供团队讨论从哪开始。

## 一、项目全貌

Agora 实际上是三摞东西，成熟度差距巨大。(1) AVM 地基——真代码：`/tmp/avm` 二进制(8.5MB)可跑，`avm matrix <agent> --json` 已把同一 Agent 跨 codex/claude-code/opencode 投影成四态 mapping(MatrixReport 已建)；raw-capture.js/distill.js/studio.js 是真能跑的 Node 链路(捕获会话→蒸馏成带 {answer.X} 插槽的干净 agent→打包/装到空 home 做跨 runtime 一致性校验)，但依赖本地 claude 二进制 + 私有 avm CLI + 私有 MCP，分发到陌生人手里会失真。(2) Ralphloop friend-chat 运行时——真代码且已上线：`apps/share-gateway` 里 RelayStore(JSON snapshot+JSONL journal)、HostRuntimeRegistry、三个真 adapter(claude/codex/opencode 各实现 start/submitTask/streamEvents)、RuntimeEvent 事件流、`submitFriendTaskV1`、assistant-ui 分享入口(/app/share/:token/assistant-ui)。这是"消费者打开链接→在创作者 Host 上真跑 agent→拿流式结果"的活路径。(3) Agora 产品门面——真静态/JS 但全 mock：agora-demo 下 consumer/marketplace/pricing/discovery + ~15 个 mini-app 详情页与 demo 成对存在，UI 规范(4 件套)固化，但"会话"是脚本分支不接 LLM。最大且唯一的核心 gap：把 (1) 和 (2) 缝起来的 mini-app builder/runtime 层——io-contract 6 阶段类型、AgenticAppManifest v0.1、A2UI componentRegistry、MiniappRunEngine、promptCompiler——digest 里标 spec_only 并给了文件路径，但磁盘上一个文件都不存在(share-web-react/src 只有 main.tsx+App.ts，share-gateway 无 miniapp/ 目录，build_agentic_app/services.py 不存在)。所以现状是：两端各有一套真东西能跑，中间那座桥 100% 是纸上规格。MVP 不是从零，是把"AVM 蒸馏出的 agent 定义"喂进"Ralphloop 已能跑的真 agent 链路"，再用一个最薄的产物渲染壳收口——这条线两头资产都是真的，缺的只是中间黏合层。

## 二、MVP 定义(要证明什么、不做什么)

要证明的核心假设(单一)："一段真实 agent 对话/工作痕迹，能被蒸馏成一个干净、可分发的 mini app；陌生消费者点开链接、填几个槽、就能在创作者的 Host 上真跑同一个 agent 并拿到结构化产物。" 即验证 capture→distill→publish→consume 这条端到端真实链路(真 LLM、真跨机分发、真产物)，而非任何一段的 UI 精致度。 明确不做：(a) 不做 marketplace 货架/发现/推荐/语义搜索——一条链路一个 app，直链即可，集市留 mock；(b) 不做支付/订阅/run 计费/分账/反向抽成 ladder——全部留规格，MVP 不碰一分钱；(c) 不做账号/登录/云同步/"装上常驻"——消费者无状态，靠 token 直达；(d) 不做完整 io-contract 6 阶段管线与 Pi Agent/Gen UI/Auto Eval 发布门禁——MVP 用单一 distill prompt 出 manifest，人工过目即发布，不建 candidate 抽取/选择/eval gate；(e) 不做 107 个 A2UI 派生组件——只做 fallback 对(intake_form + artifact_builder)+ 至多一个结构化组件(scorecard 或 diagnostic_matrix)；(f) 不做 owner-approval 队列、high-risk 路由、跨 4 runtime 分发承诺——固定跑在单一创作者 Host 的一个 adapter 上；(g) 不解决跨机能力失真/私有 MCP/secretscan/合规——MVP 用不依赖私有 MCP 的 agent，安全闸列为紧跟其后的 P0 但不进首条切片。

## 三、最薄的端到端真实链路

一条人能演示的真实链路，两头全用已有真资产，只新写中间黏合：
1. 创作者侧(复用 AVM 真链路)：跑 raw-capture.js 把一个真实工作目录压成 raw-avm 包 → 跑 distill.js 调本地 claude 蒸馏出干净 agent 定义(name/role/instructions 含 2-3 个 {answer.X} 插槽/recommended_capabilities)。**已有，能跑。** 唯一新写：一个 ~150 行的 `distill→manifest` 适配器，把 distill 的 JSON 映射成最小 AgenticAppManifest v0.1(agent.role/goal/instructions、interaction.required_context 由 {answer.X} 槽生成、interaction.ui_profile.components 默认 [intake_form, artifact_builder])。
2. 发布(复用 Ralphloop 真存储)：把 manifest 存进一个 mini_app_manifests 记录，并复用现有 createShareLink/RelayStore 生成一个消费 token + 直链。新写：一个 POST /v1/miniapps/import + /publish 桩(落在 productization/httpServer.ts)，存 manifest + 绑定 hostId/adapterId。
3. 消费侧打开(新写最薄壳)：消费者点 token 链接 → 一个极简 landing 渲染 required_context 表单(intake_form，由 {answer.X} 驱动)→ 提交。新写 ~1 个页面，复用 discovery.html 的双栏壳视觉 + share-web-react 入口。
4. 真跑(复用 submitFriendTaskV1)：把 intake 答案填进 manifest.instructions 的 {answer.X} 槽编译成 runtimePrompt，**直接调已存在的 submitFriendTaskV1(token, prompt)**——它已会在创作者 Host 上用真 adapter 跑、流式回 RuntimeEvent。新写：一个 ~80 行 promptCompiler(槽填充)，无需新 host adapter。
5. 产物(新写 artifact_builder 渲染)：task.completed 时取 task.output，先 markdown fallback 直接渲染(artifact_builder)，不强求结构化 JSON。新写：一个 artifactExtractor(markdown fallback 优先)+ ArtifactPanel 最薄版。
净新写约 5 个小文件(distill→manifest 适配器、import/publish 桩、intake landing、promptCompiler 槽填充、artifact markdown 渲染)；其余全是已跑通的 AVM 蒸馏 + Ralphloop 真 agent 链路。这条切片故意跳过：candidate 抽取/选择、Gen UI plan 推导、Auto Eval gate、多组件注册表、计费、账号。

## 四、第一件该做的事

写 `distill→manifest` 适配器：一个 ~150 行纯函数文件，输入 distill.js 已输出的那个 JSON(name/title/role/instructions/recommended_capabilities)，输出一个最小合法 AgenticAppManifest v0.1 对象——重点是把 instructions 里的 {answer.X} 槽解析成 interaction.required_context 字段列表，components 默认填 [intake_form, artifact_builder]。它零依赖、可纯单测(给定 distill JSON → 断言 manifest 形状 + 槽提取正确)，且是 P0 整条切片的咽喉：它一通，后面 promptCompiler 的槽填充和 intake 表单生成就都有了数据契约。先不碰任何 HTTP/存储/UI。验证方式：用 distill.js 对一个真实 bundle 跑出的 JSON 当 fixture，跑通 manifest 生成 + parseManifest 校验不报缺字段。

## 五、分阶段 build

### P0 缝合证明(thinnest slice 全量) · effort L
**目标**:打通 capture→distill→manifest→publish→消费者填槽→真 agent 跑→拿 markdown 产物，一条能现场演示的真链路

**交付**
- distill→AgenticAppManifest v0.1 适配器(~150行，含 {answer.X}→required_context 映射)
- POST /v1/miniapps/import + /:id/publish 桩(落 productization/httpServer.ts)+ manifest 存进 RelayStore 新 journal op
- manifest→token 直链(复用 createShareLink)
- 消费侧最薄 landing：intake_form 表单(复用 discovery.html 双栏壳视觉)
- promptCompiler：intake 答案填 {answer.X}→runtimePrompt，直调已存在 submitFriendTaskV1
- artifactExtractor(markdown fallback)+ ArtifactPanel 最薄版渲染 task.output
- 一个真实 demo agent(不依赖私有 MCP)端到端跑通录屏

**复用**:/tmp/avm-demo/raw-capture.js；/tmp/avm-demo/distill.js；apps/share-gateway submitFriendTaskV1；RelayStore + JSONL journal；三个真 adapter(claude/codex/opencode)；assistant-ui 分享入口；agora-demo/discovery.html 双栏壳

### P1 产物结构化 + A2UI fallback 对正式化 · effort M
**目标**:把产物从裸 markdown 升到受控渲染，建立 A2UI 第一块地板

**交付**
- componentRegistry + resolveComponents(allow-list，未知名降级 intake_form/artifact_builder)
- DegradedComponentBoundary(render throw/fallback 时挂基线+中性 banner)
- ArtifactBuilder 多状态(empty→streaming→finished exportable)
- artifactExtractor 升级：fenced JSON 优先→markdown fallback，按 expectedOutput.type 选 ArtifactRecord 类型
- manifest.interaction.ui_profile.components 真正驱动渲染

**复用**:P0 的 manifest + ArtifactPanel；spec 2026-06-01-a2ui-component-registry-full；io-contract §12 GeneratedUiPlan

### P2 安全闸 + 跨机分发可信(P0 信任原语，不可后置太久) · effort M
**目标**:让蒸馏出的包能安全分发，堵明文凭据 + 解决能力失真

**交付**
- AVM secretscan：looksSecret/SanitizeMCPConfig/ScanCapBlob/verdictFor 纯函数+单测(照 buildspec §⑤照敲)
- export 净化 + inspect PASS/WARN/BLOCK
- secret 引用解析机制(install/run 时把净化引用解析回真凭据)
- distill 产物剔除私有 MCP / 标注'换机不可用'依赖

**复用**:AVM-Agora-实施路线与buildspec §⑤；已有 packageio/capstore/MCPConfigV1.Env；studio.js 已用的 package export/inspect

### P3 第二个结构化组件 + landing 完整态 · effort M
**目标**:覆盖诊断/评分类 form factor，证明 form factor 多样性

**交付**
- Scorecard 或 DiagnosticMatrix 一个(criteria/weights/verdict 或 rows×lenses，streaming→frozen)
- MiniappRunShell 4 layout 中至少 intake_then_thread + artifact_workspace 两种
- RunStatusBar + Stop(经现有 /sessions/:id/cancel 穿透 SIGTERM)
- MiniappLanding(title/summary/starter_prompts/disclaimer)

**复用**:P1 componentRegistry + boundary；已有 /sessions/:id/cancel 路径；app-pitchscore.html / app-persona.html 详情页视觉规范

### P4 创作者发布壳(从 API/fixture 升到可点) · effort L
**目标**:创作者不写命令也能从一段对话产出并发布 mini app

**交付**
- RawInputImport(粘贴/上传对话)→distill→manifest 草稿 review 表单
- SkillDraftEditor(可编辑 role/goal/instructions/槽)
- PublishPanel(选 hostId/adapterId 锁定 → 调 P0 的 import/publish)
- creator.html 3 步 wizard 接上真 distill 后端替换 mock

**复用**:P0 distill→manifest 适配器与 import/publish；creator.html 3 步 wizard mock；io-contract §10-11 SelectedCandidate/ManifestDraft 类型

### P5 真实门禁与多 app(向规格收敛) · effort L
**目标**:把 MVP 验证过的链路上规格护栏，准备多 app

**交付**
- Auto Eval v0：schema + runtime smoke(先 deterministic mock adapter)→publishGate allow/block/manual_review
- candidate 抽取/选择(io-contract §7/§10)接真 agent harness
- marketplace.html 接真实 manifest 目录数据源替换硬编码卡片
- AVM registry v0(publish/search/install role@ver，前置过 secretscan)

**复用**:io-contract 全 6 阶段类型；buildspec §① registry / §② runlog eval；marketplace.html 已跑的筛选 JS

## 六、开工前要拍板的决策

- baseAdapter 绑定时机：MVP 拍 publish-time 锁定(存 hostId+adapterId 于 manifest 记录)，runtime fallback 留'agent temporarily unavailable'中性态——不要 per-run 动态 detectAll，省一整层复杂度
- Artifact 第一版用 markdown fallback 还是强制结构化 JSON：P0 拍 markdown fallback 优先(task.output 直渲)，P1 再上 fenced JSON——否则 distill 出的 agent 不一定吐结构化产物会卡死链路
- manifest 是否带 per-component props schema：拍 derive-from-events-first，组件全从事件流/产物派生，不让创作者定义 row/column shape，等真有复杂组件需求再 bump manifestVersion
- human review 强度：MVP 全员强制人工过目 manifest 草稿即发布，不建 Auto Eval gate(P5 再上)——但 import/publish 接口要按未来有 eval 设计
- 跨 runtime 口径统一：对外停止承诺'一次开发跨 Claude/Cursor/Codex/Cline 分发'，收敛为'跑在单一创作者 Host 上从可用 adapter 选一个'——落地页文案要跟 spec 对齐，否则 demo 当场被戳穿
- registry 持久化：复用 RelayStore 的 JSONL journal 加一个 mini_app_manifests op，不新建数据库
- 用哪个 demo agent 做 P0:必须挑不依赖私有 MCP(benzema-knowledge)的 agent，否则换机失真，演示不可复现

## 七、风险

- distill 依赖本地 claude 二进制 + 私有 /tmp/avm CLI + /tmp/avm-demo-home：P0 演示能跑但不可部署，云端化 distill(选 provider/model/promptVersion)是隐藏工作量且 digest 自承'最空的主线'，别低估
- 蒸馏质量不稳定：单条 distill prompt 反推 agent 定义，{answer.X} 槽抽得对不对、instructions 干不干净没有保证，MVP 效果成败全压在这个 prompt 上——需要早做多 fixture 验证
- 私有 MCP / 跨机能力失真：raw-capture 抓的 MCP 在陌生人机器上不存在(BOOT.md 已自承)，分发即失真；P0 必须绕开，但这是产品级硬约束不是 bug
- 明文凭据泄漏(P2 才做但风险在 P0 就在)：MCP token 随包跨第三方 Host 分发、{answer.X} 直拼用户输入无指令/数据隔离(prompt injection)——若 P0 演示用了真凭据 agent 就有真泄漏，演示务必用无凭据 agent
- inference 计费/退款白嫖陷阱(被列为隐性亏损)：虽 MVP 不碰钱，但一旦接真 LLM 真跑，创作者 Host 的算力就在真实消耗，无限流/熔断会被'付费→触发昂贵生成→退款'抽干——限流要在接真跑那刻就加最小版
- 两套代码两种语言两个 repo(AVM Go / Ralphloop TS)+ distill 是 Node 脚本：缝合层跨进程跨语言，接口契约(distill JSON→manifest→submitFriendTaskV1 prompt)必须先用 fixture 锁死，否则三方各改各的
- share-web-react 几乎是空壳(只有 main.tsx+App.ts)：消费侧 React 渲染壳基本从零搭，digest 把它当'已有'会严重低估前端工作量
- owner-approval/high-risk 路由在 chatbot pivot 后无落点：任何 high-risk app 上线 run 会搁浅无解决面——MVP 靠'只选 low-risk agent'规避，但这是真空白不是已解决

---
## 附:5 路深读盘点(designed/built/spec 状态)

### Agora 消费侧 (For Users) — 逛市集→发现→打开 app→会话→产物→分享→定价 全流程盘点
- [designed_mockup] **消费者入口/价值主张页 (For Users hero + Journey 4步 + Typical Week + VS对比 + Trust + Final CTA)** — 完整的小白用户着陆页，含 chat-embed 演示、四步旅程(看见→装上→用→留)、Lily一周叙事、vs ChatGPT/AppStore/Prompt集市三栏对比；纯静态、所有CTA指向 marketplace/demo。
- [built_real] **Mini-App 集市 (Marketplace) — 货架/筛选/卡片网格** — 可交互集市：受众筛选chip(全部/创业者/创作者/营销/开发/企业/专家)用JS实时隐藏卡片+空货架；6个货架(精选/创作工坊/长对话工作台/Builder/专家桌面/生活决策)约19张app卡片，每张 deep-link 到对应 app-*.html。
- [designed_mockup] **Mini-App 产品详情页模板 (以 Persona 为标尺)** — App store 式详情页：面包屑+by-creator+评分meta+sample share-card hero、8原型gallery、4件套(chat输入/live panel/增量渲染/分享卡)拆解、reviews、creator profile、more-from；静态，'立即试玩'→demo.html。
- [designed_mockup] **Pitch Score 产品详情页** — 诊断类app详情页：hero诊断卡(35/50 PRE-PMF + 5轴bar + 最需修的一件事)、5 tier gallery(STORY→SCALING各带处方)、4件套拆解、reviews;静态，CTA→pitch-score.html。
- [designed_mockup] **墨知 Writer 长对话产品详情页** — 长对话(无题数上限)app详情页：核心卖点 provenance shading(你=黑字/AI=灰斜体/✓后落正文)、5流派track(长篇/短篇/剧本/小传/散文)+第6'先聊聊'fallback、4件套'章节即产物'、reviews;CTA→writer.html。
- [built_real] **Customer Discovery Sprint — 真实可跑 mini-app (会话→产物→保存)** — 完整 chat-as-input 双栏壳：左对话(进度条)、右live sprint拼装(hypothesis/ICP/fear/timeline渐显)→生成sprint工作区(可勾选task、保存到localStorage、recall已存sprint);这是消费侧'打开app→会话→产物→留下'的真实实现样板。
- [built_real] **定价页 — 消费侧三档 + 创作者反向抽成 + 计算器 + FAQ** — Free($0按用量)/Plus($12)/Pro($25)三档卡+功能对比表(常驻app数/run用量/水印/runtime/云同步/私有app/优先算力/seat);For Users↔Creators分段切换、反向累进take rate阶梯(0/5/10/3%)、可拖动MRR计算器(真JS算分账)、8条FAQ、social proof。
- [built_real] **其余货架上的 mini-app (详情页+可跑demo成对存在)** — 约15+个mini-app每个都有'详情页(app-*.html)'+'可跑demo(短名.html+一对app/data JS)';覆盖quiz/诊断/生成式/长对话/陪伴多种form factor,共用 chat-engine.js + mini-app-shell.js。

### Agora 创作侧 + Mini App Builder（创作者把 agent 变成可上架 mini app）
- [designed_mockup] **Publish Wizard 3 步流程（营销表述）** — 落地页版 3 步：01 描述(一句话需求) → 02 配置(自动生成 questions/side_panel/scoring/share_card/price 4 件套) → 03 发布(一键跨 Claude/Cursor/Codex/Cline 4 runtime),与 spec 的真实 6 阶段是简化营销叙事
- [spec_only] **Builder 真实 4 步骨架管线（架构版）** — 红框核心 = Pi Agent(候选→manifest草稿) + Gen UI(manifest→UI plan) + Auto Eval(发布门禁),前接候选导入、后接注册+发布;mermaid 端到端流程已画全
- [spec_only] **MVP 6 阶段输入输出契约总表** — RawInputPackage → ExtractionResult → SelectedCapabilityCandidate → AgenticAppManifestDraft → GeneratedUiPlan → EvaluationReport → PublishedMiniAppRecord,每阶段 TS 类型逐个定义、产物各自持久化
- [spec_only] **RawInputPackage（一键导入对话历史的统一输入）** — 把 chat_transcript/agent_session/document/web_page/task_history/manual_note/code 等异构来源标准化成 sources+chunks+sourceMap;captureMethod 含 upload/paste/connector/local_file/manual;只做格式化分块不做隐私过滤
- [spec_only] **Candidate Extraction（发 prompt 给 agent 抽候选）** — 云端 Agent harness 消费 RawInputPackage,输出 ExtractionResult.candidates(含 repeatedWorkflow/targetUser/jobToBeDone/recommendedForm/confidence/evidenceRefs);用 AnalysisHarness 接口预留未来本地 agent
- [spec_only] **Candidate Selection（用户选一个候选)** — 系统推荐 top1、用户展开看其他,只有 SelectedCapabilityCandidate 进入 Manifest Drafting,避免一次 raw input 全部生成 miniapp
- [spec_only] **Manifest Drafting / Pi Agent（产出 manifest 草稿）** — 把选中候选 + evidence 写成 AgenticAppManifestDraft(role/goal/boundaries/skill_set/interaction/context_contract/llm_boundary/runbook/safety/provenance + evalCaseDrafts),draftStatus=needs_review;不发布、不写 registry、不绕过 human review
- [spec_only] **agentic_app Manifest v0.1 权威契约（跨仓库接缝）** — 完整 TS interface AgenticAppManifest:manifest/agent/capability_basis/skill_set/interaction.ui_profile.components/context_contract/launch_contract/llm_boundary/runbook/safety/provenance;字段直接对齐创作者侧 build_agentic_app() services.py:369
- [spec_only] **Gen UI Planning（manifest→受控 UI plan）** — 只消费 interaction.ui_profile,输出 GeneratedUiPlan(components 来自 manifest 或 fallback + layout 四选一);第一版走组件注册表不生成任意前端代码,未知组件降级 intake_form/checklist/artifact_builder
- [spec_only] **Auto Eval 发布门禁** — EvaluationReport.publishGate(allow/block/manual_review);schema/policy/privacy/runtime smoke 任一失败即 block,UI 可降级转 manual review,UX 失败只能存 draft
- [spec_only] **Publish + Host 绑定** — PublishedMiniAppRecord + MiniAppHostBinding(baseAdapterId 在 publish 时锁定);已决策 miniApp 跑在创作者 Host、朋友不带 key、复用现有 outbound-Host 共享模型与计费隐藏边界
- [designed_mockup] **Builder 工具集（落地页承诺的创作者工具）** — Mini-App SDK(agora.miniapp 声明式JSON)、20+模板(测试/评分/生成/匹配,agora templates list)、AgoraShell API(chat/radar/chips/share-card)、支付分账(Stripe/国内银行/x402/UCP);均为概念展示无实现
- [designed_mockup] **创作者 Dashboard 后台** — 静态 mock:30D revenue/installs/share-card CTR/take-rate band、MRR sparkline、用户漏斗、下次 payout;纯展示数据写死无后端
- [designed_mockup] **反向累进抽成 ladder** — 4 band 抽成:<$1k 0% / $1k-10k 5% / $10k-50k 10% / $50k+ 回落 3%,作为供给侧定价叙事,非 builder 功能
- [spec_only] **跨仓库 HTTP 接口草案（import/eval/publish）** — POST /v1/miniapps/import(带 ownerId/hostId/baseAdapterId/manifest) + POST /:id/evaluations + POST /:id/publish;请求响应 JSON 草拟,落点 share-gateway httpServer.ts

### Agora 运行时 + A2UI 生成式 UI (mini-app 消费态执行模型 + bounded generative UI 渲染 + 对话→产物→handoff 链路)
- [spec_only] **componentRegistry / component_registry** — 受控 allow-list：把 GeneratedUiComponent.name 解析成具体组件并记录 source(manifest/fallback)，未知名降级到 [intake_form, artifact_builder] —— 阻止 Gen UI 输出任意前端代码的唯一闸门。
- [spec_only] **resolveComponents()** — string[]→组件映射，未知名按规则降级；已验证映射 intake_form/checklist/artifact_builder/diagnostic_matrix/scorecard。
- [spec_only] **inferUiPlan** — 从 skill/input/output 推导 GeneratedUiPlan(components+layout+warnings)，UI plan 是内部可替换推导产物而非核心协议。
- [spec_only] **MiniappRunShell / miniapp_run_shell** — 根布局，拥有 4 种 GeneratedUiPlan layout，挂载 RunStatusBar+MiniappThread+A2UI canvas+ArtifactPanel+inline ConfirmationCard，每次 render/poll 绑定 submit-time sessionId/taskId 做并发隔离。
- [spec_only] **DegradedComponentBoundary / degraded_component_boundary** — 每组件一个 React error boundary：render throw 或 source:'fallback' 时挂载 [intake_form, artifact_builder] 基线+中性 banner —— 满足 publish gate 的保证渲染地板。
- [spec_only] **ArtifactPanel / ArtifactBuilder / artifact_builder** — mini-app 最终用户价值渲染器(type-aware empty→streaming buffer→finished exportable artifact)，是 fallback 对的一半，必须能渲染任意 ArtifactRecord 形状。
- [built_real] **MiniappThread** — assistant-ui Thread 复用对话面；friend-chat assistant-ui 入口已存在，标 have。
- [built_real] **ConfirmationCard (inline HITL)** — needs_user_confirm 的 inline friend-approval-card；矩阵记 have(已存在 friend-approval-card)。
- [designed_mockup] **RunStatusBar / run_status_bar** — run-status pill+stop，Stop 经 onCancel→/sessions/:id/cancel 一路穿透到 Host SIGTERM；矩阵记 partial。
- [designed_mockup] **MiniappLanding / miniapp_landing** — pre-run landing(title/summary/starter_prompts/disclaimer)+frozen-artifact 预览 fork vs live re-run CTA；记 partial。
- [designed_mockup] **IntakeFormRenderer / intake_form** — context_launch 的 schema 驱动一次性表单门(validate/submit/handoff)，由 interaction.required_context 驱动；记 partial。
- [spec_only] **miniappRunStore** — 前端 run 状态 store，承接 RuntimeEvent→AG-UI wire 映射后的 thread/artifact 状态。
- [spec_only] **miniappClient** — 前端调 5 个 friend 端点(/miniapp, /miniapp-runs, /:runId, /artifacts, /messages)的 API 客户端。
- [spec_only] **MiniappRunEngine** — 消费者一次 run 的执行核心：按 token 找 published record→校验 intake→编译 display/runtime prompt→创建 run→调现有 share task flow→建 runId↔sessionId/taskId 映射→ingest events→提 artifact。
- [spec_only] **promptCompiler / runtimePrompt** — 把 skill+intake+runtimePolicy 编译成 {displayPrompt(intake 摘要), runtimePrompt(给 base adapter 的完整 prompt), expectedArtifact}；这是 MVP 不新增 host adapter 的关键。
- [spec_only] **runtimeEventIngest** — 把 8 个 RuntimeEvent(accepted/progress/needs_user_confirm/needs_owner_approval/output/completed/failed/cancelled)映射成 MiniappRunRecord.status，挂在 /v1/hosts/:hostId/events 接收处经 ingestIfMiniappTask 调用。
- [spec_only] **artifactExtractor** — task.completed 时解析 fenced JSON/markdown markers，失败 fallback 合并 task.output 为 markdown_report，按 skill.expectedOutput.type 选 ArtifactRecord 类型存入 MiniappStore。
- [spec_only] **MiniappStore + MiniappData** — 独立于 RelayStore 的产品对象 store(JSON snapshot+JSONL journal)，保存 rawInput/extraction/skillDraft/build/eval/publish/run/artifact，只用 ID 引用 RelayStore。
- [spec_only] **friendMiniapps routes** — 消费者 5 端点：GET /miniapp(landing+intake+uiPlan)、POST /miniapp-runs、GET /:runId、GET /:runId/artifacts、POST /:runId/messages。
- [spec_only] **submitShareRuntime (内部抽取)** — 抽内部 submitShareRuntime(displayPrompt, runtimePrompt) 让普通聊天与 miniapp 共用链路；host 仍只收 prompt，不需改 host command。
- [spec_only] **DiagnosticMatrix (component)** — 热分 2 轴评估网格(rows×lenses，cell pending/streaming/filled 生命周期+per-cell severity+citation+overall stat)，10 状态全穷举，矩阵记 missing。
- [spec_only] **ContextChecklist (component)** — pre-flight readiness ledger(required_context+connector 行+readiness 计数)，presence-only 红ction+write confirm gate，状态从事件流派生，记 missing。
- [spec_only] **Scorecard (component)** — criteria rows+weights+verdicts+weighted overall，streaming-skeleton→frozen artifact，记 missing。
- [designed_mockup] **Checklist (component)** — 有序进度/runbook 列表(7 item 状态+左 accent rail+progress meter k/N+inline confirm gate)，通用 step-list 基座，记 partial。
- [spec_only] **credential_inventory/callback_flow/deployment_checklist/evidence_board (components)** — 4 个 app 专属注册表组件(凭证面板/3-link 回调轨/verify-gated 部署 runbook/只读证据卡)，均带硬 redaction 边界，全部 missing。
- [spec_only] **EvaluationReport publish gate** — publishGate('allow'|'block'|'manual_review') 阻断 'UI plan 无法降级渲染' 的发布，保证消费者永不到空白/崩溃的 /v2 页。

### Agora 产品论点 + 已落地 vs mock/规划 盘点（基于 VC拷打评审、技术架构核验、AVM buildspec 三份文档 + /tmp/avm-demo 真实代码）
- [built_real] **raw-capture.js（raw-AVM 捕获器）** — 把一个工作目录真实压成 raw-AVM 整包：扫 Claude/Codex 会话 jsonl 统计真实用过的 tool/MCP/skill + 抓 markdown 成果物 + 生成 BOOT.md 自启动说明书 + 打 zip，是真能跑的 Node 脚本。
- [built_real] **distill.js（蒸馏器：重证据→干净 mini app 定义）** — 读 raw-avm.json 把使用信号压成 brief，调本地 claude CLI 反推出干净 agent 定义（含 {answer.X} 参数插槽），再调真实 avm CLI 建成可打包 agent——闭环到 AVM Studio，是真链路（依赖本地 claude/avm 二进制）。
- [built_real] **studio.js（AVM Studio 后端：捕获/分享/实例化/Mini App）** — 零依赖 HTTP 服务，封装真实 avm CLI：agent list/show、matrix(跨runtime投影)、package export+inspect(打包分享)、install 到全新空 home 并做跨 runtime byte-identical 一致性校验、把 {answer.X} 插槽实例化成 Mini App——核心环节都跑真 CLI。
- [mock_demo] **miniapp-vi.html（消费侧市集/Mini App 界面）** — 消费侧前端是纯客户端 mock：硬编码 8 个 APPS、星级/调用量/排行/我的应用全是假数据，运行步骤用 setTimeout 假装，产物由本地 BUILD/ART 生成器编造，零 fetch、完全不连后端或真 LLM。
- [spec_only] **⑤ 安全闸 secretscan（export 净化 + inspect PASS/WARN/BLOCK）** — P0 凭据泄漏堵漏：照敲级 build spec（looksSecret/SanitizeMCPConfig/ScanCapBlob/verdictFor 纯函数 + 单测），但尚未写进 AVM 源码，仍是规格。
- [spec_only] **① AVM Hub 远程 registry（publish/search/install role@ver）** — 分发骨架：定义 RegistryEntry/index.json 身份键、publish 前置过安全闸，是详细规格未实现。
- [built_real] **③ 跨 runtime matrix 证明 Demo（护城河证据）** — avm matrix 命令规格为 S 工作量、复用现有 driver FieldMapping，且 studio.js 已经在调 avm matrix --json 做真实跨 runtime 投影与一致性校验——这条护城河证据链已部分真跑。
- [spec_only] **② runlog 评测 v0（leaderboard 成功率/复用率 + score thumbs）** — 客观层：基于已有 runs.jsonl 算榜单 + 反馈 hook，照敲 spec，未实现，且依赖真实调用量才有信号。
- [spec_only] **④ Mini App 薄壳（Params/Render + RunExec one-shot）** — 消费层探针：需给 AVM schema 加 Params/Render 两字段 + 新执行通道，是改动面最大、明确会反推 schema 重构的实验，定为最后做。
- [designed_mockup] **Agora 技术架构文档（L1-L4 协议栈/AVM 资产规范/reactive/四层结算）** — 质量分 58/100：愿景/分层抽象一流的 demo 级架构叙事，但支付协议归属错三处、reactive 与结算两大卖点自相矛盾、安全经济攻击面几乎全空白，尽调不过关。

### AVM 地基盘点：已有原语 + 本次新增 matrix + 到 Agora marketplace 还缺的层
- [built_real] **Agent 稳定模型(一次定义层)** — Identity/Instructions/Skills/MCP/Runtimes 五字段的 AVM-owned Agent 定义,name 正则约束、runtime 无关,是"一次定义跨 runtime"的根对象
- [built_real] **.avm.zip 包格式 + manifest** — PackageManifest(schema_version/name/version/agents/capabilities[]含 checksum)定义分发单元,install/export 真实可跑,是 registry 要复用的包格式
- [built_real] **内容寻址 capstore** — CapabilityID=sha256(kind+name+content_sha256) 前缀 cap_,身份与包名/路径/来源分离,是复用率去重和跨机引用解析的基础原语
- [built_real] **四态 MappingStatus** — runtime driver 把每个 Agent 字段翻译成 native/rendered/ignored/unsupported 四态并报告,是护城河证据的可对照口径
- [built_real] **RuntimeDriver 契约 + 三 driver** — Driver.Plan/Boundary/LaunchSpec 等七方法,codex/claude-code/opencode 三 driver 各自把同一 Agent 翻译成 native config,Plan() 已产 FieldMapping
- [built_real] **隔离边界 boundary** — per-Agent/runtime 隔离 state dir + 隔离 CODEX_HOME/HOME/CLAUDE_CONFIG_DIR 等环境,代跑文件系统隔离的现成底座(但不防 prompt 注入)
- [built_real] **RunService.Project (无写无启动投影)** — 复用 loadPlan 把 Agent 渲染成单 runtime 的 ProjectionFile(含 contents)+四态 mapping,不 apply 不 launch,是本次 matrix 的服务支点
- [built_real] **MatrixReport 模型(本次新增)** — MatrixReport/RuntimeProjection/ProjectionFile:同一 Agent 跨全部 runtime 的纯投影聚合,单 runtime 出错记 Error 不拖垮全表
- [built_real] **avm matrix 命令(本次新增)** — matrix <agent> [--runtime] 遍历 Diagnostics.Runtimes 逐个调 Run.Project,聚合成 MatrixReport,支持 --json,已挂进 root
- [spec_only] **① AVM Hub 远程 registry** — index.json + 静态托管 + publish/search/install role@ver,定义 RegistryEntry 跨实验复用的身份+版本 schema,分发骨架——仓库里全部 MISSING
- [spec_only] **⑤ 安全闸 secretscan/inspect** — export 净化(目标 100%)+ inspect PASS/WARN/BLOCK 裁决,registry publish 的准入硬门,纯函数单测——P0 但仓库里 MISSING
- [spec_only] **② runlog 评测 v0 (leaderboard/score)** — 基于已有 runs.jsonl 的 exit_code/耗时聚合成功率/复用率榜单 + 👍👎 反馈 hook,客观信号回流 search 排序——结构 RunRecord 已有,评测层 MISSING
- [spec_only] **④ Mini App 薄壳 + Params/Render schema** — Agent.Params 旋钮自动生成网页表单 + RunExec one-shot 捕获 + text/template render 产物,消费层探针——agent.go 现 0 个 Params/Render 字段,全 MISSING
- [spec_only] **A2UI / generative UI 层** — params 自动表单之上的真正 generative UI,buildspec 明确列为④薄壳验证后的下一轮 schema v2 输入,当前无任何设计落点
