// ============================================================================
// extract-experience.mjs —— 特性2:从【真实 session】萃取经验体(ExperienceBody)。
//
// 这是我们和同事 No-LLM demo 的核心差异化:demo 完全绕过「从真实判断里抽经验」,
// 它的所谓经验是手填模板;我们用一次 LLM 调用,专门萃取两样 demo 拿不出的东西:
//   1) 带【优先级】的判断守则(guardrail.priority):谁压谁,冲突时听谁的。
//   2) 带【证据指针】的案例(case.evidenceRef):每个判断指回 session 里的具体行/片段,可追溯。
//
// 产物 schema 与 fixtures/experience-career.json 完全一致,因此能被 engine.mjs 直接
// compileSystemPrompt / 塞进 Engine 跑。run 依赖注入(便于测试 stub),默认取 pi-exec.run。
// ============================================================================
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { run as defaultRun } from "../pi-exec.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dir, "fixtures/experience-extracted.json");

const EXTRACT_SYSTEM = [
  "你是一名「经验萃取师」。给你一段某个人在某领域反复做判断的真实 session(对话/工作记录),",
  "你的任务是抽出这个人【可复用的决策模式】——不是事实、不是流水账,而是品味、守则、案例。",
  "",
  "你必须特别专注于两样东西(这是萃取的重点,做不出来就算失败):",
  "  1) 带【优先级】的判断守则(guardrail):找出此人明确表达过『谁压谁/冲突时听谁』的硬规则,",
  "     用 priority 从 1 开始升序编号(1=最高,压一切)。例如『倦怠一票否决,压薪资也压学习曲线』。",
  "  2) 带【证据指针】的案例(case):每个案例必须有 situation/decision/why,并且 evidenceRef 指回",
  "     session 里支撑它的具体行号或片段标识(例如 'L14' 或 'L22-L31'),保证可追溯、不是你编的。",
  "",
  "另外抽 2-3 条 taste(偏好/品味,无优先级)。所有 body/situation/why 用第一人称、贴近此人原话的口吻。",
].join("\n");

function buildUserPrompt(sessionText, ownerName) {
  return [
    `这是 ${ownerName || "这个人"} 的一段真实 session,行首的 [Lxx] 是行号,evidenceRef 就引用这些行号:`,
    "<<<SESSION",
    sessionText,
    "SESSION",
    "",
    "请只输出一个 JSON 对象(可包在 ```json 代码块里),schema 如下,不要任何额外解释:",
    "{",
    '  "experienceId": "exp_xxx_v1",',
    '  "ownerName": "此人的名字或代称",',
    '  "title": "一句话概括这是哪方面的判断力",',
    '  "stance": "collaborator",',
    '  "expectedOutput": { "type": "diagnostic_matrix" },',
    '  "blocks": [',
    '    { "id": "taste1", "kind": "taste", "label": "短标签", "body": "偏好原话口吻" },',
    '    { "id": "g1", "kind": "guardrail", "priority": 1, "label": "短标签", "body": "硬规则,写清它压过什么" },',
    '    { "id": "c1", "kind": "case", "label": "短标签", "situation": "情景", "decision": "决定", "why": "为什么(命中哪条守则/品味)", "evidenceRef": "L14" }',
    "  ]",
    "}",
    "要求:至少 2 条 taste、至少 2 条带 priority 的 guardrail、至少 2 个带 evidenceRef 的 case。",
    "guardrail 的 priority 必须是 1,2,3… 连续升序,体现真实的压制关系。",
  ].join("\n");
}

// 从模型文本里抠出 JSON(优先 ```json fenced,否则第一个 {...})。
function parseJsonFromText(text) {
  const fenced = [...(text || "").matchAll(/```json\s*([\s\S]*?)```/g)];
  if (fenced.length) { try { return JSON.parse(fenced[fenced.length - 1][1].trim()); } catch {} }
  const s = (text || "").indexOf("{"), e = (text || "").lastIndexOf("}");
  if (s >= 0 && e > s) { try { return JSON.parse(text.slice(s, e + 1)); } catch {} }
  throw new Error("extractExperience: 模型输出里找不到合法 JSON");
}

// 兜底规整:补 id、保证 guardrail 有 priority、case 有 evidenceRef,使产物对 engine 一定可编译。
function normalize(exp) {
  if (!exp || !Array.isArray(exp.blocks)) throw new Error("extractExperience: 产物缺少 blocks 数组");
  exp.experienceId ||= "exp_extracted_v1";
  exp.ownerName ||= "这位创作者";
  exp.stance ||= "collaborator";
  exp.expectedOutput ||= { type: "diagnostic_matrix" };
  let nT = 0, nG = 0, nC = 0;
  for (const b of exp.blocks) {
    if (b.kind === "taste") b.id ||= `taste${++nT}`;
    else if (b.kind === "guardrail") {
      b.id ||= `g${++nG}`;
      if (typeof b.priority !== "number") b.priority = ++nG; // 没给优先级则按出现顺序补
    } else if (b.kind === "case") {
      b.id ||= `c${++nC}`;
      b.evidenceRef ||= "L?"; // 证据指针缺失时占位,提示需回填(正常 prompt 会要求填)
    }
  }
  return exp;
}

/**
 * 从一段 session 文本萃取经验体。
 * @param {string} sessionText  真实 session 全文(行首带 [Lxx] 行号最佳,便于 evidenceRef 引用)
 * @param {{run?:Function, ownerName?:string, model?:string, timeoutMs?:number, write?:boolean}} opts
 *        run: 注入的模型调用,签名 ({systemPrompt,userInput,temperature,...})→{text};默认 pi-exec.run。
 * @returns {Promise<ExperienceBody>}  schema 同 fixtures/experience-career.json
 */
export async function extractExperience(sessionText, opts = {}) {
  const run = opts.run || defaultRun;
  const ownerName = opts.ownerName || "老周";
  const { text } = await run({
    systemPrompt: EXTRACT_SYSTEM,
    userInput: buildUserPrompt(sessionText, ownerName),
    temperature: 0, // 萃取要稳,去噪
    timeoutMs: opts.timeoutMs ?? 90000,
    model: opts.model,
    label: "extract",
  });
  const exp = normalize(parseJsonFromText(text));
  if (opts.write !== false) {
    try { writeFileSync(OUT_PATH, JSON.stringify(exp, null, 2) + "\n", "utf8"); } catch {}
  }
  return exp;
}

export { OUT_PATH };
