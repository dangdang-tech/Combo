// ============================================================================
// test-rationale.mjs —— 验收【特性1:B 当地板 + C 当按需披露层】的 engine 侧不变量。
// 纯 node + mock brain,直接 import engine.mjs,无需网络。
// collab.html 的「为什么?」折叠层 100% 依赖这四条:
//   (a) validateArtifactCitations 能抓出【注入的幻觉引用 id】;
//   (b) 正常 artifact(引用都真实)→ citationIssues 为空;
//   (c) cell.why 经 mergeAgentArtifact 后被保留(首产 + 增量两条路径);
//   (d) 锁定单元的 why 不被迟到的 agent 输出覆盖。
// 跑:cd /Users/benzema/dev/agora && node experiments/test-rationale.mjs
// ============================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  Engine, cellPath, validateArtifactCitations, mergeAgentArtifact,
} from "./engine.mjs";
import { makeBrainSession } from "./brain-mock.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const exp = JSON.parse(readFileSync(join(__dir, "fixtures/experience-career.json"), "utf8"));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log("  ✗ " + m); } };
const sect = (s) => console.log("\n" + s);

const cellAt = (art, rowKey, colKey) =>
  art.rows.find((r) => r.key === rowKey)?.cells.find((c) => c.colKey === colKey);

// ── (a) validateArtifactCitations 能抓出注入的幻觉引用 id ──
sect("● (a) 幻觉引用:validateArtifactCitations 抓出不存在于经验体的 id");
{
  const engine = new Engine({ makeBrainSession });
  const s = engine.startSession(exp, "collaborator");
  await engine.runTurn(s, "摆出 A、B 对比");                       // 首产真实 artifact

  // 往一个真实单元里注入一个【不存在于 exp.blocks】的幻觉 id(外加保留一个真实 id)
  const target = cellAt(s.artifact, "learning", "opt_a");
  target.citedBlockIds = ["taste2", "g_does_not_exist", "另一个幻觉"];

  const issues = validateArtifactCitations(exp, s.artifact);
  const hit = issues.find((i) => i.path === cellPath("learning", "opt_a"));
  ok(hit, "应在 learning/opt_a 上报出 citationIssue");
  ok(hit && hit.badIds.includes("g_does_not_exist") && hit.badIds.includes("另一个幻觉"),
    "badIds 应包含两个注入的幻觉 id");
  ok(hit && !hit.badIds.includes("taste2"), "真实 id taste2 不应被误判为幻觉");
  // 校验是纯函数:不改 artifact
  ok(target.citedBlockIds.length === 3, "validateArtifactCitations 不应改动 artifact 的 citedBlockIds");
}

// ── (b) 正常 artifact → citationIssues 为空 ──
sect("● (b) 干净引用:全部 citedBlockIds 真实 → 无 citationIssue");
{
  const engine = new Engine({ makeBrainSession });
  const s = engine.startSession(exp, "collaborator");
  const evs = [];
  engine.subscribe(s, (e) => evs.push(e));
  await engine.runTurn(s, "摆出 A、B 对比");                       // mock 只引用真实 id

  const issues = validateArtifactCitations(exp, s.artifact);
  ok(issues.length === 0, "正常 artifact 的 validateArtifactCitations 应为空数组");

  // task.completed 事件应携带空 citationIssues(collab.html 据此判断不显示 ⚠)
  const done = evs.find((e) => e.type === "task.completed");
  ok(done && Array.isArray(done.citationIssues) && done.citationIssues.length === 0,
    "task.completed 应带空 citationIssues");
  ok(!done.warnings.some((w) => /幻觉引用/.test(w)), "无幻觉时 warnings 不应含『幻觉引用』行");
}

// ── (c) cell.why 经 merge 后被保留(首产 + 增量两条路径) ──
sect("● (c) why 透传:mergeAgentArtifact 首产与增量都保留 cell.why");
{
  const engine = new Engine({ makeBrainSession });
  const s = engine.startSession(exp, "collaborator");
  await engine.runTurn(s, "摆出 A、B 对比");                       // 首产路径

  const firstCell = cellAt(s.artifact, "learning", "opt_a");
  ok(firstCell.why && /taste2/.test(firstCell.why), "首产路径:cell.why 应被保留(非空)");

  // 增量路径:mock 在带 [CURRENT ARTIFACT] 时给未锁定单元写新的 why
  await engine.runTurn(s, "再顺一遍", { artifactSnapshot: s.artifact });
  const incCell = cellAt(s.artifact, "cash", "opt_a");
  ok(incCell.why && incCell.why.length > 0, "增量路径:重算单元应带新的 why");

  // 没有 why 的 agent 输出 → 归一化为 null,不应丢字段或变 undefined
  const naked = {
    type: "diagnostic_matrix", columns: s.artifact.columns,
    rows: [{ key: "learning", label: "能学到什么",
      cells: [{ colKey: "opt_b", value: "无 why 的新值", citedBlockIds: [] }] }],
  };
  mergeAgentArtifact(s, naked);
  const nullWhy = cellAt(s.artifact, "learning", "opt_b");
  ok(nullWhy.value === "无 why 的新值" && nullWhy.why === null,
    "缺省 why 应被归一化为 null(便于 collab.html 折叠层判空)");
}

// ── (d) 锁定单元的 why 不被迟到的 agent 输出覆盖 ──
sect("● (d) 锁定保护:locked 单元跳过时其 why 不变");
{
  const engine = new Engine({ makeBrainSession });
  const s = engine.startSession(exp, "collaborator");
  await engine.runTurn(s, "摆出 A、B 对比");

  const path = cellPath("learning", "opt_a");
  const before = cellAt(s.artifact, "learning", "opt_a");
  const whyBefore = before.why;                                    // 首产时的 why

  // user pin 锁定(只改 value,不带 why)
  engine.patch(s, s.version, [{ path, op: "set", value: "我自己拍板", intent: "pin" }]);

  // 迟到的 agent 输出试图覆盖该单元的 value+why
  const late = {
    type: "diagnostic_matrix", columns: s.artifact.columns,
    rows: [{ key: "learning", label: "能学到什么",
      cells: [{ colKey: "opt_a", value: "agent 想覆盖", why: "agent 想塞的 why", citedBlockIds: [] }] }],
  };
  const { warnings } = mergeAgentArtifact(s, late);

  const after = cellAt(s.artifact, "learning", "opt_a");
  ok(after.value === "我自己拍板", "锁定单元 value 应保持 user 的");
  ok(after.why === whyBefore, "锁定单元跳过时其原 why 不应被 agent 覆盖");
  ok(warnings.some((w) => /跳过已锁定/.test(w)), "应产生『跳过已锁定』告警");
}

// ── 总结 ──
console.log(`\n${fail === 0 ? "✅" : "❌"} rationale 验收:${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
