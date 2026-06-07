import { run, extractText } from "./pi-exec.mjs";
console.log("model:", process.env.MODEL, "| key present:", !!process.env.OPENROUTER_API_KEY);
try {
  const { text, raw } = await run({ systemPrompt: "你只回一个阿拉伯数字，别的都不说。", userInput: "1+1 等于几？" });
  console.log("文本输出:", JSON.stringify(text));
  if (!text) console.log("原始响应(前400):", JSON.stringify(raw).slice(0,400));
  console.log(text ? "\n✓ Pi + OpenRouter 通了" : "\n⚠ 通了但没抽到文本,看上面 raw 形态");
} catch(e){ console.log("✗ 调用失败:", e.message); }
