# Raw→能力提取层 · 技术方案 v3(锚定 taxonomy · 实测驱动)

> 目标:把「用户历史」**稳定、可验证**地映射成「能力候选」——项目根基。
> 关联代码:`~/Desktop/Agora/code/mvp/`(`loop-server.mjs` 提取管线 / `pi-exec.mjs` 的 `run`/`log` / `diag.mjs` 诊断探针)。
>
> **演进史(每次转向都有依据)**:
> - **v1 · embedding 聚类为主**:成本驱动。问题:embedding 相似度≠能力等价。
> - **v2 · LLM 自由抽取 + 共识**:不计成本下,分组是推理不是相似度。**实测 Jaccard=0.083,不稳定。**
> - **v3 · 锚定 taxonomy(本版,已验收)**:控制实验定位到不稳定主因是「自由命名漂移」,改为"建一次固定清单 → 后续只分类计数"。**anchor 探针 0.737 → 全量真实历史 120×3 实测 Jaccard 0.852 PASS,12 个准确能力。**

---

## 1. 实测诊断:v2 为什么不稳(控制实验)

用 `diag.mjs`(20 段合成语料,人为植入 4 个真能力各 5 段)跑控制实验,隔离不稳定来源:

| 探针 | 做什么 | Jaccard | recall | 结论 |
|---|---|---|---|---|
| `temp` | 同输入 temp=0 vs temp=1 | 0.033 / 0 | 3/4 | **不是 API/温度**:压到 0 几乎无改善 |
| `repeat` | 同输入 temp=0 重复 5 次 | 0.063 | 恒 3/4 | 纯采样方差很小;能力每次都找到 |
| `order` | 打乱输入顺序 5 次 | 0 | 恒 3/4 | 顺序不致漏抽;churn 全在命名 |
| `grain` | 粗 vs 细粒度 | 0.011 / 0.011 | 恒 3/4 | **不是粒度** |
| **`anchor`** | **固定清单→只分类** | **0.737** | — | **修法有效** |

**铁证结论**:所有探针 **recall 恒 3/4** → 底层能力每轮都被找到;不稳定**纯粹来自"同一能力每轮被赋予不同名字/粒度",导致跨轮对齐失败、Jaccard 塌**。不是 API、不是采样、不是粒度,是**自由命名漂移**。锚定固定 taxonomy 后 Jaccard 直接抬到 0.737,证明修法对路。

> 方法论印证了之前那条原则:**生成/命名是高方差(多种合理答案),分类是低方差(每个东西基本只有一个归属)。** 把方差敏感的"命名/划分"只做一次,重复/度量的活儿改成"分类"。

---

## 2. v3 架构(锚定 taxonomy)

```
sessionIndex[N]
   │
[S1] 全量精读(并行,缓存,temp=0)           每段 → 结构化「能力观察」{goal,steps,inputs,artifact,success_signal}
   │  obs[N]
   ▼
[T ] 建一次固定 taxonomy(命名只发生这一次)   批内归纳(细粒度)→ 全局合并(12-20 个具体能力)→ 赋 id t0..tn
   │  T = [{id,name,slug,tagline,role,type,steps,slots}]
   ▼
[C ] K 轮分类(命名零漂移,只把 id 打到观察上)  每轮:打乱批次 → 把每段 obs 归到 T 的 0~多个 id
   │  hits[K] = Map(tid → Set(obsIdx))
   ▼
[J ] 确定性 Jaccard + 多数票 + 合并证据
        present[k] = {tid : 支持≥minSupport}        ← 对固定 tid 集合,无 LLM 噪声
        Jaccard = 两两 present 的交并均值
        最终候选 = 多数轮命中的 tid,evidence = 各轮分到的观察并集(真实回链)
```

**与 v2 的关键差异**:① 命名/划分从"每轮自由做"→"一次性做";② 后续轮从"重新归纳"→"分类"(低方差);③ 稳定性度量从"S5 的 LLM 语义对齐"→"固定 tid 集合的确定性 Jaccard"(去掉第二重噪声);④ 全链 temperature=0;⑤ 删掉 S4(分类本身即 grounding)。

---

## 3. 实现细节(对照 `loop-server.mjs` 实际函数)

### 3.1 入口与参数
`runExtraction(a, { rounds=3, sampleN=120, minSupport=2 })`,由 `POST /api/extract` 调用(`{id, rounds?, sampleN?}`)。
- `rounds`:分类轮数(共识用)。K=3。
- `sampleN`:取 `sessionIndex` 前 N 段(按消息数降序)。
- `minSupport`:一个能力在某轮算"出现",需 ≥minSupport 段观察被分到它(滤掉单段抖动,稳定 present 集合)。

### 3.2 S1 全量精读 —— `pool(idx, 8, …)` + `S1_PROMPT`
- `readSessionContent(s, 4000)` 按 source 取真实用户消息(claude/codex/opencode 分发)。
- `run({label:'S1#i', temperature:0, …})` → `{goal,steps,inputs_user_gave,artifact,success_signal}`。
- 并发 8;失败的段 `null` 过滤;结果 `obs[]` 缓存(命名/分类都基于它,不重读)。
- `success_signal` 为 Phase 2 成功门控埋点。

### 3.3 建 taxonomy —— `buildTaxonomy(obs, meter)`
- **固定顺序**(不 shuffle)切 18/批 → `pool(.,4,.)` 跑 `TAX_S2_PROMPT`(批内归纳**细粒度**能力,不带 ref_ids)。
- 汇总局部候选 → 一次 `TAX_S3_PROMPT` 合并成 **12-20 个具体能力**(prompt 明令"严禁塌成 2-3 个大桶")。
- 赋稳定 id:`t0,t1,…` → `T=[{id,name,slug,tagline,role,type,steps,slots}]`。
- **命名只在这里发生一次** —— 这是稳定性的来源。

### 3.4 K 轮分类 —— `classifyRound(obs, T, k, meter)`
- `seededShuffle([...keys], k+1)` 打乱(仅做扰动/负载,**不影响命名**,因已锚定)→ 18/批 → `pool(.,4,.)` 跑 `CLASSIFY_PROMPT`。
- `CLASSIFY_PROMPT`:给定**固定清单 T**,要求"只能引用 id,不许新建/改名",为每段标注它**确实体现**的 id(可 0~多个),从严。
- 输出 `{assign:[{ref_id, ids:[...]}]}` → 回填成 `Map(tid → Set(obsGlobalIdx))`,只认 T 里存在的 id。

### 3.5 度量与汇总(纯 JS,确定性)
- `present[k] = {tid : |hits[k].get(tid)| ≥ minSupport}`。
- `Jaccard(present[i],present[j]) = |∩|/|∪|`,三对均值;`gate = jaccard≥0.8 ? PASS : FAIL`。**纯集合运算,无 LLM**。
- 多数票:`maj = ceil((rounds+1)/2)`(K3→2,K5→3);`seen = present 命中该 tid 的轮数`。
- 每个 tid:`evidence = 各轮分到它的观察并集`(按 path 去重)→ `from_segments = evidence.length`,`confidence = seen≥rounds?高:seen≥maj?中:低`。
- `seen≥maj && evidence≥minSupport` → `stable`,否则 `unstable`;空命中的 tid 丢弃。

### 3.6 计量(每次任务的耗时/token/成本)
- `pi-exec.run()` 返回 `{text, usage:{input,output,total,cost}, ms}`,每次调用打 `✓ Xs · Ntok $cost`。
- `newMeter()`/`meterAdd()` 累加;`runExtraction` 末尾出 `metrics = {sec, calls, tokens, input, output, cost, model, observations}`。
- `stability = {rounds, jaccard, gate, pairwise[], taxonomy_size}`。
- 返回 `{candidates, unstable, stability, metrics, taxonomy}`,存 `apps[id].extraction`。

### 3.7 温度控制
- `run({temperature})` 透传到 `complete(m, ctx, {apiKey, temperature})`(pi-ai 的 `StreamOptions.temperature`)。
- **提取链全部显式 temp=0**(S1/TAX/CLS);生成型步骤(structure/eval/consume run)保持 provider 默认(不传)→ 行为不变。

### 3.8 关键 prompt(已落地)
- `S1_PROMPT(s,body)` → 能力观察 JSON。
- `TAX_S2_PROMPT(items)` → 细粒度能力(无 ref_ids)。
- `TAX_S3_PROMPT(cands)` → 12-20 个去重具体能力。
- `CLASSIFY_PROMPT(T,items)` → `{assign:[{ref_id,ids}]}`,锚定不许改名。
- (已删:v2 的 `S4_PROMPT` 对抗验证、`S5_PROMPT` 语义对齐 —— 分类即 grounding,确定性度量替代对齐。)

---

## 4. 硬验收(根基达标线)

| # | 项 | 度量 | 阈值 |
|---|---|---|---|
| **V1 稳定性** | 同历史 3 轮分类的能力集重叠 | 确定性 Jaccard(固定 tid 集合) | **≥ 0.80** |
| V2 证据真实 | from_segments = 被分类命中的真实段数 | evidence 段确实体现该能力 | 分类即核验 |
| V3 证据稳定 | 同能力跨轮 evidence 段集合 | 段集合 Jaccard | ≥ 0.7 |
| V4 无空壳 | 候选必须有命中证据 | 空命中 tid | 已自动丢弃 |

- 验收口径明确:`stability.gate == "PASS"` 即 V1 达标。
- 固化为 `diag.mjs`(合成语料控制实验)+ `/api/extract` 真实历史回归。

---

## 5. 降级 / 隐私 / 成本

- **降级**:`runExtraction` 抛错 → `/api/extract` 落到"标题摘要单次补全",永不 500。粘贴态无 sessionIndex 同样走单次。
- **隐私**:S1 读文件在本机;经 OpenRouter 的只有 prompt。单用户无 k-匿名,Phase 2 可加摘要抽象/擦洗。
- **成本(K=3,N=120,实测量级)**:S1≈120 次 + TAX≈8 次 + 分类≈3×7 次 ≈ **150 次调用**。DeepSeek v4 pro 偏慢(合并步单次可达 ~46s),整任务数分钟级。`metrics` 实时可见。比 v2 省掉了 S4(候选×K 次)。

---

## 6. 里程碑与状态

- ✅ **M1** S1 精读(并发、temp=0、缓存)
- ✅ **M2** buildTaxonomy(细粒度 12-20)
- ✅ **M3** classifyRound(锚定分类)
- ✅ **M4** 确定性 Jaccard + 多数票 + 证据并集
- ✅ **M5** 计量(耗时/token/成本)+ 模型 DeepSeek v4 pro
- ✅ **M6 验收(通过)**:全量真实历史 120 段 × 3 轮(DeepSeek v4 pro):
  - **Jaccard 0.852 · gate PASS**(pairwise [0.79, 0.92, 0.85]),taxonomy 20 个。
  - 稳定 12 / 待定 8;耗时 256s · 149 次调用 · 120.6k tok · **$0.066**。
  - 稳定能力准确命中真实主线:生成式UI调研(22段·3轮)/ PRD驱动AI开发(14)/ GitHub测试修复(13)/ AI系统规划(10)/ Agent平台设计(10)/ 投资人复盘(2·3轮)…
  - 待定 8 个正确为一次性/低支持(seen 0-1、from_segments 1):租房数据/PH发布/AWS配置等,未被提升。
  - 对比 v2 同口径:Jaccard 0.083 FAIL、仅 1 个"技术调研"大桶 → v3 修复有效。
- ⏳ **M7** 前端:候选卡 evidence 展开 + 顶部 `稳定性 Jaccard` 条;unstable 进"待定"区。

---

## 7. 风险与未决

- **Jaccard 仍 <0.8**:anchor 探针是 0.737,要冲 0.8 的杠杆——① 调 `minSupport`(↑ 稳但漏小能力);② taxonomy 更细更正交(改 TAX_S3 prompt);③ 分类 prompt 收紧"确实体现"判据。按 M6 实测调。
- **taxonomy 本身的质量依赖第 1 次**:建清单这一次若偏,全程跟着偏。可对 taxonomy 也跑 2 次取交集做"清单稳定性"二阶校验(Phase 1.5)。
- **一段多能力**:分类已支持一段归多个 id;但"段内分段(一段含多个任务实例)"仍未做 → Phase 2。
- **增量**:新会话进来只需 S1 增量 + 重跑分类(taxonomy 可复用/增补)→ Phase 3 成长库。
