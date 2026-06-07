# Raw Data → 可提取能力:研究与改造方案

> 关于 Agora 最小闭环里「① 导入 raw data → ② 提取可打包能力」这一层的文献调研、现有项目对标,以及对我们当前实现的差距分析 + 分阶段改造方案。
> 这层是项目命脉(Pi 对 raw data 的阅读与提取),本文是它的设计依据。
> 调研日期:2026-06。

---

## 0. 一句话结论

领域已有**收敛的标准做法**,且有一个**几乎同款的现成开源项目(crune)**。核心共识:

> **用经典挖掘算法拿「证据」(复现/频率是算出来的),用 LLM 做「抽象」(命名/参数化/打包)。LLM 不该负责判断「是否反复出现」。**

我们当前实现让 LLM 既当裁判又当抽象器(`from_segments` 是估的),正是文献指出最该补的缺口。

---

## 1. 标准配方(领域共识的 pipeline)

```
原始日志
 → ① 分段 Segmentation   长会话切成「任务实例」(会话/话题/工具簇/时间间隔为界)
 → ② 归一 Canonicalize   每个动作/工具调用归成小动作词表(便宜 LLM 跑一次)
 → ③ 聚类 Cluster        facet embedding + k-means / 层次聚类 → 候选簇
 → ④ 算证据 Evidence     簇内支持度 + 跨项目 + 成功率 + 耗时 → 加权可复用分
 → ⑤ LLM 抽象 Abstract   只对过线的簇:命名 + 参数化(固定 vs 槽位)+ 出 manifest
 → ⑥ 增量库 Maintain     ADD/UPDATE/DELETE/NOOP 维护,复现即升 confidence
```

---

## 2. 关键文献与项目(按相关度)

### 2.1 最近的"近亲":crune ⭐
- **链接**:[github.com/chigichan24/crune](https://github.com/chigichan24/crune) · [原理文](https://dev.to/chigichan24/mining-hidden-skills-from-claude-code-session-logs-with-semantic-knowledge-graphs-2em8) · 跑:`npx @chigichan24/crune --dry-run`
- **做什么**:读 Claude Code 的 JSONL 日志 → 跨会话语义知识图 → 检测复现工作流 → 直接产出 `SKILL.md` 候选(Claude Code 技能格式)。**几乎就是我们这层的可运行原型。**
- **机制**:每段会话抽 3 路特征(TF-IDF 文本 50% + 工具使用 IDF 加权 25% + 7 维结构向量 25%)→ Truncated SVD → 凝聚聚类(余弦,elbow 定阈值)→ 主题节点;边 = `0.4 语义 + 0.3 文件重叠 + 0.3 会话邻近`;Louvain 社区 + 介数找桥接主题。
- **晋升 = 加权可复用分**(非硬阈值):**频率 0.30 / 耗时 0.20 / 跨项目 0.20 / 新近 0.10 / 成功率 0.10 / 有用度 0.10**。Top-N(默认 5)做合成。
- **合成**:启发式 SKILL.md 骨架(名/触发描述/由工具序列推出的步骤)→ 可选 `claude -p` 精修。
- **对我们**:① 抄它的**多信号加权分**当晋升门(尤其奖励"跨项目 + 耗时大",= 高价值可复用);② 骨架用**工具调用序列**而非纯文本;③ 它**没用硬性"重复 N 次"**——频率只是一路权重,避免漏掉高价值低频项。
- **注意**:单作者早期项目,只支持 Claude Code JSONL。我们要扩 Codex / opencode 解析(我们已有多源解析,可反哺)。

### 2.2 对话日志→使用模式:Clio(Anthropic)
- **链接**:[arXiv 2412.13678](https://arxiv.org/abs/2412.13678) · [博客](https://www.anthropic.com/research/clio) · 开源复刻 [OpenClio](https://github.com/Phylliida/OpenClio)
- **管线**(混合,embed+cluster 然后 LLM):per-conversation **facet 抽取**(摘要/主题/任务/轮数,便宜模型)→ 对 NL facet **embedding**(all-mpnet-base-v2)→ **k-means** 出数千基簇 → LLM 读**簇样本**写标题摘要 → 自底向上**建层级**(质心 embedding + LLM 提父类)。
- **规模技巧**:便宜模型碰每段,贵模型只碰簇样本。19k 合成基准上 94% 主题分布准确。
- **隐私四层**:摘要抽象 → 最小聚合阈值(账户数 & 对话数)→ 簇摘要擦洗 → LLM 审计删可识别簇。
- **对我们**:**这是我们该走的主干**。但注意我们是**单用户**,失去跨人 k-匿名安全网 → 抽象+擦洗层更要做。

### 2.3 轨迹→可复用 workflow:AWM(Agent Workflow Memory)
- **链接**:[arXiv 2409.07429](https://arxiv.org/abs/2409.07429)。Mind2Web +24.6%,WebArena +51.1%。
- **方法**:从 agent 轨迹**用 LLM 归纳**常复用 routine,注回 memory。离线(先从语料归纳)/ 在线(边测边归纳)。
- **什么算 workflow**:≥2 步;跨多任务的重复动作子集;**把用户特定值(搜索词/按钮名)换成命名变量** → 一次性轨迹变参数化 routine。**避免相似/重叠 workflow。**
- **机制**:不聚类不计频,**多段拼进归纳 prompt 让 LLM 抽**;在线模式只对**预测成功**的轨迹归纳。
- **对我们**:最贴近"能力 = 带槽位的可复用流程"。那个**命名变量就是 mini-app 的输入槽**。我们 `{answer.X}` 机制正好对上。

### 2.4 技能库 + 晋升门:Voyager
- **链接**:[arXiv 2305.16291](https://arxiv.org/abs/2305.16291) · [code](https://github.com/MineDojo/Voyager)
- **关键**:① 程序**成功 + 自验证**才晋升为技能;② 存 `{code, description, embedding}`,**检索键 = LLM 写的描述的 embedding**,不是原文;Chroma 向量库,description 相似度 top-k 取回。
- **对我们**:① 候选要有**成功证据**才晋升(对话里:用户说"完美"、产物被用、无后续纠正);② **索引用"这干嘛"的描述**做 embedding,利于跨库去重/检索。

### 2.5 经验库增量维护:mem0 / ExpeL / AutoManual
- **mem0** [arXiv 2504.19413](https://arxiv.org/abs/2504.19413):两段式,候选 fact embedding 比对 top-s 已有记忆,**LLM 用工具调用选 ADD/UPDATE/DELETE/NOOP**。把"新增/精修/去重"交给 LLM 而非脆弱 if-else。
- **ExpeL** [arXiv 2308.10144](https://arxiv.org/abs/2308.10144):insight 用 **ADD/EDIT/UPVOTE/DOWNVOTE** 维护(带重要度计数,弱的剪掉);**对比抽取**(同任务失败 vs 成功轨迹的 diff = 可复用流程)。
- **AutoManual** [arXiv 2405.16247](https://arxiv.org/abs/2405.16247):**分类型规则**(成功流程/纠错/有用事实)+ 最后"编译成手册"。
- **对我们**:① ADD/UPDATE/DELETE/NOOP 是**成长型能力库**的正确数据模型(新会话进来不必从头重抽,复现即升 confidence + 天然去重);② **对比抽取**在对话里是金矿——用户可见地重试,被弃尝试 vs 最终采纳答案的 diff 就是可复用流程。

### 2.6 "复现是算出来的":process / task mining
- **task mining / RPA**(UiPath、Power Automate;[arXiv 2008.05782](https://arxiv.org/pdf/2008.05782)、[2510.08118](https://arxiv.org/pdf/2510.08118)):从未分段 UI 日志**分段→挖频繁动作模式→支持度阈值过门**;推荐 = 频率 × 可自动化性(是否映射到已有连接器)。
- **process mining**(van der Aalst,Alpha/Heuristic/Inductive Miner;[p1330](https://vdaalst.com/publications/p1330.pdf)):**case→trace→variant→频率**;**dependency measure** `(|a>b|−|b>a|)/(|a>b|+|b>a|+1)` 判 A→B 是稳定方向还是巧合;DFG 频率过滤去噪。
- **PbD / 归纳编程**(SMARTedit version-space;FlashFill):**循环归纳**(你做了 3 遍 → for-each);保留**多个候选泛化**按简洁度×覆盖度排名,不早早 commit。
- **SE-Agent Trajectories** [arXiv 2506.18824](https://arxiv.org/html/2506.18824):工具调用**归一成~8 动作词** → 挖 **n-gram(n=4)频率** → 比成功/失败分布。可直接落地的蓝图。
- **对我们**:把"复现"做成**可计算、可点开回链的证据**,而非 LLM 估的数字。两因子门:**支持度阈值 × 可打包性**。最难也最值钱的子问题是**分段**——先解决再计数。

### 2.7 其它可借鉴维度
- **Anthropic Economic Index** [arXiv 2503.04761](https://arxiv.org/html/2503.04761):映射到 O*NET 大本体用**层级 top-down 分类**(便宜模型逐层下钻);**augment vs automate** 轴——哪些能力适合做成自主 mini-app。
- **OpenAI「How People Use ChatGPT」**:**Asking / Doing / Expressing** 意图三分;"Doing" 类正是能做成 app 的能力。
- **GoalEx** [arXiv 2305.13749](https://arxiv.org/abs/2305.13749):**目标驱动聚类**——把"找可打包能力"这个目标 baked 进聚类/标注 prompt,得到能力簇而非话题簇。
- **Dial-In LLM** [arXiv 2412.09049](https://arxiv.org/html/2412.09049):**LLM-in-the-loop** 精修聚类——判簇好坏、重聚坏簇、用 **Action-Objective** 命名("summarize-email")再按标签合并。量化收益:NMI 0.82→0.88,下游分类 +12pt。Action-Objective 标签基本就是能力候选。

---

## 3. 当前实现 vs 标准配方:差距

| 阶段 | 标准配方 | 我们现在 | 差距 |
|---|---|---|---|
| ① 分段 | 切任务实例 | 无(整段会话为单位) | **缺**。一段会话常含多个能力 |
| ② 归一 | 动作词表 | 无 | 缺 |
| ③ 聚类 | embedding + k-means | 无(agent 读样本) | **缺**。复现靠 agent 眼力 |
| ④ 算证据 | 支持度/成功率加权分 | `from_segments` 由 LLM 估 | **缺**。不可验证 |
| ⑤ LLM 抽象 | 对过线簇命名/参数化 | ✅ agent 直接出候选 | 有(但缺前置过滤) |
| ⑥ 增量库 | ADD/UPDATE/DELETE/NOOP | 无(每次从头抽) | 缺 |

**现状定性**:做了 ⑤,缺 ①③④⑥。优点是简单、召回还行;代价正是精度全靠模型——`from_segments` 不可验证、可能漏可能虚高。

---

## 4. 改造方案(分阶段,适配"单用户/几百段"场景)

> 不照搬 Clio/process-mining 全套(那是百万对话/跨用户)。单用户几百段,挑性价比最高的补。

### Phase 1 — 加聚类证据层(性价比最高)
- 每段抽 facet(便宜模型,一句"这段在干嘛的任务陈述",GoalEx 目标导向)。
- facet embedding + k-means/层次聚类 → 候选簇。
- 簇内算**支持度 + 跨项目 + 新近**加权分(crune 思路)。
- agent 不再盲挑:**按簇定向 `read_session`**,`from_segments` 落成**真实回链**(可点开"它来自这 N 段")。
- 产出:`from_segments` 从估计值 → 可验证证据;召回 + 精度都更稳。

### Phase 2 — 成功门控 + 对比抽取
- 检测成功信号(用户"完美/就这样"、产物被采用、无后续纠正)→ 只晋升有证据的候选(Voyager)。
- 对比抽取:被弃尝试 vs 最终采纳答案的 diff(ExpeL)。

### Phase 3 — 成长型能力库
- ADD/UPDATE/DELETE/NOOP 维护(mem0):新会话进来增量更新,复现即升 confidence,天然去重。
- 索引用 LLM 描述 embedding(Voyager),跨能力去重/检索。

### Phase 4(可选)— 参数化与打包对齐
- AWM 式:把用户特定值换成命名变量 → 直接对上我们的 `{answer.X}` 槽。
- 分类型(流程/事实/纠错,AutoManual)→ 映射 manifest 的 instructions / 触发条件。

---

## 5. 隐私(单用户场景特别注意)

读的是用户自己的私密历史,**没有跨人 k-匿名安全网**,所以 Clio 的:
- **摘要抽象**(不把原文带出本机)、
- **敏感信息擦洗**、
- **LLM 审计**(删含可识别信息的簇)

反而**更要做**。我们已有"raw data 仅你可见"的定位,工程上要兑现到抽取链路。

---

## 6. 一句话给团队

> 把这层从「agent 眼力好」升级成「**统计打底 + agent 提炼**」:经典挖掘出证据,LLM 只负责命名、参数化、打包。`crune` 是最近的可运行对标,Clio 是主干范式,AWM 给参数化,Voyager 给成功门控,mem0/ExpeL 给成长库,process-mining 给"复现可计算"。先做 Phase 1(聚类证据层),`from_segments` 从估计变回链,收益最直接。
