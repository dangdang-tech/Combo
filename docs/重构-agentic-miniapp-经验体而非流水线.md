# 重构 · Agentic Mini-App = 经验体,不是流水线

> ⚠️ 本文**推翻** `深度研究-agentic-miniapp-架构与提取.md` 的核心框架(那份把 mini-app 当成"填表→可见干活→产物卡→微调"的固定七层流水线 + "Workflow 提取")。经多 agent 深挖真实项目(LangGraph / Letta / ExpeL / Delphi / Second-Me)+ 论文实证后,纠正为下面这版。带源链接;查不到说查不到。

## 0. 一句话定义(取代旧定义)

> **Agora mini-app = 一个被某人经验所 condition 的、灵活的 agent。** = persona/经验体(灵魂)+ 一组能力(tools)+ 一个**可有环**的行为图(执行壳)+ 一个**按任务自适应、可选**的交互面(外壳)+ 边界与交互姿态。

把一个开发者在真实对话历史里反复体现的**判断、品味、标准、know-how**,提取成一个别人能复用的"经验副本"。用 Delphi 的话:可复用的核心是**这个人的决策模式(decision-making patterns)**,不是事实检索,**更不是固定步骤序列**。

## 1. Agent 的角色定位:交互姿态谱,不是"代你干活的执行体"

旧框架最隐蔽的错误 = 默认 agent = 自动化执行器(delegate)。正确:一个**可显式选择的 interaction_stance 连续谱**(Delphi + MS copilot↔agent 共识):
- **advisor(顾问/被问)** — 别人问"遇到 X 你会怎么取舍",agent 用这个人的判断回答(Delphi 默认形态:可扩展的专家本人)。
- **coach(陪练)** — 用这个人的标准陪对方一起做,边做边给判断。
- **collaborator(协作)** — 共同推进,产物共建。
- **delegate(代做)** — 代替完成、最后交付(旧框架错误地把这一档当成唯一形态)。

**差异化:同一份 Experience 能以不同 stance 暴露给消费者**,创作者打包时选(或允许多档)。借 Honcho:agent 背后的经验是**可被自然语言追问的活表征(dialectic)**,不是一次性产出的静态产物卡 → 天然支持"无固定 DAG、可有环、不停对话调整"。

## 2. 经验 vs 流程:本质区别(Experience Compression Spectrum)

元框架 = Experience Compression Spectrum([arXiv 2604.15877](https://arxiv.org/abs/2604.15877)),把记忆/技能/规则统一成一条压缩谱:
- **L0 Raw Trace**(原始轨迹,1:1)
- **L1 Episodic Memory**(结构化事件+上下文,~5-20x)
- **L2 Procedural Skill**(命名例程+有序步骤+工具绑定,~50-500x)= **流程(how-to 序列)**
- **L3 Declarative Rule**(领域无关决策原则,**无步骤顺序**,只剩约束/原则,~1000x+)= **经验/判断**

**本质区别:流程(L2)有步骤顺序、绑工具、绑环境;经验(L1+L3)是判断/原则/案例,去掉了步骤顺序、environment-grounding-free。**

**Agora 提取目标 = L1 + L3(经验),不是 L2(流程)。** 流程只在确实有稳定可执行例程时,作为**可选附件**出现,不是骨架。

为什么经验更对:
1. Agent Workflow Memory([2409.07429](https://arxiv.org/abs/2409.07429),被旧框架采纳的那派)自承 "workflow actions can fail when environments change" —— 流程一变环境就脆。
2. 实证([2604.15877](https://arxiv.org/abs/2604.15877)):negative constraints(守则)**+7-14pp**,positive directives(按步骤做)**反而掉点**。
3. Delphi:可复用的是 decision-making patterns;Second-Me 的 Me-Alignment 目标是"反映你**怎么判断**而非你**知道什么**"。

## 3. 经验用什么结构表示:三类经验体(各有现成范本)

顶层组织:每类落成一个 **Letta memory block** `{ label, description, value, limit, read_only }` —— 常驻 context、description 让 agent 自己判断何时调用、可被 agent 运行中 append/replace 自我修订。经验 = 可读可写、能随对话进化的文本,而非固化流程。

```
ExperienceStore {
  preferences: [PreferenceNote]   // 偏好/品味/价值(mem0 semantic, 高权重)
  heuristics:  [HeuristicNote]    // 判断与守则(ExpeL rule,优先 guardrail)
  examples:    [EpisodicExample]  // 带证据指针的代表性案例(Gen-Agents reflection)
  procedures?: [ProcedureNote]    // 【可选附件】真有稳定例程才填,L2,不是骨架(Voyager 式)
}
PreferenceNote { statement, valid_at, invalid_at, evidence:[SessionRef] }   // Zep 时序:标准演化,旧的标失效不删
HeuristicNote  { text(GENERALLY APPLICABLE,禁提具体某次对话), form:constraint|policy, importance, evidence }  // ExpeL insight
EpisodicExample{ insight_text(踩过的坑/高层洞察), evidence:[pointer](必挂), importance, created_at }  // Reflexion + reflection tree
```

## 4. 抽象结构体(取代 AgenticAppManifest 的 skill_set/runbook 中心化)

跨 OpenAI Agents SDK(能力槽位)、Letta(memory blocks)、Second-Me(L1/L2)、Delphi(双层心智)归纳。**注意:能力槽位 + 经验 + 行为图,不是阶段产物链。**

```
MiniApp {
  identity { name, one_liner, persona, voice_anchors:[str] }   // voice_anchors=2-3 句本人真句子,prompt 生成不出的 taste 锚
  experience: ExperienceStore                                  // === 灵魂(见 §3)===
  behavior: Graph {                                            // === 执行壳:可有环(见 §5)===
    state: SharedState                                         // 共享 schema + reducer(LangGraph)
    nodes: [Node]                                             // 读 state 返回 partial update
    edges: [Edge | ConditionalEdge]                          // 条件边可指回更早 node = 环
    interrupts: enabled, recursion_limit: int
  }
  tools: [Tool]
  boundaries { disallowed:[str], guardrails:[str], risk_posture:str }  // negative constraint 优先
  interaction {                                               // === 可选外壳(不是骨架)===
    stance: advisor|coach|collaborator|delegate               // §1
    intake: optional                                          // 表单只是快速表达需求的一种入口
    modality_policy: form|conversation|hybrid|generated       // 按任务自适应
    surfaces: [Surface]                                       // 产物/卡退化为众多可选渲染之一
  }
  provenance { evidence_pointers:[SessionRef] }               // 每条经验回溯原 session 片段
}
```
**与旧 manifest 的本质区别**:旧的把 `skill_set`(步骤+停止条件)+ `runbook`(执行步骤+checkpoint)当核心 → 那是流程。新结构把 `experience` 当灵魂,`behavior` 只是把经验用起来的可有环执行壳,`runbook` 类有序步骤降级为 `experience.procedures` 这个可选附件。

## 5. 修订架构:三件套 + 灵活有环行为图

**A. 构建期(提取经验,不提取流程)** —— 不是单向阶段链,是**可反复进出的 curation 环路**:
`session → 对比提取(成功vs失败,ExpeL)→ 三类经验体草稿 → 创作者确认/改写/删(挂证据指针)→ 经验库(Letta blocks)`。**没有 Auto Eval 硬门禁**;质量靠"像不像他"的 10-15 条测试集,不靠量化分。创作者可随时回任意经验块 EDIT/REMOVE。

**B. 运行期(状态驱动的有环图,抄 LangGraph 心智)**:State + Nodes(读 state 返回更新)+ Conditional Edges(读 state 决定下一步,**可指回更早 node 形成环**)。LangGraph 设计原文:"the computation graph for an LLM agent is cyclical, and thus cannot be handled by DAG algorithms" → **有向有环图是一等公民,不是 hack**([building-langgraph](https://www.langchain.com/blog/building-langgraph))。**"不停对话/手动调整" = 从"产物 node"指回"理解需求/重做 node"的条件边构成的环**,不是线性 intake→work→card→tweak。配 recursion_limit 防失控。

**C. "不停对话/手动调整" = interrupt + checkpoint(原生,不另造一套)**:agent 跑到需人拍板/手改处就 `interrupt()`、存 StateSnapshot、等用户(对话或直接编辑产物)、再 `Command(resume=...)` 从原点继续。一举解决持久化 + 可关进程几天再回来 + human-in-the-loop。

**D. intake 可选 + 模态自适应**:Agentic-UX 决策矩阵——高频结构化→(或 AG-UI `generateUserInterface` 按需生成)表单;罕见/需引导→对话;高风险/复杂分支→hybrid(chat→mini-form→summary→approval)。**表单是行为图里可选的一个 node**,原则"match modality to task type, not default to chat"。

**E. 产物在最后但非核心**:CopilotKit 三档控制度分阶段落地(Static 预置组件 → Declarative A2UI 规格 → Open-ended surface/iframe)。**产物卡退化为众多可选渲染之一**。

## 6. 为什么 frequency / Skill-Strength 是错的抽象(用什么替代)

硬证据(论文实证,非直觉):
1. **fidelity > compression**([2604.15877](https://arxiv.org/abs/2604.15877)):curated skills **+16.2pp**,LLM 自生成 skills **+0.0pp**。价值取决于提取保真度,不取决于"出现几次"。
2. **频次聚合剧烈伤效果**:"including success-trace signals can cause **±21pp swings**"。按频次把异质上下文混在一起会剧烈波动。
3. **频次驱动的流程抽取本身就脆**(AWM,环境一变即失效)。
4. **概念错误**:频次≠价值。**做一次但体现强判断的事,价值可能高于重复十次的机械操作。** mem0 也用 type_weight 把 semantic(偏好/判断 0.6)放在 procedural(流程 0.1)之上 —— 工业界已用权重否定"流程频次=价值"。

**替代**:① 不给"技能"打 strength/confidence 分;② ExpeL 的 `importance` 只作**维护信号**(增量编辑去留:AGREE+1/EDIT+1/矛盾-1/归零删),衡量"这条规则是否还成立",不是"动作做了几次";③ 价值靠**对比提取(成功vs失败)+ 人工 curation + 像不像他的测试集**;④ 给经验加 `valid_at/invalid_at`(Zep)让标准演化有一等结构。

## 7. 怎么从 session 提取经验(对比,不是统计)

核心抄 ExpeL([2308.10144](https://arxiv.org/html/2308.10144v2)):① **成功 vs 失败/返工对比**(定位哪步判断对、避开什么坑 → insight);② **跨任务找 common good practices**(归纳反复体现的品味/标准)。两条天然产出判断/经验而非流程。
- **维护**:ExpeL 4 操作 AGREE/EDIT/ADD/REMOVE;硬约束直接照搬成 system prompt:"Do not mention the trials in the rules because all the rules should be GENERALLY APPLICABLE",每轮 ≤4 操作、每规则 ≤1 操作。
- **表达优先 guardrail**:RuleShaping 实证 negative constraint +7-14pp。提取的经验写成"会拒绝什么/坚持什么标准/何时停下核对"。
- **必挂证据指针 + 可追问**:每条经验指回原片段(Gen-Agents),用户可一键确认/删/改(契合"不停对话或手动调整"),防 LLM 幻觉出不属于这个人的经验。
- **验收靠"像不像他"**,不靠频次:少量高质量 curated examples + 本人真句子锚定,10-15 条测试输入验证判断。

## 8. 推翻 / 保留清单
**推翻**:固定七层流水线(改三件套 + 可反复进出 curation 环路 + 有环运行图)· agent=执行体(改 interaction_stance 谱)· 提取=skill_set/Workflow/频次抽取(改 Experience 对比提取,L1+L3)· frequency/Skill-Strength 价值分(改 importance 维护信号 + curation + 测试集 + 时序)· manifest 以 skill_set+runbook 为核心(改 experience 为灵魂,runbook 降级为可选 procedures)· Auto Eval 量化硬门禁(改"像不像他"测试集;安全降级为 boundaries 字段)· intake_form 核心组件(改可选 node + 模态自适应 + 按需生成)· 产物卡框架核心(改众多可选渲染之一)· 线性 DAG(改有向有环图 + interrupt/checkpoint + recursion_limit)。
**保留**:运行在创作者 Host、provenance 默认对消费者隐藏、写/高风险需确认或审批、复用 RuntimeEvent/provider contract(从"流水线的层"变成"行为图里的 guard 与字段")· 证据可追溯(目的从"阶段回放"转为"每条经验挂证据指针、可审计、一键改写")。

## 源
[Experience Compression Spectrum 2604.15877](https://arxiv.org/abs/2604.15877) · [ExpeL 2308.10144](https://arxiv.org/html/2308.10144v2) · [Agent Workflow Memory 2409.07429](https://arxiv.org/abs/2409.07429) · [Building LangGraph](https://www.langchain.com/blog/building-langgraph) · [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts) · [Letta Memory Blocks](https://www.letta.com/blog/memory-blocks) · [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/agents/) · [Delphi 设计](https://inferencebysequoia.substack.com/p/dara-ladjevardians-delphi) · [Second-Me](https://deepwiki.com/mindverse/Second-Me) · [Honcho](https://github.com/plastic-labs/honcho) · [CrewAI Flows](https://docs.crewai.com/en/concepts/flows) · [smolagents](https://huggingface.co/blog/smolagents)

**诚实标注**:Delphi/Second-Me 的内部"经验"表征细节部分未开源(以设计访谈/DeepWiki 为准);ExpeL 的 importance 数值规则取自源码 prompt;Experience Compression Spectrum 的 pp 数字取自该论文实验表。
