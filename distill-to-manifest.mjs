// M3 · 能力封装 —— distill JSON  ->  AgenticAppManifest v0.1
// 桥的咽喉:把 M2 蒸馏出的 agent 定义,翻译成 M4 运行时唯一认的标准件。
// 零依赖、纯函数、可单测。契约对齐 specs/2026-05-28-agentic-app-manifest-a2ui-bridge-spec §2。

/** 决策②:从指令里扫出 {answer.X} 槽 —— 这就是消费侧 intake 要问的字段。
 *  容错漂移形态:{{answer.x}}、{answer_x}、{answer.中文}、空格,统一抽出 key。 */
export function extractSlots(instructions) {
  return [...new Set([...(instructions || "").matchAll(/\{\{?\s*answer[._]\s*([\w一-龥]+)\s*\}?\}/g)].map((m) => m[1]))];
}

/** distill JSON -> AgenticAppManifest v0.1（最小合法版） */
export function distillToManifest(d, ctx = {}) {
  const slug = d.slug || (d.name || "app").toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const title = d.title || d.name || slug;
  const slots = extractSlots(d.instructions); // 决策②

  return {
    manifestVersion: "0.1",
    manifest: {
      mini_app_id: slug,
      name: title,
      version: "0.1.0",
      creator_user_id: ctx.creatorUserId || "",
      source_candidate_id: "cand_" + slug,
      status: "draft", // 人工过目后才改 published
    },
    agent: {
      role: d.role || "assistant",
      goal: d.description || title,
      boundaries: ["只读用户提供的上下文", "不执行破坏性操作"],
      tools: ["readonly_context"],
    },
    capability_basis: {
      name: title,
      repeated_workflow: d.description || "",
      target_user: ctx.targetUser || "unknown",
      recommended_form: "agentic_app",
      confidence: "medium",
      risk_level: "low",
      evidence_refs: [],
      why: d.why || "",
      clear_output: "",
    },
    // 决策①:蒸馏指令(含 {answer.X})整段放 skill_set[0].steps,后面 promptCompiler 填槽
    skill_set: [{ name: title, steps: [d.instructions || ""], stopping_condition: "产出一份 artifact 后结束" }],
    interaction: {
      ui_profile: {
        type: "guided_intake",
        label: title,
        summary: d.description || "",
        components: ["intake_form", "artifact_builder"], // 决策③:MVP 兜底对
      },
      starter_prompts: [],
      required_context: slots, // 决策②:消费侧 intake 字段
      review_questions: [],
    },
    context_contract: { connectors: [], privacy: [] },
    launch_contract: { modes: [{ id: "default", label: "开始", description: "" }], default_mode: "default" },
    llm_boundary: { allowed: [], disallowed: [], requires_confirmation_before: [], risk_level: "low", handoff: "" },
    runbook: { steps: [], checkpoints: [] },
    examples: [],
    safety: { risk_level: "low", disclaimer: "AI 输出仅供参考，请自行核实后使用。" },
    provenance: { evidence_refs: [], source_session_id: ctx.sessionId || "", approved_by: "" },
  };
}

/** 最小 parseManifest:断言必填字段在、类型对(M4 入口校验用) */
export function parseManifest(m) {
  const errs = [];
  const need = (path, ok) => { if (!ok) errs.push(path); };
  need("manifestVersion=0.1", m.manifestVersion === "0.1");
  need("manifest.mini_app_id", !!m.manifest?.mini_app_id);
  need("manifest.name", !!m.manifest?.name);
  need("manifest.status∈{draft,published_private,published}", ["draft", "published_private", "published"].includes(m.manifest?.status));
  need("agent.role", !!m.agent?.role);
  need("agent.goal", !!m.agent?.goal);
  need("skill_set[0].steps 非空", Array.isArray(m.skill_set?.[0]?.steps) && m.skill_set[0].steps.length > 0);
  need("interaction.ui_profile.components 非空", Array.isArray(m.interaction?.ui_profile?.components) && m.interaction.ui_profile.components.length > 0);
  need("interaction.required_context 是数组", Array.isArray(m.interaction?.required_context));
  need("safety.disclaimer", !!m.safety?.disclaimer);
  if (errs.length) throw new Error("manifest 校验失败,缺/错字段: " + errs.join("; "));
  return m;
}
