# Agora MVP — Human-Anchored 能力提取 + Agentic mini-app

把创作者的真实 AI 对话历史 → 锚定成能力 → 打包成「轨道上的 agent」mini-app(引导式对话 + 外部工具 + 可见过程)卖给消费者。

## 跑起来
```bash
# .env 需包含:
#   OPENROUTER_API_KEY=sk-or-...
#   MODEL=deepseek/deepseek-v4-pro
./start.sh                     # → http://localhost:4190
```

## 三个入口
- 创作者 5 步:`http://localhost:4190/`
- 锚定(human-anchored):`http://localhost:4190/anchor?id=<appId>`
- 消费者 agentic mini-app:`http://localhost:4190/miniapp?token=<token>`

## 关键模块
- `loop-server.mjs` 主后端(导入/草稿/锚定/打包/发布/消费 + mini-app SSE 会话)
- `pi-exec.mjs` 执行引擎(Pi + OpenRouter:run/runAgent/createAgent)
- `anchor-lib.mjs` 纯函数(firstJson/computeScope/compile,有单测)
- `distill-to-manifest.mjs` 能力→AgenticAppManifest
- `anchor.html` 锚定 UI / `miniapp.html` 消费侧 agentic UI / `loop.html` 创作者 5 步
- 测试:`node test-unit.mjs`(25)、`node test-flow.mjs`(全链路 38)
- 设计与方案见 `docs/`

## 注意
- 外网需走代理(本机 `127.0.0.1:7897`);fetch_url 走 curl 以使用代理。
- **别放在 iCloud 同步目录**(Desktop/Documents)——会驱逐 node_modules 致 import 卡死。
