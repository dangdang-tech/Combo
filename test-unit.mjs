// 单元测试:纯函数 firstJson / computeScope / compile / parse-sessions(无服务器、无 LLM、确定性)。
import { firstJson, computeScope, compile } from "./anchor-lib.mjs";
import { parseClaude, parseCodex, parseSession, isCodexFormat, codexText, baseName, dedupeAndStats, sessionKey } from "./parse-sessions.mjs";
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

// ───────────────────────── parse-sessions(导入解析的唯一真源)─────────────────────────
const J = (...lines) => lines.join("\n");

console.log("=== baseName ===");
eq(baseName("/a/b/c"), "c", "取末段");
eq(baseName("/a/b/c/"), "c", "容忍结尾斜杠");
eq(baseName("a\\b\\c"), "c", "兼容 Windows 反斜杠");
eq(baseName("solo"), "solo", "无分隔符返回原值");
eq(baseName(""), "", "空字符串");
eq(baseName(null), "", "null 不崩");

console.log("=== isCodexFormat ===");
ok(isCodexFormat("rollout-2026-03-01-abc.jsonl", ""), "rollout- 文件名 → codex");
ok(isCodexFormat("x.jsonl", '{"type":"response_item"}'), "response_item 文本 → codex");
ok(isCodexFormat("x.jsonl", '{"type":"session_meta"}'), "session_meta 文本 → codex");
ok(!isCodexFormat("uuid.jsonl", '{"message":{"role":"user"}}'), "普通 claude → 非 codex");

console.log("=== codexText ===");
eq(codexText({ content: "纯字符串" }), "纯字符串", "string 内容");
eq(codexText({ content: [{ text: "块A" }, { text: "块B" }] }), "块A块B", "数组块拼接");
eq(codexText({ content: null }), "", "null 内容 → 空");
eq(codexText({}), "", "无 content → 空");

console.log("=== parseClaude ===");
const cl1 = parseClaude(J('{"type":"summary"}', '{"aiTitle":"重构认证模块"}', '{"message":{"role":"user","content":"帮我重构 auth"}}', '{"message":{"role":"assistant","content":"好"}}', '{"message":{"role":"user","content":"加单测"}}'), { date: "2026-05-01", project: "agora" });
eq(cl1.title, "重构认证模块", "claude 取 aiTitle");
eq(cl1.count, 2, "claude count = role:user 数");
eq(cl1.source, "claude", "source=claude");
eq(cl1.project, "agora", "project 用传入值");
eq(cl1.date, "2026-05-01", "date 透传");
eq(cl1.content, "用户: 帮我重构 auth\n用户: 加单测", "content = 用户消息(跳过 assistant)");
ok(parseClaude(J('{"message":{"role":"user","content":"只有一条"}}'), {}) === null, "claude <2 条用户消息 → null");
eq(parseClaude(J('{"message":{"role":"user","content":"a"}}', '{"message":{"role":"user","content":"b"}}'), {}).title, "(无标题会话)", "无 aiTitle → 默认标题");
eq(parseClaude(J('{"message":{"role":"user","content":"a"}}', '{"message":{"role":"user","content":"b"}}'), {}).project, "claude", "无 project → 默认 claude");
// 数组块内容
eq(parseClaude(J('{"message":{"role":"user","content":[{"type":"text","text":"块X"},{"type":"text","text":"块Y"}]}}', '{"message":{"role":"user","content":"第二条"}}'), {}).content, "用户: 块X块Y\n用户: 第二条", "claude 数组块内容拼接");
// 跳过工具回灌(<)与 Caveat(但仍计入 count,因 count 用正则)
const clTool = parseClaude(J('{"message":{"role":"user","content":"<tool_result>x</tool_result>"}}', '{"message":{"role":"user","content":"真实问题"}}', '{"message":{"role":"user","content":"Caveat: 系统提示"}}'), {});
eq(clTool.content, "用户: 真实问题", "content 跳过 < 与 Caveat 开头");
eq(clTool.count, 3, "count 仍按 role:user 计(含工具回灌)");
// aiTitle 含转义
eq(parseClaude(J('{"aiTitle":"含\\"引号\\"的标题"}', '{"message":{"role":"user","content":"a"}}', '{"message":{"role":"user","content":"b"}}'), {}).title, '含"引号"的标题', "aiTitle 转义引号正确解码");
// 坏行被跳过
eq(parseClaude(J('{坏 json', '{"message":{"role":"user","content":"a"}}', '坏', '{"message":{"role":"user","content":"b"}}'), {}).content, "用户: a\n用户: b", "坏 JSON 行跳过不崩");
// 12 条上限 + 400 截断
const many = parseClaude(J('{"aiTitle":"t"}', ...Array.from({ length: 15 }, (_, i) => `{"message":{"role":"user","content":"msg${i} ${"x".repeat(500)}"}}`)), {});
eq(many.content.split("\n").length, 12, "content 最多 12 条用户消息");
ok(many.content.split("\n")[0].length <= 6 + 400, "单条消息截到 400 字");

console.log("=== parseCodex ===");
const cx1 = parseCodex(J('{"type":"session_meta","payload":{"cwd":"/Users/me/dev/myproj"}}', '{"type":"response_item","payload":{"role":"user","content":"部署到 railway"}}', '{"type":"response_item","payload":{"role":"assistant","content":"ok"}}', '{"type":"response_item","payload":{"role":"user","content":"加访问码闸"}}'), { date: "2026-05-02" });
eq(cx1.title, "部署到 railway", "codex 标题 = 首条用户消息");
eq(cx1.count, 2, "codex count = 有效用户消息数");
eq(cx1.project, "myproj", "codex project = cwd 末段");
eq(cx1.source, "codex", "source=codex");
eq(cx1.content, "用户: 部署到 railway\n用户: 加访问码闸", "codex content");
ok(parseCodex(J('{"type":"response_item","payload":{"role":"user","content":"只一条"}}'), {}) === null, "codex <2 条 → null");
// 跳过 # 与 < 注入(不计入 count)
const cxInj = parseCodex(J('{"type":"response_item","payload":{"role":"user","content":"# 系统注入"}}', '{"type":"response_item","payload":{"role":"user","content":"<env>x</env>"}}', '{"type":"response_item","payload":{"role":"user","content":"真问题一"}}', '{"type":"response_item","payload":{"role":"user","content":"真问题二"}}'), {});
eq(cxInj.count, 2, "codex 跳过 # / < 注入,count 只数真实消息");
eq(cxInj.title, "真问题一", "codex 标题取首条真实消息");
// 无 cwd → project=codex
eq(parseCodex(J('{"type":"response_item","payload":{"role":"user","content":"a"}}', '{"type":"response_item","payload":{"role":"user","content":"b"}}'), {}).project, "codex", "codex 无 cwd → project=codex");
// 数组块内容
eq(parseCodex(J('{"type":"response_item","payload":{"role":"user","content":[{"text":"X"}]}}', '{"type":"response_item","payload":{"role":"user","content":"Y"}}'), {}).content, "用户: X\n用户: Y", "codex 数组块内容");
// 标题空白折叠
eq(parseCodex(J('{"type":"response_item","payload":{"role":"user","content":"多   空格    折叠"}}', '{"type":"response_item","payload":{"role":"user","content":"b"}}'), {}).title, "多 空格 折叠", "codex 标题连续空白折叠为单空格");

console.log("=== parseSession(自动识别)===");
const auto1 = parseSession(J('{"type":"session_meta","payload":{"cwd":"/x/proj"}}', '{"type":"response_item","payload":{"role":"user","content":"a"}}', '{"type":"response_item","payload":{"role":"user","content":"b"}}'), "rollout-x.jsonl", {});
eq(auto1.source, "codex", "rollout 文件 → 走 codex");
const auto2 = parseSession(J('{"aiTitle":"t"}', '{"message":{"role":"user","content":"a"}}', '{"message":{"role":"user","content":"b"}}'), "projects/agora-proj/uuid.jsonl", { date: "2026-05-03" });
eq(auto2.source, "claude", "claude 文件 → 走 claude");
eq(auto2.project, "agora-proj", "claude project 推断自 fname 上级目录");
eq(parseSession(J('{"aiTitle":"t"}', '{"message":{"role":"user","content":"a"}}', '{"message":{"role":"user","content":"b"}}'), "f.jsonl", { project: "强制" }).project, "强制", "opts.project 覆盖推断");

console.log("=== dedupeAndStats ===");
const S = (title, count, project, source, date) => ({ title, count, date, project, source });
const ds1 = dedupeAndStats([], [S("A", 5, "p", "claude", "2026-03-01"), S("B", 3, "p", "codex", "2026-05-01")]);
eq(ds1.stats.segments, 2, "segments=2");
eq(ds1.stats.messages, 8, "messages = count 之和");
eq(ds1.stats.by_source, { claude: 1, codex: 1 }, "by_source 统计");
eq(ds1.stats.projects, 1, "projects 去重计数");
eq(ds1.stats.span, "2026-03–2026-05", "span = 最早–最晚月");
eq(ds1.idx[0].title, "A", "按 count 降序(A 在前)");
// 去重:同 title|count|project → 后者覆盖
const ds2 = dedupeAndStats([S("A", 5, "p", "claude", "2026-03-01")], [S("A", 5, "p", "codex", "2026-04-01")]);
eq(ds2.stats.segments, 1, "同 key 去重 → 1 段");
eq(ds2.idx[0].source, "codex", "去重后者覆盖前者");
// 不同 count 不算重复
eq(dedupeAndStats([S("A", 5, "p", "claude", "2026-03-01")], [S("A", 6, "p", "claude", "2026-03-01")]).stats.segments, 2, "title 同但 count 不同 → 不去重");
// cap 截断
eq(dedupeAndStats([], Array.from({ length: 10 }, (_, i) => S("t" + i, i, "p", "claude", "2026-03-01")), 3).idx.length, 3, "cap 截断到 N");
// 空
eq(dedupeAndStats([], []).stats.segments, 0, "空 → segments 0");
eq(dedupeAndStats([], []).stats.span, "—", "空 → span —");
eq(sessionKey(S("A", 5, "p")), "A|5|p", "sessionKey = title|count|project");

console.log(`\n=== 单元: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
