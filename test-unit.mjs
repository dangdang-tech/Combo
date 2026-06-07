// 单元测试:纯函数 firstJson / computeScope / compile(无服务器、无 LLM、确定性)。
import { firstJson, computeScope, compile } from "./anchor-lib.mjs";
let pass = 0, fail = 0;
const eq = (a, b, m) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (ok) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗ FAIL:", m, "\n    got:", JSON.stringify(a), "\n    exp:", JSON.stringify(b)); } };
const ok = (c, m) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗ FAIL:", m); } };
const throws = (fn, m) => { try { fn(); fail++; console.log("  ✗ FAIL(应抛错):", m); } catch { pass++; console.log("  ✓", m); } };

console.log("=== firstJson ===");
eq(firstJson('[{"a":1},{"a":2}]'), [{ a: 1 }, { a: 2 }], "对象数组不被吃外层括号");
eq(firstJson('前言 [{"a":1}] 后语'), [{ a: 1 }], "剥离前后散文");
eq(firstJson('```json\n{"x":[1,2]}\n```'), { x: [1, 2] }, "剥离 markdown fence");
eq(firstJson('[{"t":"含 } 和 ] 的字符串"}]'), [{ t: "含 } 和 ] 的字符串" }], "字符串内括号不误判");
eq(firstJson('{"s":"反斜杠\\"转义引号"}'), { s: '反斜杠"转义引号' }, "转义引号正确");
eq(firstJson('{"a":{"b":{"c":1}}}'), { a: { b: { c: 1 } } }, "深层嵌套");
throws(() => firstJson("没有 JSON 的纯文本"), "无 JSON 抛错");
throws(() => firstJson('{"a":1'), "括号未闭合抛错");

console.log("=== computeScope ===");
// 全一致 → coherence 1
let r = computeScope([
  { input_features: { language: "zh", domain: "SaaS", input_type: "录音", scale: "早期" } },
  { input_features: { language: "zh", domain: "SaaS", input_type: "录音", scale: "早期" } },
]);
eq(r.scope.language, "zh", "众数 language=zh");
eq(r.scope.domain, "SaaS", "众数 domain=SaaS");
eq(r.coherence, 1, "全一致 coherence=1");
// 一半一半 → 每维众数占比 0.5,几何平均 0.5
r = computeScope([
  { input_features: { language: "zh", domain: "A", input_type: "录音", scale: "早期" } },
  { input_features: { language: "en", domain: "B", input_type: "文档", scale: "晚期" } },
]);
eq(r.coherence, 0.5, "全冲突 coherence=0.5");
// 3:1 混杂 → 0.75
r = computeScope([
  { input_features: { language: "zh", domain: "A", input_type: "x", scale: "s" } },
  { input_features: { language: "zh", domain: "A", input_type: "x", scale: "s" } },
  { input_features: { language: "zh", domain: "A", input_type: "x", scale: "s" } },
  { input_features: { language: "en", domain: "B", input_type: "y", scale: "t" } },
]);
eq(r.coherence, 0.75, "3:1 混杂 coherence=0.75");
ok(Array.isArray(r.scope.preconditions) && Array.isArray(r.scope.out_of_scope), "scope 含 preconditions/out_of_scope 数组");
// 缺失特征 → 未知
r = computeScope([{ input_features: {} }, { input_features: {} }]);
eq(r.scope.language, "未知", "缺失特征 → 未知");
eq(r.coherence, 0, "无特征 coherence=0");
// 空列表不崩
r = computeScope([]);
ok(r && typeof r.coherence === "number", "空列表不崩");

console.log("=== compile(答案绝不静默丢弃 · 修复 #1/#7)===");
const mf = (instr, slots, qs) => ({ interaction: { required_context: slots, review_questions: qs || [] }, skill_set: [{ steps: [instr] }] });
// 正常:槽与答案对齐
let s = compile(mf("分析 {answer.a} 和 {answer.b}", ["a", "b"]), { a: "X", b: "Y" });
ok(s.includes("分析 X 和 Y"), "正常槽位填充");
ok(!s.includes("用户补充输入"), "对齐时无补充块");
// 槽多于答案:缺的留占位
s = compile(mf("用 {answer.a}", ["a"]), {});
ok(s.includes("（a）"), "缺答案留占位符");
// 答案多于槽(#7:questions>slots):多的答案进补充块,不丢
s = compile(mf("只有 {answer.a}", ["a"], ["问A", "问B", "问C"]), { a: "X", q1: "额外B", q2: "额外C" });
ok(s.includes("只有 X"), "对齐槽正常填");
ok(s.includes("额外B") && s.includes("额外C"), "#7 多出的答案不丢(进补充块)");
ok(s.includes("问B") || s.includes("q1"), "补充块带问题标签");
// 槽名漂移(#1:instructions 无规范槽 → required_context 空):答案全进补充块
s = compile(mf("指令里没有任何占位符", [], ["你的输入"]), { q0: "重要答案" });
ok(s.includes("重要答案"), "#1 槽名漂移时答案不丢");
// 空答案不进补充
s = compile(mf("{answer.a}", ["a"]), { a: "" });
ok(!s.includes("用户补充输入"), "空答案不产生补充块");

console.log(`\n=== 单元: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
