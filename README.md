# Agora MVP

把你真实的 AI 对话历史 → **锚定**成你反复在做的"能力" → **打包**成一个被良好 UI 包裹的 **agentic mini-app**(引导式表单 + 可见的多步工作 + 外部工具 + 产物上微调)。

> 本项目目前是**本机运行**:它读取你这台电脑上的会话历史(`~/.claude/projects`、`~/.codex/sessions`、opencode),所以每个人在自己机器上跑、导入自己的 session。中心托管站读不到你本地文件——见文末「关于公网托管」。

---

## 5 分钟跑起来

```bash
git clone <repo-url> agora && cd agora
npm install                       # 装依赖(pi-ai / pi-agent-core)
cp .env.example .env              # 填入 OpenRouter key(自备或找 owner 要)
npm run doctor                    # 环境自检(可选)
npm start                         # → http://localhost:4190
```
需要:**Node ≥ 20**(`--env-file` 要求)、一个 **OpenRouter API key**(https://openrouter.ai/keys)、`curl`(外部读取工具用)。
> 缺 .env / Node 太低时 `npm start` 会给出可读提示;`npm run doctor` 可先自检。

---

## 体验完整链路

打开 **http://localhost:4190** ,走创作者 5 步,或分段直达:

| 入口 | URL | 干嘛 |
|---|---|---|
| 创作者 5 步 | `/` | 总入口 |
| **① 一键导入 + 锚定** | `/anchor?id=<appId>` | 导入你**自己的** session → 草稿能力 → 确认/改名/打包 |
| **② 消费 agentic mini-app** | `/miniapp?token=<token>` 或 `/consume?token=` | 别人(或你)用打包好的 mini-app |

**典型流程**:
1. 进 `/`,点「一键导入全部对话历史」——**自动**扫你本机 Claude/Codex/opencode 历史(这步我们替你做,不用手动整理)。
2. 进锚定页:系统读真实会话、归纳出你反复做的能力(带证据 + 适用范围),你勾选/改名/删。
3. 对某个能力点「打包成 mini-app」→ 生成运行规范 → 发布,拿到一个 `/miniapp?token=` 链接。
4. 打开那个链接 = 一个 agentic mini-app:**结构化表单一次填全 → agent 可见地干活(会调 fetch_url 等工具)→ 出产物 → 在产物上对话微调**。

没有 `~/.claude` 历史?在导入页用「粘贴」方式喂一段对话也能跑。

---

## 改代码(给同事)

| 文件 | 作用 |
|---|---|
| `loop-server.mjs` | 主后端:导入/草稿/锚定/打包/发布 + mini-app SSE 会话(`/api/miniapp/*`) |
| `pi-exec.mjs` | 执行引擎(Pi + OpenRouter):`run` 单次 / `runAgent` / `createAgent` 常驻 agent |
| `anchor-lib.mjs` | 纯函数(firstJson / computeScope / compile),有单测 |
| `distill-to-manifest.mjs` | 能力 → AgenticAppManifest |
| `loop.html` | 创作者 5 步 UI · `anchor.html` 锚定 UI · `miniapp.html` 消费侧 agentic UI |
| `docs/` | 全部设计/调研/技术方案(含 raw→能力提取、crune 研究、agentic mini-app hybrid) |

测试:
```bash
npm test               # 单元(纯函数,25 例)
node test-flow.mjs     # 全链路集成(draft→anchor→package→publish→consume,需 server 在跑)
```

---

## 已知约束 / 坑

- **外网走代理**:若你的机器需要代理才能上网,LLM 调用与 `fetch_url` 依赖系统/`curl` 的代理设置(`HTTPS_PROXY`)。普通直连网络无需配置。
- **别放 iCloud 同步目录**(macOS Desktop/Documents):会把 `node_modules` 离线化导致 import 卡死。放 `~/dev` 之类即可。
- **会话状态**在内存(mini-app session)+ `apps-db.json`(已 gitignore),重启服务即清。

---

## 关于公网托管(为什么现在是本机跑)

mini-app 的导入读的是**用户本机**的 session 文件。要做成"打开一个公网网址、所有人用同一个站"需要额外:① 用户**导出 + 上传** session(而非读本地 FS);② 服务端处理上传文件;③ 共享/各自的 API key 管理;④ 部署。这是后续工作。当前形态(本机 clone 跑)已能完整体验链路并改代码。

---

🤖 开发于 Claude Code。
