// ============================================================================
// test-redliner.mjs —— 特性3 验收:把同事 demo 的 redliner 垂直接到【我们的真引擎】。
// 不动现有文件;复用 engine.mjs + experience-redliner.json。mock brain(确定性,无网络)。
// 断言:
//   1. 经验体能 compileSystemPrompt(品味/带优先级守则/带证据案例都进 prompt,守则按 priority 升序)。
//   2. 能被同一个 Engine 跑出 collaborator 结构化产物(逐条款 × 红线判断)。
//   3. locked-by-origin 仍生效:user 手改并锁定某条后,迟到/重跑的 agent 输出不得覆盖它。
//   4. 引用校验:产物里引用的 blockId 都是经验体里真实存在的 id(无幻觉)。
// 跑: cd /Users/benzema/dev/agora && node experiments/test-redliner.mjs
// ============================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  Engine, EVENTS, compileSystemPrompt, cellPath,
  mergeAgentArtifact, validateArtifactCitations,
} from "./engine.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const exp = JSON.parse(readFileSync(join(__dir, "fixtures/experience-redliner.json"), "utf8"));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log("  ✗ " + m); } };
const sect = (s) => console.log("\n" + s);

// 红线专用 mock brain：契约与 brain-pi 一致 makeBrainSession(sys,{stance,exp})→{turn,abort}。
// 首产逐条款红线矩阵；带 [CURRENT ARTIFACT] 时增量(锁定单元原样,未锁定追加「(已据你的要求调整)」)。
function makeRedlinerBrain() {
  return {
    async turn(prompt, { onDelta } = {}) {
      const cur = extractCurrentArtifact(prompt);
      let artifact;
      if (cur) {
        artifact = {
          type: cur.type, columns: cur.columns,
          rows: cur.rows.map((r) => ({
            key: r.key, label: r.label,
            cells: r.cells.map((c) =>
              c.locked
                ? { colKey: c.colKey, value: c.value, why: c.why, citedBlockIds: [] }
                : { colKey: c.colKey, value: (c.value || "") + "(已据你的要求调整)", why: "据你锁定的那条重新顺了一遍红线", citedBlockIds: ["taste1"] }
            ),
          })),
        };
      } else {
        artifact = {
          type: "diagnostic_matrix",
          columns: [
            { key: "level", label: "红线等级" },
            { key: "action", label: "建议改法" },
          ],
          rows: [
            { key: "indemnity", label: "无上限赔偿责任", cells: [
              { colKey: "level", value: "红(一票否决)", why: "无上限赔偿暴露创始人个人资产", citedBlockIds: ["g1"] },
              { colKey: "action", value: "cap 到对价 20%,设 12 个月索赔时效", why: "命中 c1 的处理范式", citedBlockIds: ["g1", "c1"] } ] },
            { key: "exclusivity", label: "排他期 90 天", cells: [
              { colKey: "level", value: "红", why: "超过 45 天上限太多", citedBlockIds: ["g2"] },
              { colKey: "action", value: "砍到 30 天,加尽调不推进自动失效", why: "对齐 c2", citedBlockIds: ["g2", "c2"] } ] },
            { key: "buyback", label: "创始人个人回购", cells: [
              { colKey: "level", value: "红", why: "个人无限连带兜公司风险", citedBlockIds: ["g3"] },
              { colKey: "action", value: "改公司层面回购并设上限", why: "对齐 c3", citedBlockIds: ["g3", "c3"] } ] },
            { key: "unilateral", label: "甲方单边解释权", cells: [
              { colKey: "level", value: "黄", why: "不对称且措辞模糊", citedBlockIds: ["g4", "taste2"] },
              { colKey: "action", value: "删单边解释权,变更需提前 30 天通知", why: "对齐 c4 与 taste3", citedBlockIds: ["g4", "taste3"] } ] },
          ],
        };
      }
      const text = "我按红线优先级(无上限赔偿 > 排他 > 个人回购 > 单边权)逐条扫了:\n```json\n" + JSON.stringify({ artifact }) + "\n```";
      const parts = text.split(/(?<=[。;\n])/);
      for (const p of parts) onDelta?.(p);
      return text;
    },
    abort() {},
  };
}
function extractCurrentArtifact(prompt) {
  const m = (prompt || "").match(/\[CURRENT ARTIFACT\][\s\S]*?```json\s*([\s\S]*?)```/);
  if (!m) return null;
  try { return JSON.parse(m[1].trim()); } catch { return null; }
}

// 注入红线 brain 的 engine
const engine = new Engine({ makeBrainSession: () => makeRedlinerBrain() });

function collect(session) { const evs = []; engine.subscribe(session, (e) => evs.push(e)); return evs; }

// ── 1. 经验体 compileSystemPrompt ──
sect("● 经验体:redliner 能编译出带品味/带优先级守则/带证据案例的 systemPrompt");
{
  const sys = compileSystemPrompt(exp, "collaborator");
  ok(sys.includes("林姐"), "systemPrompt 应带 owner 名");
  ok(sys.includes(exp.blocks.find((b) => b.id === "g1").body.slice(0, 8)), "g1 守则正文应进 prompt");
  // 守则按 priority 升序进 prompt
  const iG1 = sys.indexOf("(g1, P1)"), iG2 = sys.indexOf("(g2, P2)"), iG4 = sys.indexOf("(g4, P4)");
  ok(iG1 > 0 && iG1 < iG2 && iG2 < iG4, "守则应按 priority 升序排进 [GUARDRAILS]");
  // case 三元组(情景/决定/为什么)进 prompt
  ok(sys.includes("情景:") && sys.includes("决定:") && sys.includes("为什么:"), "case 应以 情景→决定→为什么 进 prompt");
  ok(exp.stance === "collaborator", "redliner stance 应为 collaborator");
  ok((exp.expectedOutput.type === "checklist" || exp.expectedOutput.type === "diagnostic_matrix"), "expectedOutput 应为 checklist 或 diagnostic_matrix");
}

// ── 2. 同一 Engine 跑出 collaborator 红线产物 ──
sect("● 真引擎:同一 Engine 跑 redliner,产出逐条款红线矩阵(collaborator),引用全部真实");
{
  const s = engine.startSession(exp, "collaborator");
  const evs = collect(s);
  await engine.runTurn(s, "贴上我的 term sheet:无上限赔偿、90 天排他、创始人个人回购、甲方单边解释权,帮我标红线");

  const done = evs.find((e) => e.type === "task.completed");
  ok(evs.every((e) => EVENTS.includes(e.type)), "所有事件都应属权威集 EVENTS");
  ok(done?.kind === "artifact" && done.artifact?.rows?.length >= 4, "应产出 ≥4 条款的结构化红线产物");
  // 每条都带 citedBlockIds,且都是真实 block id(无幻觉)
  const ids = new Set(exp.blocks.map((b) => b.id));
  const allCites = done.artifact.rows.flatMap((r) => r.cells.flatMap((c) => c.citedBlockIds || []));
  ok(allCites.length > 0 && allCites.every((i) => ids.has(i)), "红线单元引用的 blockId 应全部真实存在");
  // 引用校验函数对真实产物应判 0 幻觉
  ok(validateArtifactCitations(exp, done.artifact).length === 0, "validateArtifactCitations 对真实引用应返回空");
  ok(Array.isArray(done.citationIssues) && done.citationIssues.length === 0, "task.completed.citationIssues 应为空");
  // why 透传
  ok(done.artifact.rows.every((r) => r.cells.every((c) => "why" in c)), "每个红线单元应带 why 字段");
}

// ── 3. locked-by-origin:user 手改锁定后,迟到 agent 输出不得覆盖 ──
sect("● 红线场景下 locked-by-origin 仍生效:user 拍板的红线不被 agent 覆盖");
{
  const s = engine.startSession(exp, "collaborator");
  await engine.runTurn(s, "标红线");
  const path = cellPath("indemnity", "action");
  engine.patch(s, s.version, [{ path, op: "set", value: "我自己定:这条必须 cap 到 10%,不退让", intent: "pin" }]);
  const lockedVal = "我自己定:这条必须 cap 到 10%,不退让";

  // 模拟迟到的 agent 产出,想覆盖锁定格
  const before = s.version;
  const { warnings } = mergeAgentArtifact(s, {
    type: "diagnostic_matrix", columns: s.artifact.columns,
    rows: [{ key: "indemnity", label: "无上限赔偿责任", cells: [{ colKey: "action", value: "agent 想覆盖", citedBlockIds: [] }] }],
  });
  const cell = s.artifact.rows.find((r) => r.key === "indemnity").cells.find((c) => c.colKey === "action");
  ok(cell.value === lockedVal && cell.origin === "user" && cell.locked, "锁定红线应保持 user 的值/origin/locked");
  ok(warnings.some((w) => w.includes("跳过已锁定")), "应产生『跳过已锁定单元』告警");
  ok(s.version === before + 1, "版本号应单调递增");
}

// ── 4. continue 触发新 turn 且尊重锁定(有环) ──
sect("● 有环:continue 锁定一条红线并据此把其余条款顺一遍,锁定项保持不变");
{
  const s = engine.startSession(exp, "collaborator");
  await engine.runTurn(s, "标红线");
  const evs = collect(s);
  const lockedPath = cellPath("exclusivity", "action");
  const r = engine.patch(s, s.version, [{ path: lockedPath, op: "set", value: "排他直接砍到 14 天,锁死", intent: "continue" }]);
  ok(r.triggered === true, "continue 应触发新 turn");
  await r.run;
  ok(evs.some((e) => e.type === "task.accepted"), "continue 后应有 task.accepted");
  const lockedCell = s.artifact.rows.find((r) => r.key === "exclusivity").cells.find((c) => c.colKey === "action");
  ok(lockedCell.value === "排他直接砍到 14 天,锁死" && lockedCell.locked, "重跑后锁定红线仍是 user 值");
  const freeCell = s.artifact.rows.find((r) => r.key === "buyback").cells.find((c) => c.colKey === "action");
  ok(/调整/.test(freeCell.value), "未锁定条款应被 agent 增量顺过一遍");
}

console.log(`\n${fail === 0 ? "✅" : "❌"} redliner 验收:${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
