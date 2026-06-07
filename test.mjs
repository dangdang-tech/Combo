// M3 单测:distill JSON fixture -> manifest -> parseManifest 零报错 + 槽提取正确
import { distillToManifest, parseManifest, extractSlots } from "./distill-to-manifest.mjs";
import { readFileSync } from "node:fs";

const d = JSON.parse(readFileSync(new URL("./fixtures/research-to-figma-app.distill.json", import.meta.url)));

console.log("输入 distill JSON:", d.title, "| slug:", d.slug);
const slots = extractSlots(d.instructions);
console.log("① 槽提取:", slots);

const m = distillToManifest(d, { creatorUserId: "u_wayne", sessionId: "s_demo_001" });
parseManifest(m); // 抛错则测试失败
console.log("② parseManifest: ✓ 通过,manifest 合法");

// 关键断言
const ok1 = JSON.stringify(m.interaction.required_context) === JSON.stringify(slots);
const ok2 = m.skill_set[0].steps[0].includes("{answer.");
const ok3 = m.manifest.status === "draft" && m.manifestVersion === "0.1";
console.log("③ required_context 与槽一致:", ok1);
console.log("④ skill_set 保留带槽指令模板(promptCompiler 可填):", ok2);
console.log("⑤ status=draft / version=0.1:", ok3);

if (!(ok1 && ok2 && ok3)) { console.error("\n✗ 断言失败"); process.exit(1); }
console.log("\n✓✓ M3 通了:distill → 合法 manifest,数据契约成立。");
console.log("\n--- manifest 关键部分预览 ---");
console.log(JSON.stringify({
  mini_app_id: m.manifest.mini_app_id, name: m.manifest.name, status: m.manifest.status,
  "agent.role": m.agent.role, "agent.goal": m.agent.goal,
  required_context: m.interaction.required_context,
  components: m.interaction.ui_profile.components,
  "skill_set[0].steps[0] (前80字)": m.skill_set[0].steps[0].slice(0, 80) + "...",
}, null, 2));
