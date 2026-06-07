// ============================================================================
// pi-exec —— 整条闭环唯一调模型的地方(执行引擎)。
//
// 用的是 Pi 工具箱里的【pi-ai · 模型层】= @earendil-works/pi-ai 的 complete()
//   - getModel("openrouter", MODEL) → 选 OpenRouter 上的模型
//   - complete(model, context, {apiKey}) → 一次问、一次答(单轮补全)
//
// 没用【pi-agent-core · agent 运行时】= @earendil-works/pi-agent-core 的 Agent
//   - 那个才是有状态、能工具调用、多轮的 "Pi agent"
//   - 当前闭环每步(蒸馏/结构化/试跑/消费)都是单轮补全,complete() 够用
//   - 要让 mini-app agent 能调工具/多步时,把下面 run() 里的 complete()
//     换成:  new Agent({model, systemPrompt, tools}).run(userInput)  即可
//
// 替掉了 claude -p:这条路 API 化、可部署,不依赖本地 Claude 订阅/CLI。
// ============================================================================
import { getModel, complete, Type } from "@earendil-works/pi-ai";
import { Agent } from "@earendil-works/pi-agent-core";
export { Type };

// ── 统一日志:带时刻 + 毫秒,所有模型调用都看得见进度,不再"黑箱卡住"。 ──
const ts = () => new Date().toISOString().slice(11, 23);
export const log = (...a) => console.log(`${ts()} [pi]`, ...a);
const secs = (t0) => ((Date.now() - t0) / 1000).toFixed(1) + "s";

// ── createAgent:建一个【常驻】Agent 实例(用于 mini-app 多轮会话)。 ──
// 返回 { agent, onText }:agent 跨轮保留状态;调用方自己 subscribe 拿事件流(推 SSE)。
export function createAgent({ systemPrompt, tools = [], model = DEFAULT_MODEL }) {
  const m = getModel("openrouter", model);
  return new Agent({ initialState: { systemPrompt, model: m, tools } });
}

// ── runAgent:真·agent 基座(pi-agent-core)。带工具、多步、自己决定读什么。 ──
// 用于「能力提取」这种需要翻真实历史、不能一次问完的任务。tools = [{name,description,parameters:Type.Object,execute}]
export async function runAgent({ systemPrompt, userInput, tools = [], model = DEFAULT_MODEL, timeoutMs = 0, label = "agent" }) {
  const t0 = Date.now();
  log(`${label} ▶ ${model} · ${tools.length} 工具 · 上限 ${timeoutMs / 1000}s`);
  const m = getModel("openrouter", model);
  const agent = new Agent({ initialState: { systemPrompt, model: m, tools } });
  let buf = "", turns = 0;
  agent.subscribe((ev) => {
    if (ev.type === "message_start" && ev.message?.role === "assistant") { buf = ""; turns++; log(`${label}   · 第 ${turns} 轮思考 (${secs(t0)})`); }
    if (ev.type === "message_update" && ev.assistantMessageEvent?.type === "text_delta") buf += ev.assistantMessageEvent.delta;
  });
  const p = agent.prompt(userInput).then(() => { log(`${label} ✓ ${secs(t0)} · ${turns} 轮 · ←${buf.length}字`); return { text: buf }; });
  if (timeoutMs > 0) {
    let timer;
    const t = new Promise((_, rej) => { timer = setTimeout(() => { try { agent.abort(); } catch {} log(`${label} ⏱超时 ${timeoutMs / 1000}s · ${turns} 轮后中止`); const e = new Error("TIMEOUT"); e.timeout = true; rej(e); }, timeoutMs); });
    try { return await Promise.race([p, t]); } finally { clearTimeout(timer); }
  }
  return await p;
}

const DEFAULT_MODEL = process.env.MODEL || "anthropic/claude-3.5-haiku";

/** 跑一次:systemPrompt + userInput → 最终文本。timeoutMs>0 时超时抛 {timeout:true},绝不无限挂起。 */
export async function run({ systemPrompt, userInput, model = DEFAULT_MODEL, timeoutMs = 0, label = "run", temperature }) {
  const t0 = Date.now();
  log(`${label} ▶ ${model} · 入${(userInput || "").length}字 · 上限 ${timeoutMs ? timeoutMs / 1000 + "s" : "∞"}${temperature != null ? " · T=" + temperature : ""}`);
  const m = getModel("openrouter", model);
  const context = {
    systemPrompt: systemPrompt || "You are a helpful assistant.",
    messages: [{ role: "user", content: userInput }],
  };
  const opt = { apiKey: process.env.OPENROUTER_API_KEY }; if (temperature != null) opt.temperature = temperature; // 提取链显式传 0 去噪
  const p = complete(m, context, opt).then((res) => {
    const text = extractText(res);
    const u = res.usage || {};
    const usage = { input: u.input || 0, output: u.output || 0, total: u.totalTokens || 0, cost: u.cost?.total || 0 };
    const ms = Date.now() - t0;
    log(`${label} ✓ ${secs(t0)} · ←${text.length}字 · ${usage.total}tok $${usage.cost.toFixed(5)}`);
    return { text, raw: res, usage, ms };
  });
  if (timeoutMs > 0) {
    let timer;
    const t = new Promise((_, rej) => { timer = setTimeout(() => { log(`${label} ⏱超时 ${timeoutMs / 1000}s`); const e = new Error("TIMEOUT"); e.timeout = true; rej(e); }, timeoutMs); });
    try { return await Promise.race([p, t]); } finally { clearTimeout(timer); }
  }
  return await p;
}

/** 从 pi-ai 的 AssistantMessage 里抽纯文本(兼容几种形态)。 */
export function extractText(res) {
  if (!res) return "";
  if (typeof res === "string") return res;
  const c = res.content ?? res.message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((b) => (typeof b === "string" ? b : b?.text ?? b?.content ?? "")).join("");
  if (typeof res.text === "string") return res.text;
  return "";
}
