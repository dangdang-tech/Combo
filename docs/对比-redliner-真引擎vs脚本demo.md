# 对比:合同红线审阅(redliner)— 同事脚本版 vs 我们的真引擎版

同一个 surface(贴条款 → 出逐条红线清单),两种内核。这篇说清楚:把它接到**真引擎**多了什么、代价是什么。

参照物:同事手搓的 demo(`github dionysu31-hub/agora-demo` 的 `app-redliner`)是 **No-LLM 脚本** —— 正则匹配意图 + 模板拼装输出。看着像、跑得快,但里面没有判断。

我们的版本:`experiments/redliner.html` + `experiments/fixtures/experience-redliner.json`,跑在 `experiments/engine.mjs`(`stance=collaborator`)上,brain 走真 LLM(`brain-pi.mjs` / OpenRouter)。

---

## 一句话差异

> 脚本 demo 是**把规则硬编码进代码**;我们是**把某个人(林姐)的红线判断力做成可复用、可追溯、可手改、可迁移的经验体**,让一个真 agent 据此判断。

---

## 同一 surface,真引擎多了什么

| 维度 | 同事脚本版(No-LLM) | 我们真引擎版(经验体 + LLM) |
| --- | --- | --- |
| **判断来源** | 正则命中关键词 → 套预设模板。条款没踩中关键词就漏判,改写措辞就绕过 | 真 LLM 站在「林姐」的品味/守则/案例上**做判断**,能处理没见过的措辞和组合条款 |
| **经验可追溯** | 输出是模板,说不清「为什么标红」 | 每条红线带 `citedBlockIds`(命中的守则/案例,如 `g1 无上限赔偿一票标红`)+ 可折叠的 `why`(为什么这么判断一句话)。点开就看见判断链 |
| **优先级/仲裁** | if-else 顺序写死,冲突靠人改代码 | 守则带 `priority`,`compileSystemPrompt` 按优先级升序进 prompt,高优先级压过 taste(如 `g1` 一票否决压一切) |
| **有环手改** | 不能改,或改了就脱离逻辑(纯前端覆盖) | 改任意一条 → `pin`(锁定·agent 不再覆盖)/ `continue`(锁定并让 agent 据此把其余条款顺一遍)。`locked-by-origin` 保证迟到的 agent 输出**永远盖不过你拍板的格** |
| **可迁移** | 换个领域要重写整套正则 + 模板 | **换 JSON 即换垂直**:`engine.mjs` 一行不改,`experience-redliner.json` ↔ `experience-career.json` 自由切换。同一引擎已驱动「职业取舍」和「合同红线」两个完全不同的 mini-app |
| **换 stance** | 没有这个概念 | 同一份经验,换 `stance` 只改 prompt 的 `[STANCE RULES]` 段即可变成 advisor / coach / delegate(本页用 collaborator) |

---

## 代价(诚实地说)

1. **LLM 延迟** —— 不再是毫秒级正则,要等模型流式生成。我们用 SSE 把过程(`task.progress`)实时吐到左栏,让等待**可见**而非卡死。
2. **幻觉风险** —— 模型可能编一个不存在的 block id,或在没有依据时硬标红。
   - 兜底:`validateArtifactCitations(exp, artifact)` 是**纯函数引用校验**,对合并后的权威产物逐格检查 `citedBlockIds` 是否真的存在于经验体。
   - 检出的幻觉 id 进 `task.completed.citationIssues`,前端在该格把它**标红**(`.cc.bad`),并在事件流里告警「引用校验兜住」。
   - 即:模型可以错,但**错会被当场标出来**,不会冒充成「林姐说的」。
3. **判断质量依赖经验体质量** —— 经验体写得糙,判断就糙。这把「调 prompt/调代码」变成了「打磨某个人的真实判断模式」,是更值的活,但也是真要花的活。

---

## 为什么这个对比重要

同事的 demo 漂亮但**假**:它演示的是「界面长这样」。
我们这版演示的是「**这个界面背后真的有一个人的判断在跑,而且这判断可追溯、可手改、可迁移**」。

这就是差异化:**不是又一个 redliner UI,而是「任何一个有判断力的人,都能把自己的红线做成一个能跑的 mini-app」** —— 红线只是第一个垂直,换 JSON 就是下一个。

---

## 怎么跑

```bash
cd /Users/benzema/dev/agora

# 确定性 mock(不烧钱、可离线)——验收逻辑
node experiments/test-redliner.mjs            # 19 项全过:编译 / 跑出产物 / locked-by-origin / 有环 / 引用校验

# 真 LLM(OpenRouter)——看真判断
set -a; . ./.env; set +a
node experiments/exp-server.mjs               # 然后开 http://localhost:7800/redliner.html
```

- 引擎:`experiments/engine.mjs`(未改签名,纯加法对接 `validateArtifactCitations` / `why` / `citationIssues`)
- 经验体:`experiments/fixtures/experience-redliner.json`(林姐:2 taste / 4 带 priority 守则 / 4 带证据 case)
- 界面:`experiments/redliner.html`(贴条款 → 逐条红线 + 引用标签 + 折叠 why + pin/continue 有环)
- 验收:`experiments/test-redliner.mjs`
