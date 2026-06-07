# M3 · 能力封装 Manifest(桥的咽喉)展开

> M3 = 把 **M2 蒸馏出的 agent 定义** 翻译成 **`AgenticAppManifest v0.1` 标准件**。
> 它是整条 MVP 链路的咽喉:它一通,后面 promptCompiler 填槽、intake 表单、消费侧渲染就都有了数据契约。
> 代码落点:`~/Desktop/Agora/code/mvp/`。

## 1. 为什么是咽喉
M1/M2/M4 已经是真的,但它们各说各的数据格式:
- M2 蒸馏吐的是 `tools/distill.js` 那个 JSON(`name/role/instructions/recommended_capabilities/...`)
- M4 运行时(Ralphloop)只认一种入口:`AgenticAppManifest v0.1`(`parseManifest()` 校验后才分流执行)

**M3 就是这两者之间唯一的翻译器。** 没有它,蒸馏出的东西喂不进运行时,整条链路断在中间。

## 2. 输入 → 输出

**输入**(distill.js 已经在输出的 JSON):
```json
{ "name":"research-to-figma-app", "title":"调研驱动的设计搭建师",
  "description":"先把产品调研清楚，再搭出界面方向。", "role":"产品设计师",
  "instructions":"你是…\n语气：{answer.style}。\n受众：{answer.audience}。",
  "recommended_capabilities":["WebSearch","figma"], "why":"figma 调用最多…", "slug":"research-to-figma-app" }
```

**输出**(权威 `AgenticAppManifest v0.1`,字段对齐创作者侧 `build_agentic_app()` services.py:369)。

## 3. 完整字段映射表

| manifest 字段 | 从哪来 | MVP 取值 |
|---|---|---|
| `manifestVersion` | 固定 | `"0.1"` |
| `manifest.mini_app_id` | distill.slug | `research-to-figma-app` |
| `manifest.name` | distill.title | 调研驱动的设计搭建师 |
| `manifest.version` | 固定 | `"0.1.0"` |
| `manifest.creator_user_id` | 调用方传入 | `ctx.creatorUserId` |
| `manifest.source_candidate_id` | 生成 | `cand_<hash>` |
| `manifest.status` | 固定 | `"draft"`(人工过目后改 published) |
| `agent.role` | distill.role | 产品设计师 |
| `agent.goal` | distill.description | 先调研再搭界面方向 |
| `agent.boundaries` | MVP 默认 | `["只读用户提供的上下文","不执行破坏性操作"]` |
| `agent.tools` | 固定(demo) | `["readonly_context"]` |
| `capability_basis.*` | distill.title/description/why | name/repeated_workflow/why 直填;`recommended_form="agentic_app"` `confidence="medium"` `risk_level="low"` |
| `skill_set[0].steps` | **distill.instructions** | ★ 见决策①——把完整指令模板(含 `{answer.X}`)整段放这里 |
| `skill_set[0].stopping_condition` | 固定 | `"产出一份 artifact 后结束"` |
| `interaction.ui_profile.type` | 固定 | `"guided_intake"` |
| `interaction.ui_profile.components` | 固定兜底 | `["intake_form","artifact_builder"]`(见决策③) |
| `interaction.required_context` | **解析 instructions 里的 `{answer.X}`** | ★ 见决策②——`["style","audience"]` |
| `interaction.starter_prompts` / `review_questions` | MVP 默认 | `[]` |
| `context_contract` | MVP 默认 | `connectors:[]` `privacy:[]`(不接外部连接器) |
| `launch_contract` | MVP 默认 | `modes:[{id:"default",label:"开始",description:""}]` `default_mode:"default"` |
| `llm_boundary` | MVP 默认 | allowed/disallowed/requires_confirmation_before `[]`;`risk_level:"low"` `handoff:""` |
| `runbook` / `examples` | MVP 默认 | `steps:[]` `checkpoints:[]` `examples:[]` |
| `safety` | 固定 | `risk_level:"low"` `disclaimer:"AI 输出仅供参考，请自行核实。"` |
| `provenance` | 调用方传入 | `evidence_refs:[]` `source_session_id:ctx.sessionId` `approved_by:""` |

## 4. 三个关键设计决策(开工前先认)

**决策①:蒸馏出的指令放进 manifest 哪里?**
manifest 接口里**没有** `instructions` 字段。但 distill 的 `instructions`(含 `{answer.X}`)是这个 agent 的灵魂。
→ **放 `skill_set[0].steps`**(`string[]`,spec 合法),整段指令模板作为一个 step 原样保留(`{answer.X}` 不拆)。运行时的 ManifestAgentAdapter 本来就把 `agent + skill_set` 编译成 system policy,正好对得上。promptCompiler 之后读这一段、填槽。

**决策②:`required_context` 怎么来?**
→ **正则扫描 `instructions` 里的 `{answer.(\w+)}`,去重**,得到槽名列表 `["style","audience"]`。这就是消费侧 intake 表单要问用户的字段。**这是 M3 最核心的一行逻辑。**

**决策③:`components` 填什么?**
→ MVP 固定兜底对 `["intake_form","artifact_builder"]`(spec 的 `__fallback__` 对)。等 M5 升级再根据 anatomy 选 `scorecard`/`diagnostic_matrix`。

## 5. 拆成 4 个可逐步尝试的小步(增量,每步可单测)

1. **纯映射函数**:`distillToManifest(distillJson, ctx)` → manifest 对象。只做字段搬运 + 默认值。【最小,先做这个】
2. **槽提取**:`extractSlots(instructions)` → `["style","audience"]`,写进 `required_context`,指令整段进 `skill_set[0].steps`。
3. **校验**:`parseManifest(manifest)`(照 spec 字段必填性)→ 断言不缺字段、类型对。
4. **fixture 验证**:拿 distill.js 对一个真实 bundle 跑出的真 JSON 当 fixture → 跑通 1→3 → 断言 manifest 形状 + 槽提取正确。

## 6. 验证方式(怎么算 M3 通了)
- 给定 distill JSON fixture → `distillToManifest` 产出的 manifest 能通过 `parseManifest` 零报错;
- `required_context` 与指令里的 `{answer.X}` 槽一一对应;
- `skill_set[0].steps[0]` 完整保留了带槽的指令模板(后面 promptCompiler 能填)。

## 7. M3 通了之后解锁什么
- **M4 promptCompiler**:读 `skill_set[0].steps` + 把 `required_context` 的用户答案填进 `{answer.X}` → runtimePrompt → 直调已存在的 `submitFriendTaskV1`。
- **M5 intake 表单**:读 `required_context` → 自动生成消费侧那几个填空。
- 也就是说:**M3 是 P0 整条切片的数据契约源头。先把它锁死,M4/M5 才有东西可接。**

## 下一步
代码:`~/Desktop/Agora/code/mvp/distill-to-manifest.mjs`(+ fixture + test)。先把第 1+2 步(映射 + 槽提取)写出来跑通,再补 parseManifest。
