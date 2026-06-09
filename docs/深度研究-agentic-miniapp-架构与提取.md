# 深度研究 · Agentic Mini-App:技术架构 + 怎么从 session 提取

> 三路并行深挖真实框架(AI SDK / Claude Artifacts / OpenAI Apps SDK / AG-UI / CopilotKit / tambo / MCP-UI)、方法论(PBD/PBE / AWM / Voyager / Trace2Skill / SkillGenBench / Claude Skills)、规格(Custom GPTs / SKILL.md / MCP / JSON Schema-RJSF),逐项抠真实字段与源链接。回答两个问题:**一个 UI 完备的 agentic mini-app 技术上长什么样、怎么从用户 session 里把它提取出来。**

## 0. 结论速览
- **它是什么**:一个"填表 → agent 可见地干活(调工具)→ 出产物卡 → 在产物上微调"的小应用。最小架构 7 层(intake / agent-loop / tools / UI 渲染 / state / artifact / streaming)。**UI 走"组件注册表 + agent 选择/填充",不走 Artifacts 式现写代码**——要的是可靠、可复现、可微调。
- **怎么提取**:`轨迹 → 抽象化(具体值→{slot})→ 契约化(前置/步骤/工具/产物/边界)→ 多样本/对比稳定化 → 可填表的 JSON Schema`。本质 = **Agent Workflow Memory 的抽象 + WISE-Flow 的对比约束 + SkillGenBench 的 6 维契约与双轨评测 + Claude skill-creator 的 SKILL.md 包格式**。
- **我们已有的 `agora-pitch-review`(固定 11 段模板 + 阶段判定 + 客观信号)正是这套方法学的一个手工实例** —— 反推成模板,就是 mini-app 工厂的第一个 ground-truth 样本。

---

## 1. 目标:UI 完备 agentic mini-app 的参考架构

### 1.1 七层骨架(跨所有框架抽出的公共结构)
| 层 | 干什么 | 标准做法 / 对应 |
|---|---|---|
| ① Intake 输入 | schema 定义一次填全的表单 | JSON Schema / Zod;**表单由能力规格生成** |
| ② Agent Loop | ReAct 循环(调工具→读结果→再决策),一个 run 含多 step | AG-UI Run/Step 生命周期;我们的 pi-agent-core 常驻 Agent |
| ③ Tools | 副作用执行单元(fetch_url…),带 I/O 契约 | MCP tool / OpenAI function;既驱动推理也驱动 UI |
| ④ UI 渲染 | 工具结果/状态→组件 | 三范式见 1.2 |
| ⑤ State | 共享 typed store:snapshot(全量)+ delta(JSON Patch 增量) | AG-UI StateSnapshot/StateDelta;Apps SDK widgetState |
| ⑥ Artifact 产物 | 可保留的结构化产物卡 | = 一次工具调用 output + 绑定组件,独立持久化 |
| ⑦ Streaming | SSE/WS 把上述变化以**标准事件**逐 step 推送,可 cancel/resume | AG-UI 17 事件;SSE 足够 |

> Agora 现状:②③⑦ 已具备(常驻 Agent + 工具 + SSE)。**待补**:① schema 化 intake、④ 组件注册表、⑥ 产物独立持久化、并让 SSE 事件对齐 AG-UI 命名。

### 1.2 生成式 vs 模板化 UI(谱系 + 推荐)
从最受控到最自由:**模板化(工具→组件映射,如 AI SDK UI / Apps SDK widget)→ 注册组件目录 + agent 选择(tambo)→ 声明式 JSON UI 规格 + 目录渲染(A2UI / Thesys C1)→ 生成式现写代码(Claude Artifacts / v0 / bolt / lovable)**。
- **推荐:"注册组件目录 + agent 选择/填充" 或 "声明式 JSON spec + 目录渲染",不走现写代码。** 理由:产物卡要能保留、要稳定可微调 → UI 必须有确定性边界;能力规格本就是契约 → 天然映射成组件目录的 schema,让 LLM **只选组件 + 填数据,不画像素**,把"生成"约束在数据层而非代码层。
- 最贴近的两个参照实现:**tambo**(Zod 注册表,组件即工具定义)和 **OpenAI Apps SDK / MCP Apps**(工具→widget 资源 + `structuredContent`/`content`/`_meta` 三分 payload + `window.openai` 桥)。后者与我们产品形态几乎逐项同构。

### 1.3 标准事件模型(AG-UI 17 事件 / 5 类 —— 我们 SSE 该对齐的命名)
- **Lifecycle**: RunStarted/RunFinished/RunError/StepStarted/StepFinished
- **Text**: TextMessageStart/Content(delta)/End
- **Tool**: ToolCallStart/Args(流式参数)/End/Result
- **State**: StateSnapshot(全量)/StateDelta(JSON Patch)/MessagesSnapshot
- **Special**: RawEvent(透传 pi-agent-core 原生)/CustomEvent(产物已生成/已保留)

典型一次 run:`RunStarted → StepStarted(think) → Text… → StepFinished → StepStarted(act) → ToolCallStart→Args→End→Result → StateDelta → StepFinished → Text(叙述产物) → RunFinished`。
**"在产物上微调" = 后续工具调用产出 `StateDelta` 打补丁到同一 artifact surface,而非重渲整卡**(参照 Apps SDK `callTool`/`sendFollowupMessage`/`setWidgetState`)。

### 1.4 Claude Artifacts 沙箱(若做"完全自由产物"才需要)
自包含单文件 app 跑在隔离 iframe(`claudeusercontent.com`),代码经 `postMessage` 进 iframe、React Runner 渲染;无 FS/cookie、网络几乎全封、预装库白名单、无持久化。**最生成式一端,可靠性/可控性最低**,我们不走它做主路。

---

## 2. 提取:从 session 到可运行 mini-app

### 2.1 五段拆解(给定一段成功会话 → mini-app 规格)
融合 AWM 抽象 + WISE-Flow 约束 + SkillGenBench 6 维契约 + skill-creator 流程:

| 维度 | 怎么从会话抽 | 形式化判据 |
|---|---|---|
| **固定能力流程** | 跨"会话内重复段 / 多条会话取交集"的动作骨架(AWM common sub-routine) | 在 paraphrase / 多实例下**保持不变**的步骤序列 |
| **输入槽位 required_context** | AWM 抽象法:把被实例化的具体值(文件/人名/目标/阈值)替换成 `{变量}` | 该值**随任务变** + **不可由流程内部推导** → slot |
| **工具** | 会话里实际调用过的工具/API/脚本 | SkillGenBench "Contract":接口 + I/O schema + 鉴权 |
| **产物规格** | 会话最终交付物的结构(复盘 11 段模板即范例) | 固定模板 + 校验线索(可执行/语义比对) |
| **agent 边界** | WISE-Flow 的 prerequisites + 顺序约束;什么必须先满足、什么不许做 | 前置/顺序/safety(不越权、不臆造) |

### 2.2 提取管线(三层:客观锚 → LLM 抽取共识 → 契约化)
1. **轨迹归一化**:解析会话 → (意图, 工具调用序列, 产物);推断 project。
2. **抽象化先行(AWM)**:把具体值替换成 `{slot}`,去掉一次性内容 —— 大部分不稳定来自把具体值当流程,先去掉骨架就稳。
3. **多样本/对比证据(WISE-Flow)**:同类多条会话取交集;用 clean-success / error-recovered / failure 三类对比,**只留成功路径里一致出现、失败路径缺失的步骤**。
4. **结构化模板约束输出(QA-CoT)**:用固定 slot schema 约束 LLM,不让它自由发明结构 —— 每次填同一个 schema 的槽。
5. **契约化(SkillGenBench 6 维)**:出 Contract(工具接口)/ Procedure(步骤+状态)/ Constraints(任务规则)/ Grounding(连回真实会话)/ Environment(依赖)/ Safety。
6. **评测闭环固化**:双轨(执行式跑用例 + 8 项静态契约检查)+ with/without baseline 对比 + bot 仿真。**"这个 spec 能否复跑出等价产物"作为接受门槛**,不达标回炉。
7. **打包成 SKILL.md / manifest**(见 §3)。

> 与现状:我们 v3 锚定管线已实现 §2.2 的【4 模板约束 + 共识 + 阈值】内核。**待补**:§2.2-2 抽象化(出 slot)、§2.2-5 契约化(工具 inputSchema / 产物 schema / 边界)、§2.2-6 评测门槛(复跑等价产物)。

### 2.3 槽位判定:必问 vs 可推断(回答"哪些每次问用户")
四条规则(PBE "不可由程序内部确定的叶子" + slot-filling asking-vs-inferring):
1. **可推导性**:能否从已给输入(转录/文件/上下文)高置信推断?能→默认/自动;不能→必问。
2. **跨实例方差**:多条会话里该位置总在变且无法派生→核心 slot;几乎恒定→固化进流程(不是 slot)。
3. **代价不对称**:猜错代价高(产物方向性错,如"对象是投资人还是 FA")→必问/必确认;低代价易改→推断 + 允许覆盖(escape hatch)。
4. **外部依赖**:需凭据/隐私/外部资源(API key/文件路径)→必问。
落地:**双 LLM**(Agent-S 模式)——一个抽 slot 候选 + 给"是否可推断/推断值/置信度",一个决定哪些升级为提问。低置信或高代价才问。
> 这正是我们 `compileAgentSystem` 里"先用可推断默认值开干,只有缺它根本无法开始的关键信息才 ask_user、一次问全"那条规则的理论依据。

### 2.4 提取稳定性(别每次抽出不一样的应用)
六个稳定器(全有论文支撑):① 抽象化先行(去具体值);② 多样本交集 / 对比证据;③ paraphrase 不变性 + 自一致(RobustFlow/ScoreFlow:偏好改写下保持稳定的结构);④ 固定 schema 约束输出;⑤ 去重 + 无效步过滤;⑥ 评测闭环把"稳定"变成可度量验收。

---

## 3. manifest 结构体(可自动生成、可运行时加载)

结论:我们现有 `AgenticAppManifest` 骨架对,但**凡是"要被机器校验或自动渲染"的部分,不能停在 `string[]`,必须落成 JSON Schema 对象**。三个升级点(⚠️):

```jsonc
{
  "manifestVersion": "0.2",
  "identity": { "id","name","tagline","version","icon?","status" },  // 取自 GPT name/description + SKILL.md
  // ⚠️1 inputs:把 required_context: string[] 升级成 JSON Schema(自动渲染表单+校验)
  "inputs": {
    "schema":   { /* JSON Schema 2020-12, type:object, properties+required+default+enum+format */ },
    "uiSchema": { /* 可选 RJSF: ui:widget / ui:order / ui:placeholder */ }
  },
  // ⚠️2 tools:带 inputSchema(运行时校验 + 渲染"工具调用确认卡")
  "tools": [ { "name","description","inputSchema":{type:"object",...,additionalProperties:false},
               "outputSchema?", "annotations":{readOnlyHint,destructiveHint,idempotentHint,openWorldHint},
               "access":"read|presence_only|write", "requiresConfirmation":false } ],
  "agent": { "role","goal","instructions",  // = SKILL.md 正文 / GPT instructions
             "skill_set":[{name,steps,stopping_condition}],
             "boundaries":{allowed,disallowed,requires_confirmation_before,risk_level},
             "starter_prompts":[] },          // = GPT conversation_starters / MCP prompts
  // ⚠️3 output:加产物数据 schema(可校验 + 产物卡强类型渲染)
  "output": { "type","schema?","exportable":true,"fallback":"markdown_report" },
  "ui": { "profile":"intake_then_thread","intake":{component:"intake_form"},
          "artifact":{component:"artifact_builder"},"components":[...],
          "resourceUri?","csp?","disclaimer?" },
  "context_contract": { connectors,privacy }, "provenance": { evidence_refs,source_session_id,approved_by }
}
```
每段都映射到 ≥2 个真实产品同名概念(身份=GPT+SKILL.md;inputs=JSON Schema/MCP elicitation;tools=MCP/function;指令=SKILL.md/GPT;产物=MCP outputSchema;UI=MCP-UI/Apps SDK _meta)→ 自动生成有先验、运行时有现成 host 可借。

### 3.1 输入槽位 → JSON Schema → 自动渲染表单(② 的落地)
每个 required_context = JSON Schema 一个 property(`type/required/default/enum/format`);可选 uiSchema 控渲染(`ui:widget/ui:order`);host 用 **RJSF** `<Form schema uiSchema onSubmit>` 自动出带校验的 intake 表单;提交值进 shared state 作 agent 输入;缺字段走 MCP `input_required`+`elicitation`(同一套 schema 两处复用:开场表单 + 中途补问)。这是 MCP / OpenAI function / AG-UI / RJSF 四方共用的事实标准,自动生成 + 自动渲染都白嫖现成实现。

---

## 4. 对照 Agora 现状 · 落地 diff
| 现状(loop-server miniapp + distill-to-manifest) | 研究建议的升级 |
|---|---|
| `interaction.required_context: string[]` | → `inputs.schema`(JSON Schema)+ uiSchema,用 RJSF 渲染 intake |
| `agent.tools: string[]` | → 带 `inputSchema` 的工具对象数组(校验 + 确认卡)|
| `ui_profile.type` 只描述形态 | → 加 `output.schema` 让产物卡强类型渲染、可校验 |
| SSE 自定义事件名 | → 对齐 AG-UI 17 事件(Run/Step + Tool 四段 + State snapshot/delta)|
| 提取:S1精读→taxonomy→分类 | → 补抽象化(出 slot)、对比证据(出前置/顺序)、双轨评测门槛(复跑等价产物)|
| 微调:重新生成 | → 后续工具调用 `StateDelta` 打补丁到同一产物 surface |

---

## 5. 源 + 诚实标注
**架构**:[AI SDK Generative UI](https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces) · [Apps SDK](https://developers.openai.com/apps-sdk/build/mcp-server) · [AG-UI](https://docs.ag-ui.com/introduction)·[17 事件](https://www.copilotkit.ai/blog/master-the-17-ag-ui-event-types-for-building-agents-the-right-way) · [tambo](https://github.com/tambo-ai/tambo) · [MCP Apps](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/) · [Claude Artifacts 逆向](https://www.reidbarber.com/blog/reverse-engineering-claude-artifacts)
**提取**:[FlashFill/PROSE](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/pbe16.pdf) · [Agent Workflow Memory 2409.07429](https://arxiv.org/abs/2409.07429) · [Voyager 2305.16291](https://arxiv.org/abs/2305.16291) · [Trace2Skill 2603.25158](https://arxiv.org/pdf/2603.25158) · [SkillGenBench 2605.18693](https://arxiv.org/html/2605.18693) · [Claude skill-creator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md) · [Turning Conversations into Workflows 2502.17321](https://arxiv.org/abs/2502.17321) · [WISE-Flow 2601.08158](https://arxiv.org/pdf/2601.08158)
**规格**:[Custom GPT actions](https://help.openai.com/en/articles/9442513-configuring-actions-in-gpts) · [SKILL.md spec](https://www.agensi.io/learn/skill-md-format-reference) · [MCP tools](https://modelcontextprotocol.io/specification/draft/server/tools) · [Apps SDK reference](https://developers.openai.com/apps-sdk/reference) · [RJSF uiSchema](https://rjsf-team.github.io/react-jsonschema-form/docs/api-reference/uiSchema/)

**诚实标注**:ChatGPT Canvas 底层架构无官方公开规范(以 Apps SDK widget 类比);Claude Artifacts 无官方架构文档(以可靠逆向工程来源);AG-UI `RunAgentInput` 逐字 TS 定义以 `ag-ui-protocol/ag-ui` 仓库 `packages/core` 源码为准;MCP 2026 的 input_required/elicitation 属 draft 阶段;Trace2Skill/v0/bolt 无完整公开 spec(以摘要/产品行为为准)。
