// ============================================================================
// test-extract.mjs —— 验收特性2「从真实 session 提取经验体」。
// 用【注入的 stub run】(返回固定合规 JSON),不烧钱、不依赖网络。断言:
//   (a) 产物符合 schema:有 taste、guardrail 带 priority、case 带 evidenceRef;
//   (b) 产物能被 engine.compileSystemPrompt 正常编译;
//   (c) 把产物塞进 Engine(mock brain)跑一轮 collaborator 能出 artifact。
// 跑:cd /Users/benzema/dev/agora && node experiments/test-extract.mjs
// ============================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractExperience } from "./extract-experience.mjs";
import { Engine, compileSystemPrompt } from "./engine.mjs";
import { makeBrainSession } from "./brain-mock.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const sessionText = readFileSync(join(__dir, "fixtures/_sample-session.txt"), "utf8");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };
const sect = (s) => console.log("\n" + s);

// ── 注入的 stub run:返回一段固定的、合规的、用 ```json 包裹的 ExperienceBody。 ──
// 故意带前导散文 + fenced block,顺便验证 extractExperience 的解析鲁棒性。
const STUB_JSON = {
  experienceId: "exp_career_extracted_v1",
  ownerName: "老周",
  title: "职业/offer 取舍上的判断力(从 session 萃取)",
  stance: "collaborator",
  expectedOutput: { type: "diagnostic_matrix" },
  blocks: [
    { id: "taste1", kind: "taste", label: "三年视角优先", body: "取舍先砍『三年后还想不想干』,薪资排在它后面。" },
    { id: "taste2", kind: "taste", label: "稀缺能力 > 头衔", body: "偏好有高人带、能长出稀缺能力的环境,胜过头衔光鲜但学不到东西。" },
    { id: "g1", kind: "guardrail", priority: 1, label: "倦怠一票否决", body: "让人半年内大概率倦怠的选项直接否决,这条压一切——压薪资也压学习曲线。" },
    { id: "g2", kind: "guardrail", priority: 2, label: "现金流底线", body: "现金流没断则优先学习曲线陡的;告急则先保生存。" },
    { id: "g3", kind: "guardrail", priority: 3, label: "别为逃避而跳", body: "别为逃避某个人而跳,先内部转岗排除『是不是人的问题』。" },
    { id: "c1", kind: "case", label: "A/B offer 选 A", situation: "A、B 两个 offer,B 多 30%。", decision: "选 A。", why: "命中三年视角与 taste2;B 是消耗战。", evidenceRef: "L01-L14" },
    { id: "c2", kind: "case", label: "大厂→创业要 18 个月 buffer", situation: "想从大厂跳早期创业公司。", decision: "可以去,但先攒够 18 个月现金 buffer。", why: "赌学习曲线/期权值得,但要守 g2 生存底线。", evidenceRef: "L22-L31" },
    { id: "c3", kind: "case", label: "因老板想走先转岗", situation: "想走的主因是受不了现任老板。", decision: "先内部转岗试一次再决定。", why: "命中 g3:别为逃避而跳。", evidenceRef: "L33-L42" },
  ],
};
let stubCalls = 0, lastArgs = null;
const stubRun = async (args) => {
  stubCalls++; lastArgs = args;
  return { text: "我从 session 里萃取了老周的判断模式如下:\n```json\n" + JSON.stringify(STUB_JSON) + "\n```", usage: {}, ms: 0 };
};

sect("● 萃取:用注入的 stub run,不写盘(write:false)");
const exp = await extractExperience(sessionText, { run: stubRun, write: false });

// stub 真被调用了,且 session 文本进了 prompt(证明确实喂了真实 session)
ok(stubCalls === 1, "stub run 应被调用恰好一次");
ok(typeof lastArgs?.systemPrompt === "string" && lastArgs.systemPrompt.length > 0, "应传入非空 systemPrompt");
ok((lastArgs?.userInput || "").includes("三年后") || (lastArgs?.userInput || "").includes("SESSION"), "session 文本应被注入 userInput");
ok(lastArgs?.temperature === 0, "萃取应以 temperature=0 去噪");

// ── (a) schema ──
sect("● (a) 产物符合 schema");
ok(typeof exp.experienceId === "string" && exp.experienceId.length > 0, "应有 experienceId");
ok(typeof exp.ownerName === "string", "应有 ownerName");
ok(exp.expectedOutput?.type === "diagnostic_matrix", "expectedOutput.type 应为 diagnostic_matrix");
ok(Array.isArray(exp.blocks) && exp.blocks.length >= 6, "blocks 应为数组且足够多");

const tastes = exp.blocks.filter((b) => b.kind === "taste");
const guards = exp.blocks.filter((b) => b.kind === "guardrail");
const cases = exp.blocks.filter((b) => b.kind === "case");
ok(tastes.length >= 2, "至少 2 条 taste");
ok(guards.length >= 2, "至少 2 条 guardrail");
ok(cases.length >= 2, "至少 2 个 case");

ok(guards.every((g) => typeof g.priority === "number"), "每条 guardrail 都带 priority(数值)");
// 优先级必须能严格区分高低(差异化核心:带优先级的判断守则)
const prios = guards.map((g) => g.priority);
ok(new Set(prios).size === prios.length, "guardrail 的 priority 应互不相同(可严格排序)");
ok(Math.min(...prios) === 1, "最高优先级应为 1");

ok(cases.every((c) => typeof c.evidenceRef === "string" && c.evidenceRef.length > 0), "每个 case 都带非空 evidenceRef(证据指针)");
ok(cases.every((c) => c.situation && c.decision && c.why), "每个 case 都有 situation/decision/why");
ok(exp.blocks.every((b) => typeof b.id === "string" && b.id.length > 0), "每个 block 都有 id");

// ── (b) 能被 engine 编译 ──
sect("● (b) 产物能被 engine.compileSystemPrompt 编译");
const sys = compileSystemPrompt(exp, "collaborator");
ok(typeof sys === "string" && sys.includes("[GUARDRAILS]") && sys.includes("[CASES]"), "编译出的 systemPrompt 含 GUARDRAILS/CASES 段");
// 守则按 priority 升序进 prompt
const g1pos = sys.indexOf("P1"), g2pos = sys.indexOf("P2");
ok(g1pos >= 0 && g2pos > g1pos, "守则应按 priority 升序出现在 prompt");

// ── (c) 塞进 Engine(mock brain)跑一轮 collaborator 出 artifact ──
sect("● (c) 塞进 Engine(mock brain)跑一轮 collaborator 能出 artifact");
const engine = new Engine({ makeBrainSession });
const session = engine.startSession(exp, "collaborator");
let completed = null;
engine.subscribe(session, (e) => { if (e.type === "task.completed") completed = e; });
await engine.runTurn(session, "帮我把 A、B 两个 offer 摆出来对比一下");
ok(completed && completed.kind === "artifact", "应收到 task.completed(kind=artifact)");
ok(completed?.artifact?.rows?.length > 0, "产物 artifact 应有 rows");
ok(Array.isArray(completed?.citationIssues), "task.completed 应带 citationIssues 字段");

// ── 汇总 ──
console.log(`\n${fail === 0 ? "✅ 全部通过" : "❌ 有失败"} — pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
