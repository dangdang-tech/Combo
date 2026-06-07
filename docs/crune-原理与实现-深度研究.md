# crune 深度研究:原理、实现,以及对我们提取层的启示

> 对象:[github.com/chigichan24/crune](https://github.com/chigichan24/crune)(`npx @chigichan24/crune`)——读 Claude Code 会话日志 → 跨会话知识图 → 复现工作流 → 产 `SKILL.md` 候选。
> 方法:clone 源码通读(`scripts/knowledge-graph/` 17 模块 + 2 份设计文档)。
> 结论先行:**crune 的发现层是纯确定性 ML 流水线,零 LLM、零 embedding API**;LLM 只在最后可选的 skill 合成里出现。这正好直击我们 v3 的痛点(贵、慢、靠共识门兜不确定性)。

---

## 0. 最大的认知:它没有 ML 库

`package.json` 的 deps 只有 `react / chart.js / react-force-graph-2d`——**没有任何 embedding API、没有 LLM SDK、没有 sklearn**。
TF-IDF、Tool-IDF、SVD、凝聚聚类、Louvain 社区、Brandes 中介中心性、可复用评分——**全是纯 TypeScript 从零手写,确定性(seed=42),本地跑完**。
LLM(`claude -p`)只在**最后一步**对 reusability top-N 的 skill 骨架做可选润色。

> 一句话:**发现"有哪些可复用能力"不用 LLM;只有"把某个能力写成漂亮的 SKILL.md"才用 LLM。** 这与我们 v3"全程 LLM"是相反的取舍。

---

## 1. 8 步流水线(原理)

```
特征提取(3 路,各自 L2)→ 加权拼接 → Truncated SVD → 凝聚聚类 → 主题节点 → 复合信号建边 → Louvain 社区 → Brandes 桥接
```

### Step 1 · 特征提取(三路信号 —— 这是关键,远不止文本)
| 路 | 内容 | 公式 |
|---|---|---|
| **1a TF-IDF 文本** | user prompt + assistant 文本 + **编辑的文件路径** + git branch,分词 | `tf=log(1+count)`,`idf=log(N/df)`,词表过滤(≥2 文档且 ≤80% 文档),L2 |
| **1b Tool-IDF 工具** | 每段(含子 agent)的**工具调用直方图**,用 IDF 压常见工具 | `weight=log(1+count)·idf(tool)`,L2 |
| **1c 结构 7 维** | 会话的"形状" | userRatio / assistantRatio / toolCallRatio / subagentRatio / avgToolsPerTurn / **editHeaviness**(Edit+Write 占比)/ **readHeaviness**(Read+Grep+Glob 占比),L2 |

> 分词器做了 CamelCase/snake/kebab 拆分、**文件路径分段**、日英停用词、剔除 UUID/十六进制/长 token。

### Step 2 · 加权拼接 + Truncated SVD
- 拼接:`row = [√0.5·TFIDF, √0.25·ToolIDF, √0.25·结构]`(用 √ 权重让拼接后 cosine 的贡献正好是 50:25:25)。
- SVD:利用"会话数 m ≪ 特征数 n",走 **Gram 矩阵 G=A·Aᵀ(m×m)→ power iteration+deflation(50 次,seed=42)** 取前 k 个特征向量。`k=min(80,max(20,⌊m/4⌋))`。
- 输出:`U·Σ` L2 归一化 → **k 维稠密潜空间**。文本与工具的交叉信号在这里自然成轴。

### Step 3 · 凝聚聚类(average linkage + 自动 elbow)
- 在 SVD 空间算 cosine 距离矩阵 → average-linkage 凝聚,记录 merge 距离历史。
- **Elbow 自动定阈**:merge 距离的**二阶差分(加速度)最大点**为阈值,fallback 0.7,clamp [0.3,0.9]。
- **超大簇拆分**:>25%(且≥10)的簇,用其内部距离中位数×0.8 更严阈值再聚。
- **过窄簇合并**(有 facets 时):≤2 段的簇,若 goal 类别(归一到 ~10 类)有交集且平均距离<0.7 则并(并后≤8)。

### Step 4 · 主题节点
每簇产:keywords(TF-IDF 质心 top5)、label(facets 的 underlying_goal 或 top3 关键词+项目)、representative prompts(离质心最近的 user prompt top3)、suggested prompt(主导动词+关键词+工具)、tool signature、dominant role(subagent>15%→委派 / tool>60%→工具重 / else→用户驱动)。

### Step 5 · 复合信号建边
`strength = 0.4·语义(SVD 质心 cosine) + 0.3·文件重叠(编辑文件集合 Jaccard) + 0.3·会话邻近(同项目同 branch=0.6 / 1h 内=0.4)`,阈值 >0.2。边分类:cross-project-bridge / shared-module / workflow-continuation / semantic-similarity。

### Step 6-7 · Louvain 社区 + Brandes 中介中心性
社区=modularity 最大化;桥接 topic = betweenness 前 10%(跨知识域的连接点)。

---

## 2. "什么值得打包" —— 可复用评分(reusability.ts)

每个 topic 一个 `[0,1]` 加权分(**纯算,无 LLM**):

```
无 facets:  0.35·频率 + 0.25·耗时 + 0.25·跨项目 + 0.15·新近
有 facets:  0.30·频率 + 0.20·耗时 + 0.20·跨项目 + 0.10·新近 + 0.10·成功率 + 0.10·有用度
  频率   = sessionCount / max
  耗时   = avgDuration / max          (单次越久,自动化收益越大)
  跨项目 = (projectCount-1)/(max-1)   (跨项目=更通用)
  新近   = 1 - daysSinceLastSeen/max
  成功率 = facets.outcome ∈ {fully,mostly}_achieved 占比
  有用度 = claude_helpfulness 数值化均值
```

→ top-N(默认 5)进 LLM 合成。**"复现/价值"全是算出来的可解释信号,不是 LLM 估的。**

---

## 3. skill 合成(唯一用 LLM 的地方,且可选)

- **Step 2 启发式骨架**(无 LLM):按 anthropics/skills 格式生成 SKILL.md —— name(top3 关键词+项目,kebab,≤40 字)、description(skill-creator 的 "pushiness" 触发描述)、Overview/When-to-Use/Workflow/Detected Patterns(`Read→Edit→Bash — 12 occurrences`)/Guidelines。
- **Step 3 LLM 润色**(`claude -p`,可 `--skip-synthesize` / `--synthesize-model haiku`):喂 topic 信息+代表 prompt+工具签名+工具流+(按需)图位置/连接 topic/facets → 出精修 SKILL.md。`stripSynthesisPreamble()` 去除前言;`--no-session-persistence` 防污染。

---

## 4. crune 比我们 v3 聪明在哪(直击不稳定)

| 维度 | 我们 v3(锚定 taxonomy) | crune | 启示 |
|---|---|---|---|
| **稳定性** | LLM 全程,非确定性 → 靠"锚定+共识门 Jaccard"兜 | **seed=42 确定性,同输入→同结果**,稳定是**构造出来的**,根本不需要 Jaccard 门 | 稳定最干净的来源是确定性算法,不是给 LLM 加约束 |
| **分组信号** | **只读 user 文本**(readSessionContent) | 文本 **+ 工具调用序列 + 编辑文件重叠 + 结构形状** | **我们丢掉了最有判别力的信号**。"同一种活"在工具序列/文件上比文本上更像 |
| **成本** | $0.066、149 次 LLM/次 | 发现层 **$0**,仅 top-5 合成用 LLM | 便宜一个量级 |
| **复现度** | 分类计数(已算出) | 簇大小+跨项目+耗时,加权可复用分 | 一致:证据可算,但 crune 维度更全(耗时/成功/有用) |
| **可解释** | evidence 段回链 | 每条边/簇/分都有公式与来源 | 更白盒 |

**核心顿悟(它解开了我之前 v1↔v3 的纠结)**:
我当初否掉 embedding 是说"**文本**相似度≠能力等价"。crune 的回答是——**别只用文本聚**。它用"工具序列+文件重叠+结构+文本"的多信号潜空间聚类,这恰恰捕捉"同一种工作",而且**确定性**。所以 crune 比我们的 v1(纯文本 embedding)和 v3(LLM 全程)**都强**:既有能力判别力,又稳、又便宜。

---

## 5. crune ≠ 我们的需求(诚实的差距)

1. **产物不同**:crune 出 **开发者自用的 Claude Code SKILL.md**;我们要 **给小白消费者的 mini-app**(带 `{answer.X}` 槽、manifest)。crune 的"发现+评分"可借,"合成"那层目标不一样,要换成我们的 M3 manifest。
2. **依赖 Claude 富日志**:它的强信号(工具调用、编辑文件、git branch、subagent)来自 Claude Code 的结构化 JSONL。我们多源里 **codex/opencode 的工具/文件信号较弱**,这些源会退化到文本为主(仍能跑,判别力下降)。
3. **中文**:分词器是日英停用词;我们历史中文重,需要补 CJK 分词(否则中文 token 化差)。
4. **一段一点**:crune 也是"一段会话=一个点",同样**不解决"一段含多个能力"**(我们 Phase 2 的关切)。
5. **facets 来自它自己的 `/insights`**:成功率/有用度信号依赖它的 facets 产物;我们要么自己造(从 success_signal),要么先用 4 信号版。

---

## 6. 建议:crune 式 v4(确定性发现 + LLM 只做命名/打包)

把 v3 的"LLM 全程"换成 crune 的骨架,只在最后用 LLM:

```
S1 解析每段(本机,无 LLM):抽 工具直方图 + 编辑文件 + 结构比率 + 文本
 → 三路特征(TF-IDF文本 + Tool-IDF + 结构7维,CJK 分词)
 → √加权拼接 → Truncated SVD(seed 固定)→ 稠密潜空间
 → average-linkage 凝聚聚类 + elbow(确定性 → 稳定免门)
 → 每簇:可复用分(频率/耗时/跨项目/新近[/成功/有用])
 → top-N 簇 → 【唯一 LLM 步】命名 + 写 manifest + 抽 {answer.X} 槽(我们的 M3)
 → evidence = 簇成员会话(天然回链)
```

收益:**稳定(构造确定性,Jaccard 恒 1)+ 便宜(发现层 0 LLM)+ 判别力(工具/文件信号)+ 可解释**。同时保留我们的差异点(消费者 mini-app + 槽位)。

代价/工作量:
- 解析器要从多源日志抽**工具调用 + 编辑文件 + 结构比率**(Claude 全、codex 中、opencode 弱)。
- 手写 **TF-IDF / Tool-IDF / 结构向量 / Gram-SVD / 凝聚聚类 / 可复用分**(可直接移植 crune 的 TS,~1500 行,无外部依赖)。
- 补 **CJK 分词**。
- 最后一步换成我们的 **manifest + 槽位** 合成(复用 distill-to-manifest)。

> 风险:非 Claude 源信号弱时,聚类质量退化——可对这些源加重文本权重,或先只对 Claude 源上 crune 式、其余源继续 v3。两条路可并存,按源选。

---

## 7. 一句话给你

crune 证明了:**"发现有哪些可复用能力"是个确定性的数据挖掘问题(多信号特征→SVD→聚类→加权分),不该交给 LLM**;LLM 只配做最后的"起名+写文档"。这比我们 v3 又稳又便宜又可解释,还顺手用上了我们一直丢掉的**工具序列/文件改动**信号。建议照它的骨架做 v4,把最后一步换成我们的消费者 mini-app manifest。
