// 纯函数库(无副作用,可单元测试)。loop-server 引用,test-unit 单测。
// 括号配平 JSON 提取:从第一个 [ 或 { 起,认字符串/转义,找真正闭合,避免对象数组被吃掉外层括号。
export const firstJson = (s) => {
  s = String(s).replace(/```(?:json)?/gi, "");
  const start = s.search(/[\[{]/); if (start < 0) throw new Error("没解析出 JSON: " + s.slice(0, 200));
  const open = s[start], close = open === "[" ? "]" : "}";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return JSON.parse(s.slice(start, i + 1)); }
  }
  throw new Error("JSON 括号未闭合: " + s.slice(start, start + 200));
};

// promptCompiler:把用户答案灌进指令模板 {answer.X};带安全网,未被槽位消费的答案显式附末尾,绝不静默丢弃。
export function compile(manifest, answers) {
  const slots = manifest.interaction.required_context || [];
  const qs = manifest.interaction.review_questions || [];
  let sys = manifest.skill_set?.[0]?.steps?.[0] || "";
  const used = new Set();
  for (const slot of slots) { if (sys.includes("{answer." + slot + "}")) used.add(slot); sys = sys.replaceAll("{answer." + slot + "}", (answers?.[slot] ?? "") || ("（" + slot + "）")); }
  const extra = Object.entries(answers || {}).filter(([k, v]) => v != null && String(v).trim() && !used.has(k));
  if (extra.length) {
    sys += "\n\n【用户补充输入】\n" + extra.map(([k, v]) => {
      const qi = slots.indexOf(k); const label = (qi >= 0 && qs[qi]) ? qs[qi] : (/^q\d+$/.test(k) && qs[+k.slice(1)] ? qs[+k.slice(1)] : k);
      return `- ${label}: ${v}`;
    }).join("\n");
  }
  return sys;
}

// 适用范围:对一组 observation 的 input_features 取众数 + 一致度(众数占比的几何平均)。
export function computeScope(obsList) {
  const dims = ["language", "domain", "input_type", "scale"];
  const scope = {}; const ratios = [];
  for (const d of dims) {
    const counts = new Map();
    for (const o of obsList) { const v = (o.input_features?.[d] || "").trim(); if (!v) continue; counts.set(v, (counts.get(v) || 0) + 1); }
    let mode = "", best = 0, total = 0;
    for (const [v, c] of counts) { total += c; if (c > best) { best = c; mode = v; } }
    scope[d] = mode || "未知";
    if (total > 0) ratios.push(best / total);
  }
  const coherence = ratios.length ? Math.pow(ratios.reduce((a, b) => a * b, 1), 1 / ratios.length) : 0;
  scope.preconditions = []; scope.out_of_scope = [];
  return { scope, coherence: +coherence.toFixed(3) };
}
