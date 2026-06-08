#!/usr/bin/env node
// Agora 本机助手 —— 在用户本机用其系统权限读取 ~/.claude + ~/.codex 全部历史,
// 提取精简文本(标题+条数+前若干用户消息),凭一次性配对码上传到 Agora。原始日志不出本机。
// 用法:  curl -fsSL <BASE>/connect.mjs | node - <配对码>
// __BASE__ 由服务器按请求 Host 注入。
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import http from "node:http"; import https from "node:https";
const BASE = "__BASE__";
const code = (process.argv[2] || "").trim().toUpperCase();
const HOME = os.homedir();

// 直接用 node:http/https POST(不走 fetch/undici,避开其代理/“bad port”怪癖)
function postJson(url, obj) {
  return new Promise((resolve, reject) => {
    const u = new URL(url); const lib = u.protocol === "https:" ? https : http;
    const body = Buffer.from(JSON.stringify(obj));
    const req = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: u.pathname + u.search, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": body.length } },
      (res) => { let d = ""; res.on("data", (c) => d += c); res.on("end", () => { let j = {}; try { j = JSON.parse(d); } catch {} resolve({ status: res.statusCode, json: j }); }); });
    req.on("error", reject); req.setTimeout(60000, () => req.destroy(new Error("超时"))); req.write(body); req.end();
  });
}

function walk(dir, out = []) { let e; try { e = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; } for (const x of e) { const fp = path.join(dir, x.name); if (x.isDirectory()) walk(fp, out); else if (x.name.endsWith(".jsonl")) out.push(fp); } return out; }
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };

// 解析器由服务器注入(parse-sessions.mjs 唯一真源);本地运行时此处会被替换成 parseClaude/parseCodex 等。
/*__PARSERS__*/

async function main() {
  if (!code) { console.error("\n  缺配对码。用法:  curl -fsSL " + BASE + "/connect.mjs | node - <配对码>\n"); process.exit(1); }
  const sessions = []; let cN = 0, xN = 0;
  const cRoot = path.join(HOME, ".claude", "projects"), xRoot = path.join(HOME, ".codex", "sessions");
  const D = (f) => new Date(mtime(f)).toISOString().slice(0, 10);
  if (fs.existsSync(cRoot)) for (const f of walk(cRoot)) { try { const s = parseClaude(fs.readFileSync(f, "utf8"), { date: D(f), project: path.basename(path.dirname(f)) }); if (s) { sessions.push(s); cN++; } } catch {} }
  if (fs.existsSync(xRoot)) for (const f of walk(xRoot)) { try { const s = parseCodex(fs.readFileSync(f, "utf8"), { date: D(f) }); if (s) { sessions.push(s); xN++; } } catch {} }
  console.log("\n  Agora 本机助手");
  console.log("  扫到 Claude " + cN + " 段 · Codex " + xN + " 段 · 共 " + sessions.length + " 段");
  if (!sessions.length) { console.error("  没在 ~/.claude / ~/.codex 找到会话(需 ≥2 条用户消息)。\n"); process.exit(1); }
  sessions.sort((a, b) => b.count - a.count);
  const top = sessions.slice(0, 400);
  console.log("  上传到 " + BASE + " …");
  let resp; try { resp = await postJson(BASE + "/api/connect/upload", { code, sessions: top }); }
  catch (e) { console.error("  上传失败(网络):" + (e?.message || e) + "\n"); process.exit(1); }
  if (resp.status >= 300) { console.error("  上传失败:" + (resp.json.error || resp.status) + "\n"); process.exit(1); }
  console.log("  ✓ 完成!已导入 " + resp.json.segments + " 段。回到网页,它会自动进入下一步。\n");
}
main().catch((e) => { console.error("  出错:" + (e?.message || e) + "\n"); process.exit(1); });
