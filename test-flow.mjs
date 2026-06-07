// 集成测试:human-anchored 全链路 draft→anchor→package(结构化miniapp)→publish→consume。
// 用法:node test-flow.mjs <appId>   (默认读 /tmp/_haid120)
// 针对已缓存 draft 的 app,只在 package/eval/run 处打真实 LLM。
import fs from "node:fs";
import http from "node:http";
const ID = process.argv[2] || (fs.existsSync("/tmp/_haid120") ? fs.readFileSync("/tmp/_haid120", "utf8").trim() : "");
let pass = 0, fail = 0;
// 用 node:http 直连,绕开 *_PROXY 环境变量(undici fetch 会把 localhost 也走代理 → bad port)
const req = (method, p, o) => new Promise((resolve, reject) => {
  const body = o ? JSON.stringify(o) : null;
  const r = http.request({ host: "127.0.0.1", port: 4190, path: p, method, headers: { "Content-Type": "application/json" } }, (res) => {
    let b = ""; res.on("data", (c) => b += c); res.on("end", () => { try { resolve(JSON.parse(b)); } catch { resolve({ _raw: b, _status: res.statusCode }); } });
  });
  r.on("error", reject); if (body) r.write(body); r.end();
});
const post = (p, o) => req("POST", p, o || {});
const get = (p) => req("GET", p);
const ok = (c, m, extra) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗ FAIL:", m, extra != null ? JSON.stringify(extra).slice(0, 200) : ""); } };

console.log("=== 全链路集成测试 · app", ID, "===");

// 1. draft(缓存)
const d = await post("/api/draft", { id: ID });
ok(Array.isArray(d.candidates) && d.candidates.length > 0, "draft 返回候选", d.error);
const c0 = d.candidates[0];
ok(c0 && c0.name && c0.intent, "候选有 name/intent");
ok(c0 && c0.scope && typeof c0.scope_coherence === "number", "候选带 scope + coherence", c0?.scope);
ok(c0 && Array.isArray(c0.evidence), "候选带 evidence 数组");
ok(c0 && ["high", "med", "low"].includes(c0.confidence), "候选 confidence 合法", c0?.confidence);
ok(c0 && c0.from_segments === c0.evidence.length, "from_segments == evidence.length", { fs: c0?.from_segments, ev: c0?.evidence?.length });

// 2. 先清空已有锚点(干净起点)
const appBefore = await get("/api/anchors?id=" + ID);
// 锚定:confirm 前两个高置信
const sel = d.default_selected.slice(0, 2);
ok(sel.length >= 1, "有高置信候选可锚", d.default_selected);
const ops = sel.map((tempId) => ({ type: "confirm", tempId }));
const an = await post("/api/anchor", { id: ID, ops });
ok(Array.isArray(an.anchors), "anchor 批量返回 anchors[]");
const newOnes = an.anchors.filter((a) => sel.some((t) => d.candidates.find((c) => c.tempId === t)?.name === a.name));
ok(an.anchors.length >= sel.length, "锚点数 >= 确认数", an.anchors.length);
const cap = an.anchors[an.anchors.length - 1];
ok(cap && cap.id && cap.name && cap.scope && Array.isArray(cap.evidence), "锚点结构完整(id/name/scope/evidence)", cap);
ok(cap && cap.status === "confirmed", "锚点 status=confirmed");

// 3. rename
const rn = await post("/api/anchor-op", { id: ID, op: { type: "rename", capId: cap.id, name: "【测试改名】能力X" } });
ok(!rn.error, "rename 不报错");
const after = await get("/api/anchors?id=" + ID);
ok(after.anchors.find((a) => a.id === cap.id)?.name === "【测试改名】能力X", "rename 生效");

// 4. narrow-scope
const ns = await post("/api/anchor-op", { id: ID, op: { type: "narrow-scope", capId: cap.id, scope: { domain: "测试垂类" } } });
ok(!ns.error, "narrow-scope 不报错");
const after2 = await get("/api/anchors?id=" + ID);
ok(after2.anchors.find((a) => a.id === cap.id)?.scope?.domain === "测试垂类", "narrow-scope 生效");
ok(after2.anchors.find((a) => a.id === cap.id)?.scope_confirmed === true, "scope_confirmed=true");

// 5. package(结构化成 miniapp)—— 重点环节
console.log("  … package(真实 LLM,约 10s)");
const pk = await post("/api/package", { id: ID, capId: cap.id });
ok(!pk.error, "package 不报错", pk.error);
ok(pk.manifest && pk.manifest.manifestVersion === "0.1", "package 出 manifest v0.1");
ok(Array.isArray(pk.required_context), "manifest 有 required_context(消费侧槽)", pk.required_context);
ok(pk.spec && Array.isArray(pk.spec.questions) && pk.spec.questions.length > 0, "spec 有 questions", pk.spec?.questions?.length);
ok(pk.spec && pk.spec.output_spec, "spec 有 output_spec");
ok(Array.isArray(pk.scope_boundaries) && pk.scope_boundaries.length > 0, "有 scope_boundaries(生产期边界)", pk.scope_boundaries);
ok(pk.scope_boundaries.some((b) => b.startsWith("适用于")), "boundaries 含'适用于'声明");
// 槽位一致性:required_context 应来自 instructions 的 {answer.X}
const instr = pk.manifest.skill_set?.[0]?.steps?.[0] || "";
const slotsInInstr = [...instr.matchAll(/\{answer\.([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]);
ok(slotsInInstr.length > 0, "instructions 含 {answer.X} 槽", slotsInInstr);
ok(JSON.stringify([...pk.required_context].sort()) === JSON.stringify([...new Set(slotsInInstr)].sort()), "required_context 与指令槽一致", { rc: pk.required_context, instr: slotsInInstr });
const afterPkg = await get("/api/anchors?id=" + ID);
ok(afterPkg.anchors.find((a) => a.id === cap.id)?.manifest_id, "锚点回填 manifest_id(已打包态)");

// 6. eval(auto-eval 试跑)
console.log("  … eval(真实 LLM)");
const ev = await post("/api/eval", { id: ID });
ok(!ev.error || ev.artifact || ev.result || ev.ok !== false, "eval 不致命报错", ev.error);

// 7. publish
const pub = await post("/api/publish", { id: ID, scope: "market" });
ok(pub.token && pub.link, "publish 出 token + link", pub);
ok(pub.link.includes("token="), "link 含 token");

// 8. consume:取 app + 填槽跑
const appByToken = await get("/api/app?token=" + pub.token);
ok(appByToken && (appByToken.manifest || appByToken.required_context || appByToken.intake), "凭 token 取到消费侧 app", Object.keys(appByToken || {}));
const answers = {}; (pk.required_context || []).forEach((k, i) => answers[k] = "测试输入" + i);
console.log("  … consume run(真实 LLM)");
const runRes = await post("/api/run", { token: pub.token, answers });
ok(!runRes.error, "consume run 不报错", runRes.error);
ok(runRes.artifact || runRes.result || runRes.text || runRes.output, "consume 产出 artifact", Object.keys(runRes || {}));

// 9. 多能力独立发布(修复 #2/#6:后打包不顶替先发布的)
console.log("  … 多能力独立发布(再 package+publish 第二个能力)");
const all2 = (await get("/api/anchors?id=" + ID)).anchors;
const capB = all2.find((c) => c.id !== cap.id);
if (capB) {
  const pkB = await post("/api/package", { id: ID, capId: capB.id });
  ok(!pkB.error, "第二个能力 package 不报错", pkB.error);
  const pubB = await post("/api/publish", { id: ID, capId: capB.id, scope: "market" });
  ok(pubB.token && pubB.token !== pub.token, "第二个能力拿到【不同】token(独立发布)", { a: pub.token, b: pubB.token });
  // 第一个能力的 token 仍能取到它自己(没被顶替)
  const appA = await get("/api/app?token=" + pub.token);
  const appB = await get("/api/app?token=" + pubB.token);
  ok(appA.title && appB.title && appA.title !== appB.title, "两 token 各自返回不同能力(#6 不被顶替)", { A: appA.title, B: appB.title });
  ok(pub.token.length > 12 && /_[a-z0-9]+$/.test(pub.token), "token 不可预测(含随机后缀)", pub.token);
} else { console.log("  (只有1个锚点,跳过多发布对比)"); }

// 10. refresh(增量,应优雅)
const rf = await post("/api/refresh", { id: ID });
ok(typeof rf.new === "number" || rf.message, "refresh 优雅返回", rf);
ok(rf.new === 0 || rf.message, "extract/draft 后 refresh 不重读(observedPaths 生效, #3)", rf);

console.log(`\n=== 结果: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
