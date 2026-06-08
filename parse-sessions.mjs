// parse-sessions.mjs —— Claude / Codex 会话解析的【唯一真源】。纯函数,无 DOM / fs / node 依赖。
// 三处共用:loop-server.mjs(import)、connect-helper.mjs(注入)、loop.html(注入)。
// 改这里 = 三处同时改。单测见 test-unit.mjs。

// 取路径最后一段(兼容 / 和 \,容忍结尾分隔符)
export function baseName(p) {
  const s = String(p == null ? "" : p).replace(/[\/\\]+$/, "");
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return i >= 0 ? s.slice(i + 1) : s;
}

// 是否 Codex rollout 格式:文件名 rollout-* 或文本里有 response_item / session_meta
export function isCodexFormat(fname, txt) {
  return /rollout-/.test(fname || "") || /"type"\s*:\s*"(response_item|session_meta)"/.test(txt || "");
}

// Codex 消息内容可能是 string 或 [{text}] 块数组
export function codexText(p) {
  const c = p && p.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((b) => (b && b.text) || "").join("");
  return "";
}

// 解析 Claude jsonl 文本 → {title,count,date,content,project,source} | null(用户消息 < 2 条)
// content = 前 ≤12 条用户消息文本(各截 400 字,总 6000),跳过工具回灌(< 开头)与 Caveat 系统注入。
export function parseClaude(txt, opts) {
  opts = opts || {};
  const tm = String(txt).match(/"aiTitle"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  let title = "(无标题会话)";
  if (tm) { try { title = JSON.parse('"' + tm[1] + '"'); } catch { title = tm[1]; } }
  const count = (String(txt).match(/"role":\s*"user"/g) || []).length;
  if (count < 2) return null;
  const out = [];
  for (const line of String(txt).split("\n")) {
    if (!line) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    const m = d.message; if (!m || m.role !== "user") continue;
    const c = m.content;
    let t = typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (b && b.text) || "").join("") : "";
    t = t.trim();
    if (t && !t.startsWith("<") && !t.startsWith("Caveat")) out.push("用户: " + t.slice(0, 400));
    if (out.length >= 12) break;
  }
  return { title, count, date: opts.date, content: out.join("\n").slice(0, 6000), project: opts.project || "claude", source: "claude" };
}

// 解析 Codex rollout jsonl 文本 → {...} | null。project 取 session_meta.cwd 末段;跳过 # / < 开头(系统/工具注入)。
export function parseCodex(txt, opts) {
  opts = opts || {};
  let count = 0, title = "", cwd = ""; const out = [];
  for (const line of String(txt).split("\n")) {
    if (!line) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    const p = d.payload || {};
    if (d.type === "session_meta" && p.cwd) cwd = p.cwd;
    if (d.type === "response_item" && p.role === "user") {
      const t = codexText(p).trim();
      if (t && !t.startsWith("#") && !t.startsWith("<")) {
        count++;
        if (!title) title = t.slice(0, 50).replace(/\s+/g, " ");
        if (out.length < 12) out.push("用户: " + t.slice(0, 400));
      }
    }
  }
  if (count < 2) return null;
  if (!title) title = cwd ? "(" + baseName(cwd) + ")" : "(Codex 会话)";
  return { title, count, date: opts.date, content: out.join("\n").slice(0, 6000), project: cwd ? baseName(cwd) : "codex", source: "codex" };
}

// 自动识别格式并解析。fname 用于判 Codex + 推断 Claude 的 project(上级目录名)。
export function parseSession(txt, fname, opts) {
  opts = opts || {};
  if (isCodexFormat(fname, txt)) return parseCodex(txt, { date: opts.date });
  const parts = String(fname || "").split("/");
  const project = opts.project || (parts.length > 1 ? parts[parts.length - 2] : "claude");
  return parseClaude(txt, { date: opts.date, project });
}

// ── 上传/合并:去重(title|count|project)+ 统计。纯函数,buildUploadedApp 与单测共用。
export function sessionKey(s) { return s.title + "|" + s.count + "|" + s.project; }

export function dedupeAndStats(base, incoming, cap) {
  cap = cap || 400;
  const seen = new Map((base || []).map((s) => [sessionKey(s), s]));
  (incoming || []).forEach((s) => seen.set(sessionKey(s), s));
  const idx = [...seen.values()].sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, cap);
  const totalMsgs = idx.reduce((n, s) => n + (s.count || 0), 0);
  const times = idx.map((s) => Date.parse(s.date)).filter((n) => n);
  const fmt = (t) => new Date(t).toISOString().slice(0, 7);
  const bySrc = {}; idx.forEach((s) => bySrc[s.source] = (bySrc[s.source] || 0) + 1);
  const stats = {
    segments: idx.length, messages: totalMsgs,
    span: times.length ? fmt(Math.min(...times)) + "–" + fmt(Math.max(...times)) : "—",
    projects: new Set(idx.map((s) => s.project)).size, by_source: bySrc,
  };
  return { idx, stats };
}
