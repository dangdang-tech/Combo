# Raw→能力提取层 · 技术方案(Human-Anchored 实现版)

> 配套 `raw-to-capability-执行思路-human-anchored.md`(讲"为什么")。本文讲"怎么做":每环节用 LLM 还是确定性、数据结构、prompt、接口。
> 代码落点:`~/Desktop/Agora/code/mvp/`(`loop-server.mjs` / `pi-exec.mjs` / `distill-to-manifest.mjs`)。复用现有 S1/evidence/manifest,新增锚定与增量。

---

## 0. 全局:每环节"谁来做"

| 环节 | 实现手段 | 为什么 |
|---|---|---|
| S1 会话精读(observation) | **LLM**(便宜模型 temp=0,每段一次,缓存) | 读真实内容出草稿;**同时抽"输入特征"(语言/领域/输入类型/规模)→ 用于算范围** |
| 草稿能力归纳(taxonomy) | **LLM**(一次,单 pass,**去掉 v3 的 K=3 共识**) | 语义分组是 LLM 强项;人在后面兜,不需要共识 |
| 可复用/置信信号 + **范围一致性** | **确定性计算**(段数/跨项目/新近/时长 + **scope coherence**) | 都可算,不该问 LLM;**范围一致性压过纯频率**(见 §2.4) |
| 分类(草稿 + 增量) | **LLM**(单 pass,锚点固定时很稳) | 把观察归到固定清单,低方差 |
| 锚定操作(确认/改名/合并/删) | **纯代码** | 集合操作,无需模型 |
| 拆分(split) | **小 LLM**(只对该能力 evidence 重分类到 2 个新标签) | 局部、便宜 |
| 打包成 manifest | **LLM**(按需,创作者选了才跑) | 写指令/抽槽,一次一个 |
| 提名草稿(增量novel) | **LLM**(只对没匹配上的新观察) | 量小、便宜 |
| 锚定 / 审名 | **人** | 全流程最高价值信号 |

> 一句话:**LLM 做"读/归纳/分类/写",确定性做"算信号",代码做"集合操作",人做"拍板"。**

---

## 0.5 验收:只盯一个绑定关系(raw data ↔ 能力)

整条链路里绝大多数环节都是**人可事后修的判断**(名字丑→改、粒度粗→拆、漏了→加)。唯一**客观、可证伪、错了会静默向下游传染**的,是:

> **每个能力,能否追溯到真实会话、那些会话是否真的体现它、from_segments 是否诚实——以及这些证据的语境是否一致(= 范围是否锐利)。**

**为什么是它最重要**:① 唯一的"真假"判据(其余都是品味);② 幻觉从这里进(LLM 会编一个听起来很对、底下却没真实会话的能力);③ 便宜可查、错了可救(打开证据一看便知),不查则上线一个虚构的"你"。

**验收动作(抽 3-5 个能力,展开 evidence,问四句)**:
1. 这几段我**真做过**吗?(查幻觉)
2. 说"来自 N 段",**真有这么多**吗?(查 from_segments 诚实度)
3. 这几段**是不是同一回事**?(查过度合并/糊)
4. 这几段**语境一致**吗?它们划出的**适用范围**是我想要的吗?(查 scope —— 见下)

再加**召回兜底**:扫一眼清单,"有没有我明显常做、却没列的?"→ 用 `add` 补。

> **证据同时回答两件事**:真不真 = 能力成立否;齐不齐(语境一致)= 范围锐利否、该不该拆。所以验收 raw→能力,**就盯"能力是否忠于证据 + 证据是否同质"这一个点**。

---

## 1. 数据模型(三个核心结构)

### 1.1 DraftCandidate(草稿引擎产出,喂给锚定 UI)
```ts
DraftCandidate {
  tempId: string,                 // 锚定前的临时 id,如 "d3"
  name: string,                   // LLM 起的中文能力名(草稿,人可改)
  intent: string,                 // 一句话它干嘛
  suggested_type: "core-workflow" | "recurring" | "occasional",
  confidence: "high" | "med" | "low",   // 由 reusability + 段数定档
  reusability: {                  // 确定性算出,用于排序/展示
    overall: number,              // 0~1
    frequency: number,            // 段数 / 最大段数
    crossProject: number,         // (项目数-1)/(最大-1)
    recency: number,              // 1 - 距今天数/最大
    timeCost: number              // 平均消息数(时长代理)/ 最大
  },
  from_segments: number,          // = evidence.length
  evidence: [{ path, title, source, date, project }],  // 来自的真实会话
  suggested_slots: string[],      // 从 observation.inputs_user_gave 聚出的候选输入槽
  scope: {                        // 适用范围 —— 由证据【算】出来,不是 LLM 编(见 §2.4)
    language: string,             // "zh" | "en" | "mixed"
    domain: string,               // 垂类,如 "SaaS路演" / "JS仓库" / "短视频内容"
    input_type: string,           // "录音" / "代码仓库" / "文档" / "截图"
    scale?: string,               // "早期" / "30-60min" / "单文件"
    preconditions: string[],      // 必须为真才能跑(如"有转录文本")
    out_of_scope: string[]        // 已知不适用
  },
  scope_coherence: number         // 0~1:evidence 的输入特征有多一致。低 = 范围糊 = 该拆
}
```
> **关键:`scope` 是证据分布的画像。** 能力只在它被提取自的那批会话的分布内**被验证过**;超出即外推。`scope_coherence` 低意味着证据语境杂(中文SaaS+英文biotech 混在一起)→ 这是**拆分信号**。

### 1.2 CapabilityAnchor(创作者锚定后的能力,持久 taxonomy)
```ts
CapabilityAnchor {
  id: string,                     // 稳定 id,如 "cap_a1b2"
  name: string,                   // 创作者确认/改写的名字(身份,锚定后不漂)
  intent: string,
  type: string,
  slots: string[],                // 运行时输入槽
  evidence: [{ path, title, source, date, project }],  // 可增量追加
  scope: { language, domain, input_type, scale?, preconditions[], out_of_scope[] },  // 创作者确认/收窄后的边界
  scope_confirmed: boolean,       // 创作者是否过目并认可范围
  status: "confirmed" | "retired",
  origin: "draft" | "human-added",
  manifest_id?: string,           // 打包后回填
  createdAt, updatedAt
}
```
> 锚点的 `scope` 是**创作者主动划定**的(可在草稿 scope 上收窄)——锐利的边界是他敢拿去卖的底气,也是生产期运行时闸的依据(§5)。

### 1.3 ReviewItem(增量回路里没匹配上的新观察 → 待人审)
```ts
ReviewItem {
  id, candidate: DraftCandidate,        // 对 novel 观察跑 mini-draft 出的提名
  proposed_op: "ADD" | "MERGE_INTO" | "SPLIT",
  target_anchor_id?: string,            // MERGE_INTO/SPLIT 时
  reason: string
}
```

持久化:`apps[id].draft`(DraftCandidate[])、`apps[id].anchors`(CapabilityAnchor[])、`apps[id].reviewQueue`(ReviewItem[]),写 `apps-db.json`。

---

## 2. ② 草稿引擎(LLM 归纳 + 确定性算信号)

**选型决策:v1 草稿 = 精简版单 pass v3 + crune 式确定性可复用分。** 理由:复用已跑通的 S1/taxonomy/classify;**砍掉 K=3 共识**(人是锚,不需要稳定门);叠加可算的置信信号。后续若要更省,把 S1+归纳整段换成 crune 确定性骨架,接口不变。

### 2.1 步骤(对照现有 `runExtraction`)
1. **S1 精读**(LLM,`pool(idx,8)`,temp=0,缓存):每段 → `{goal,steps,inputs_user_gave,artifact,success_signal, input_features}`。**在现有基础上加 `input_features:{language,domain,input_type,scale}`**(让模型顺手标这段的输入特征)。
2. **归纳 taxonomy**(LLM,一次):`buildTaxonomy(obs)` → 12-20 个细粒度能力 `{name,slug,intent,type,slots}`。**复用现有 TAX_S2/S3 prompt。**
3. **分类一次**(LLM,`classifyRound` 单轮,不再跑 3 轮):每段 obs 归到 taxonomy 的 0~多个 id → `Map(capId → Set(obsIdx))`。
4. **确定性算信号 + 组装 DraftCandidate**(纯代码,无 LLM):
   ```
   evidence(cap)   = 各 obs 命中 cap 的 session_ref 并集(去重)
   from_segments   = evidence.length
   frequency       = from_segments / max
   crossProject    = (distinct project - 1)/(max-1)
   recency         = 1 - daysSinceLast/maxDays
   timeCost        = avg(session.count) / max      // 消息数当时长代理
   scope           = 该 cap 的 evidence 各 input_features 的【众数/区间】(language/domain/input_type/scale)
   scope_coherence = evidence 在各 feature 上的一致度(众数占比的几何平均,0~1)
   overall         = (0.30·freq + 0.20·timeCost + 0.20·crossProj + 0.10·recency) · (0.4 + 0.6·scope_coherence)
   confidence      = overall>0.5 ? high : from_segments>=3 ? med : low
   suggested_slots = 该 cap 的 obs.inputs_user_gave 词频 top-k 归一
   ```
5. 产出 `DraftCandidate[]`,按 `reusability.overall` 降序。**不丢"低置信",全给人**(只是排后面/默认不勾)。

### 2.4 范围一致性为何压过纯频率(关键设计)
**频率高 ≠ 可打包。** 一个能力被用 20 次却横跨"中文SaaS+英文biotech+播客",比一个被用 5 次、语境很紧的能力**更不可打包**——前者上线必崩,后者锐利可靠。所以:
- `scope_coherence` 作为**乘子**压在 overall 上(上式 `·(0.4+0.6·coherence)`):证据语境越杂,分越低,即使频率高。
- `scope_coherence` 低于阈值(如 <0.5)→ 在草稿里标"建议拆分",引导创作者在锚定时 split 成两个锐利能力。
- 这修正了 crune 纯频率加权的盲区(高频低价值/语境杂的"git status"式routine 会被它高估)。

### 2.2 成本
S1 ≈120 + taxonomy ≈8 + 分类 ≈7 ≈ **135 次,一次性**(比 v3 省掉 ×3 共识)。约 $0.02、~120s。confidence/reusability **零 LLM**。

### 2.3 可插拔
`draftEngine(sessionIndex) → DraftCandidate[]` 定为接口。实现可换:`v3-singlepass`(默认)/ `crune-deterministic`(零 LLM 发现层,需移植 + CJK 分词)/ `llm-oneshot`(最省)。

---

## 3. ③ 锚定交互(草稿结构 + 6 操作)

### 3.1 喂给前端的 DraftBundle
```ts
DraftBundle {
  sessionStats,
  candidates: DraftCandidate[],         // 按 reusability 降序
  default_selected: string[]            // 预勾选:confidence==high 的 tempId(收敛,别一次塞 20 个)
}
```
前端一屏:高置信默认勾选并展开;med/low 折叠在"可能还有"区。每张卡:
- 展开 `evidence`(日期·来源色标·标题·项目)——复用已做的回链,**人 5 秒核验**。
- 显示 **`scope` 条**:`验证于:中文 · SaaS路演 · 录音 · 早期`;`scope_coherence` 低的卡打"⚠ 语境较杂,建议拆分"。
- 让创作者**确认或收窄范围**:这是锚定时除"是不是我"之外的**第二问——"这就是你想服务的人群吗?"**

### 3.2 六个操作(输入/输出精确定义)
全部走 `POST /api/anchor-op {id, op}`,纯代码改 `apps[id].anchors`(split 例外):

| 操作 | 输入 | 产出 |
|---|---|---|
| **confirm** | `{type:"confirm", tempId}` | DraftCandidate → 新 CapabilityAnchor(origin=draft,status=confirmed) |
| **rename** | `{type:"rename", capId, name}` | 改 anchor.name |
| **merge** | `{type:"merge", capIds:[...], name}` | 合一个 anchor,evidence 并集去重,slots 并集 |
| **split** | `{type:"split", capId, into:[{name},{name}]}` | **小 LLM**:对该 anchor 的 evidence 会话,只在 2 个新名间重分类 → 2 个 anchor |
| **delete** | `{type:"delete", capId}` | 移除(或标 retired) |
| **add** | `{type:"add", name, intent, sessionPaths?}` | 人手建 anchor(origin=human-added);给了 sessionPaths 则附为 evidence |
| **narrow-scope** | `{type:"narrow-scope", capId, scope}` | 创作者收窄范围(改 anchor.scope,置 scope_confirmed=true);收窄后超出新范围的 evidence 可剔出 |

`POST /api/anchor {id}` 一次性提交整批 triage(前端攒好再发也行),返回最终 `CapabilityAnchor[]`。

### 3.3 split 的实现(唯一带 LLM 的操作)
```
输入:capId + ["名A","名B"];取该 cap 的 evidence 会话的 observation
LLM(一次):把这些 obs 各归到 A 或 B(或都不属)
→ 生成 2 个 anchor,evidence 按归属拆;原 cap 删除
```
便宜(一次调用,只覆盖该 cap 的几段)。

---

## 4. ④ 锚点存储

`apps[id].anchors: CapabilityAnchor[]`,操作即增删改这个数组并 `save()`。
锚点 = **这个创作者的固定 taxonomy**——增量分类(§6)就以它为固定清单。
导出:`GET /api/anchors {id}` 给前端渲染 + 增量回路读。

---

## 5. ⑤ 打包桥(anchor → manifest,复用 M3)

创作者对某个 confirmed anchor 点"打包":
```
POST /api/package {id, capId}
  → 取 anchor {name,intent,slots,evidence,scope}
  → 取 evidence 会话内容(readSessionContent)当上下文
  → LLM(一次,复用 /api/structure 的 structurePrompt 升级版):
       产出 {instructions(含 {answer.X}), questions, output_spec, target_users, tags}
  → distillToManifest(...) → AgenticAppManifest:
       · slots → interaction.required_context
       · scope → agent.boundaries(声明适用边界)+ 范围闸规则
  → anchor.manifest_id 回填;进发布/消费闭环(已有)
```
**只对创作者选中的能力跑**,不是全部 → 成本随意愿走。

### 5.1 生产期范围闸(运行时强制,不是文档摆设)
范围必须在消费时**被执行**,否则上千消费者里的越界输入会让 mini-app **自信地做错**:
- 消费侧 `/api/run` 前先做**轻量范围检查**(规则 + 一次便宜 LLM 判):消费者输入是否落在 `scope` 内(语言/领域/输入类型)。
- **落在内** → 正常跑;**落在外** → 提示"这个能力为【中文SaaS路演】设计,你的输入像【英文biotech】,结果可能不准",可选择继续/换能力。
- **越界输入是信号,回流**:记下越界 case → 攒够同类 → 进 §6 审核队列,作为"扩张该能力范围"或"派生新能力"的提名。**生产边界与增量发现接成一条回路。**

---

## 6. ⑥ 增量分类 + 提名审核(持久价值)

触发:`POST /api/refresh {id}`(导入发现有新会话时,或手动)。

```
1. 找出 sessionIndex 里 createdAt/mtime 晚于 lastRefresh 的新段
2. 对新段跑 S1 精读(LLM,缓存)→ newObs
3. 分类(LLM 单 pass):把 newObs 归到【现有 anchors 固定清单】
   CLASSIFY_PROMPT(anchors, newObs) → {assign:[{ref_id, ids:[capId]}]}
4. 命中 ≥1 anchor → 追加 evidence(去重 by path),更新 from_segments/reusability(确定性)
5. 没命中任何 anchor → 入 novelObs 池
6. novelObs 攒够阈值(默认 ≥3 段成簇)→ 对 novelObs 跑 mini-draft(§2 同管线,小规模)
   → 生成 ReviewItem(proposed_op=ADD / 或 MERGE_INTO 最近 anchor)→ reviewQueue
```

人审:`GET /api/review-queue {id}` → 前端一屏 → `POST /api/review {id, decisions:[{itemId, action:"ADD"|"MERGE_INTO"|"ignore", targetCapId?}]}` → 改 anchors。

**关键**:anchors 只通过 confirm/merge/split/add/review 这些**人审操作**变;增量只往里**加 evidence**或**提名**,从不自动改动能力集 → 数据增长鲁棒性问题不存在。

---

## 7. API 一览(新增/改造)

| 方法 路径 | 作用 | LLM? |
|---|---|---|
| POST `/api/draft` | 跑草稿引擎 → DraftBundle(替代旧 `/api/extract`) | 是(S1+归纳+分类) |
| POST `/api/anchor-op` | 单个 triage 操作(confirm/rename/merge/split/delete/add) | 仅 split |
| POST `/api/anchor` | 批量提交 triage → 最终 anchors | 仅含 split 时 |
| GET `/api/anchors` | 取锚点集 | 否 |
| POST `/api/package` | anchor → manifest → 可发布 | 是(1 次) |
| POST `/api/refresh` | 增量:新段 S1+分类进锚 → evidence/队列 | 是(仅新段) |
| GET `/api/review-queue` | 待审提名 | 否 |
| POST `/api/review` | 审决 ADD/MERGE/ignore | 否 |

发布/消费(`/api/eval` `/api/publish` `/api/run`)不变。

---

## 8. 成本结构

| 时机 | 调用量 | 说明 |
|---|---|---|
| 首次草稿(onboarding) | ~135 次一次性 | S1 大头,缓存后不重复 |
| 锚定 | 0~少量 | 只 split 用 LLM |
| 打包 | 1 次/被选能力 | 按意愿 |
| 增量 refresh | 仅新段 S1 + 1 分类 pass | 日常很小 |
| 提名审 | novel 攒够才 mini-draft | 低频 |

> 主成本在首次 onboarding;之后近乎免费。与 v3"每次重跑全量 $0.066"相比,**增量化把长期成本压到极低**。

---

## 9. 里程碑 + 验收

- **M1 草稿引擎**:`/api/draft` = 单 pass v3 + 确定性 reusability + **scope/scope_coherence** → DraftBundle。验收:120 段出 DraftCandidate[],带 evidence + confidence + **scope 条**,~$0.02。
- **M2 锚定交互**:一屏 triage(7 操作含 narrow-scope + evidence 展开 + scope 确认)→ `apps[id].anchors`。验收:用你真实历史,**<3 分钟**锚出 5-8 个"这是我"且**范围明确**的能力。
- **M3 打包桥**:`/api/package` anchor→manifest(含 boundaries)→发布跑通;**消费侧范围闸**生效。
- **M4 增量**:`/api/refresh` 新段分类进锚 + 追加 evidence;没匹配的入队列;**越界输入回流**。
- **M5 审核**:队列一屏 30 秒审 → anchors 更新。

**验收口径(换了)**:① 锚定耗时<3 分钟;② 确认能力的"这是我"认同率;③ **范围锐利度(scope_coherence)+ 创作者范围认可率**;④ 增量分类人工纠正率;⑤ 生产期越界拦截率。不再用 Jaccard。

---

## 10. 待拍板

1. **草稿引擎 v1**:单 pass v3(默认,复用最快)vs 直接上 crune 确定性(更省但要移植+CJK)。→ 倾向先单 pass v3 跑通体感。
2. **confidence 分档阈值**(overall>0.5=high?)与默认勾选数(~5)→ M2 用真实数据调。
3. **增量触发**:每次导入自动 refresh vs 手动按钮 → 倾向手动起步。
4. **split 是否 v1 就做**:可先只给 confirm/rename/merge/delete/add,split 放 M2.5。→ 倾向 v1 先不做 split。
