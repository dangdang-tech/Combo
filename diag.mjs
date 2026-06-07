// 稳定性诊断探针 —— 用「已知 ground-truth 的合成语料」隔离不稳定的来源。
// 语料:20 个能力观察,人为植入 4 个真能力(A/B/C/D),各 5 段、措辞各异。
// 若管线连这个已知结构都复现不稳 → 病根在 管线/模型;若 temp=0 就稳 → 病根在 API 采样。
//   用法:node --env-file=.env diag.mjs <probe> [N] [temp]
//   probe: repeat | order | temp | grain
import { getModel, complete } from "@earendil-works/pi-ai";
const MODEL = process.env.MODEL || "deepseek/deepseek-v4-pro";
const KEY = process.env.OPENROUTER_API_KEY;
const m = getModel("openrouter", MODEL);

// ── 合成语料:4 个真能力 × 5,措辞故意打散(不可靠靠词面聚) ──
const GT = { A: "投资人/FA 会谈复盘", B: "代码仓库审查与诊断", C: "生成式 UI 研究", D: "产品发布前准备" };
const CORPUS = [
  { g:"A", goal:"复盘昨天见的投资人,提炼问题和改进", artifact:"复盘报告" },
  { g:"A", goal:"把和 FA 的录音整理成结构化纪要", artifact:"会谈纪要" },
  { g:"A", goal:"分析这次 pitch 哪里答得不好,下次怎么改", artifact:"改进清单" },
  { g:"A", goal:"评价这场融资沟通的表现和信号", artifact:"评估报告" },
  { g:"A", goal:"把投资人提的问题逐条拆解并准备答案", artifact:"问答准备" },
  { g:"B", goal:"检查这个 GitHub 仓库有没有潜在问题并给修复建议", artifact:"诊断报告" },
  { g:"B", goal:"审查代码库结构,找出架构隐患", artifact:"审查结论" },
  { g:"B", goal:"跑一遍 repo 看实现细节、截图验证功能", artifact:"验证记录" },
  { g:"B", goal:"评估开源项目质量与可维护性", artifact:"质量评估" },
  { g:"B", goal:"把一个陌生仓库的能力边界摸清楚", artifact:"能力梳理" },
  { g:"C", goal:"调研 generative UI 的最新技术与实践", artifact:"调研笔记" },
  { g:"C", goal:"追踪 agent 动态生成界面的方案演进", artifact:"技术综述" },
  { g:"C", goal:"研究 GENUI 怎么按上下文实时渲染", artifact:"研究纪要" },
  { g:"C", goal:"对比几种生成式界面框架的能力", artifact:"对比表" },
  { g:"C", goal:"梳理 generative UI 的前沿论文和项目", artifact:"文献梳理" },
  { g:"D", goal:"帮初创产品做发布前的全面优化准备", artifact:"发布清单" },
  { g:"D", goal:"上线前检查产品各环节、补齐缺口", artifact:"上线检查表" },
  { g:"D", goal:"准备 PH/发布渠道的素材和文案", artifact:"发布素材" },
  { g:"D", goal:"产品 beta 发布前的最后优化", artifact:"优化方案" },
  { g:"D", goal:"梳理发布流程,排查风险点", artifact:"风险清单" },
];

const sysJsonArr = "你只输出 JSON 数组,不要任何解释或 markdown。";
const indPrompt = (obs, grain) => `下面是用户多段会话的「能力观察」。归纳出其中反复出现、值得打包成 mini-app 的能力。
${grain === "specific" ? "请尽量【细粒度、具体】,产出 4-8 个互不重叠的具体能力(别塌成大而空的类目)。" : "最多 8 个。"}
观察:
${obs.map((o, i) => `[${i}] 目标:${o.goal} | 产物:${o.artifact}`).join("\n")}
只输出 JSON 数组,每项 { "name":"中文能力名", "tagline":"一句话它干嘛" }`;

async function induce(obs, { temperature, grain } = {}) {
  const opt = { apiKey: KEY }; if (temperature != null) opt.temperature = temperature;
  const res = await complete(m, { systemPrompt: sysJsonArr, messages: [{ role: "user", content: indPrompt(obs, grain) }] }, opt);
  const t = (res.content || []).map((b) => b?.text || "").join("");
  const mm = t.match(/\[[\s\S]*\]/); if (!mm) return [];
  try { return JSON.parse(mm[0]).filter((x) => x && x.name); } catch { return []; }
}

// 词面相似(隔离:不引入额外 LLM 方差)。token-Jaccard on name+tagline。
const toks = (c) => new Set((((c.name || "") + " " + (c.tagline || "")).toLowerCase().match(/[一-龥]{1,}|[a-z]+/g) || []));
const sim = (a, b) => { const A = toks(a), B = toks(b); let i = 0; for (const x of A) if (B.has(x)) i++; const u = A.size + B.size - i; return u ? i / u : 0; };
// 两个能力集合的 Jaccard(贪心匹配,阈值 τ)
function setJaccard(s1, s2, tau = 0.34) {
  const used = new Set(); let match = 0;
  for (const a of s1) { let best = -1, bs = tau; for (let j = 0; j < s2.length; j++) { if (used.has(j)) continue; const s = sim(a, s2[j]); if (s >= bs) { bs = s; best = j; } } if (best >= 0) { used.add(best); match++; } }
  const uni = s1.length + s2.length - match; return uni ? match / uni : 1;
}
const meanPairwise = (sets) => { const ps = []; for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) ps.push(setJaccard(sets[i], sets[j])); return ps.reduce((a, b) => a + b, 0) / (ps.length || 1); };
// 植入结构召回:4 个真能力里,这次产出覆盖了几个(用 GT 关键词宽松判)
const GTKEYS = { A: ["投资", "fa", "pitch", "融资", "复盘", "会谈"], B: ["仓库", "repo", "代码", "审查", "诊断", "项目"], C: ["ui", "界面", "生成式", "genui", "generative"], D: ["发布", "上线", "ph", "beta", "产品"] };
const recall = (set) => { let r = 0; for (const g of Object.keys(GTKEYS)) { const ks = GTKEYS[g]; if (set.some((c) => { const s = ((c.name || "") + (c.tagline || "")).toLowerCase(); return ks.some((k) => s.includes(k)); })) r++; } return r; };
const seededShuffle = (arr, seed) => { const a = [...arr]; let s = seed * 2654435761 % 2147483647 || 1; for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const probe = process.argv[2] || "repeat";
const N = +(process.argv[3] || 5);
const TEMP = process.argv[4] != null ? +process.argv[4] : null;

(async () => {
  const t0 = Date.now();
  if (probe === "repeat" || probe === "order") {
    // repeat:同一输入跑 N 次(纯模型/采样方差)。order:每次打乱输入顺序(+结构方差)。
    const sets = [];
    for (let i = 0; i < N; i++) { const obs = probe === "order" ? seededShuffle(CORPUS, i + 1) : CORPUS; sets.push(await induce(obs, { temperature: TEMP, grain: "specific" })); }
    const out = { probe, N, temp: TEMP, counts: sets.map((s) => s.length), recalls: sets.map(recall), meanRecall: +(sets.map(recall).reduce((a, b) => a + b, 0) / N).toFixed(2), jaccard: +meanPairwise(sets).toFixed(3), sec: +((Date.now() - t0) / 1000).toFixed(0) };
    console.log("RESULT " + JSON.stringify(out));
  } else if (probe === "temp") {
    // 对比 temp=0 vs temp=1 的同输入复现度(直接回答"是不是 API 温度的问题")
    const r = {};
    for (const tp of [0, 1]) { const sets = []; for (let i = 0; i < N; i++) sets.push(await induce(CORPUS, { temperature: tp, grain: "specific" })); r["temp" + tp] = { jaccard: +meanPairwise(sets).toFixed(3), counts: sets.map((s) => s.length), meanRecall: +(sets.map(recall).reduce((a, b) => a + b, 0) / N).toFixed(2) }; }
    console.log("RESULT " + JSON.stringify({ probe, N, ...r, sec: +((Date.now() - t0) / 1000).toFixed(0) }));
  } else if (probe === "grain") {
    // 粗 vs 细粒度,各跑 N 次,看哪种复现更稳 + 召回更全
    const r = {};
    for (const g of ["broad", "specific"]) { const sets = []; for (let i = 0; i < N; i++) sets.push(await induce(seededShuffle(CORPUS, i + 1), { temperature: 0, grain: g })); r[g] = { jaccard: +meanPairwise(sets).toFixed(3), avgCount: +(sets.map((s) => s.length).reduce((a, b) => a + b, 0) / N).toFixed(1), meanRecall: +(sets.map(recall).reduce((a, b) => a + b, 0) / N).toFixed(2) }; }
    console.log("RESULT " + JSON.stringify({ probe, N, ...r, sec: +((Date.now() - t0) / 1000).toFixed(0) }));
  } else if (probe === "anchor") {
    // 验证修法:R1 生成固定清单 L → 后续 N 轮只把观察【分类】到 L(打乱顺序扰动)→ 看重构集合是否稳。
    const L = await induce(CORPUS, { temperature: 0, grain: "specific" });
    const classify = async (obs) => {
      const p = `能力清单:\n${L.map((c, i) => `[${i}] ${c.name} — ${c.tagline || ""}`).join("\n")}\n观察:\n${obs.map((o, j) => `{${j}} ${o.goal}`).join("\n")}\n为每个观察选最匹配的能力编号(不属于任何则 -1)。只输出 JSON:{"assign":[与观察同序的能力编号数组]}`;
      const res = await complete(m, { systemPrompt: "你只输出 JSON。", messages: [{ role: "user", content: p }] }, { apiKey: KEY, temperature: 0 });
      const t = (res.content || []).map((b) => b?.text || "").join(""); const mm = t.match(/\{[\s\S]*\}/);
      try { return new Set((JSON.parse(mm[0]).assign || []).filter((x) => x >= 0)); } catch { return new Set(); }
    };
    const idxSets = [];
    for (let i = 0; i < N; i++) idxSets.push(await classify(seededShuffle(CORPUS, i + 1)));
    const jIdx = (a, b) => { let inter = 0; for (const x of a) if (b.has(x)) inter++; const uni = a.size + b.size - inter; return uni ? inter / uni : 1; };
    const ps = []; for (let i = 0; i < idxSets.length; i++) for (let j = i + 1; j < idxSets.length; j++) ps.push(jIdx(idxSets[i], idxSets[j]));
    const jac = ps.reduce((a, b) => a + b, 0) / (ps.length || 1);
    console.log("RESULT " + JSON.stringify({ probe, N, taxonomy_size: L.length, used_per_round: idxSets.map((s) => s.size), jaccard: +jac.toFixed(3), sec: +((Date.now() - t0) / 1000).toFixed(0) }));
  } else { console.log("unknown probe"); }
})().catch((e) => { console.log("ERR " + (e.message || e)); process.exit(1); });
