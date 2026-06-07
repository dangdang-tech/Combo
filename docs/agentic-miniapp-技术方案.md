# Agentic mini-app · 技术方案(消费侧:引导式对话 + 外部工具)

> 目标:把 mini-app 从「填表→一次性 run()→吐 markdown」升级成 **「轨道上的 agent,被良好 UI 包裹」**——有状态多轮、过程可见、能在 scope/安全边界内调真工具、可澄清、可迭代。
> 已定决策:**引导式对话** + **v1 直接含外部工具**。
> Figma:文件 `XwOk3OdwHGSt6gviqS2Doy` 页 `▶ MiniApp · Agentic 消费体验`(入口 477:65 / 引导对话 481:65 / 工作态 483:65 / 澄清 488:65 / 产出 495:65 / 迭代 498:65 / 越界 500:65)。
> 代码落点:`~/Desktop/Agora/code/mvp/`。复用基座 `pi-exec.runAgent`(pi-agent-core,有状态 Agent + 工具 + 事件流)。

---

## 0. 一句话架构

消费侧不再走单次 `run()`,而是**每个 mini-app 会话 = 一个常驻的 pi-agent-core Agent 实例**(轨道由 manifest 定义),通过 **SSE 把 agent 的事件流推给浏览器**(可见工作),agent 可调 **`ask_user`/`fetch_url`/`read_text` 工具**(scope+安全闸),消费者多轮续聊微调(`agent.prompt()` 续上)。

```
浏览器(对话流UI)  ⇄  /api/miniapp/*  ⇄  会话Map{sessionId→Agent实例}
   │  SSE 事件流(message/tool/ask/artifact)        │
   │  ──turn(消息)──▶                               agent.prompt() 跑 agentic loop
   │  ◀──events──(step/tool-chip/ask/artifact)──    工具:ask_user / fetch_url / read_text
   │  ──answer(澄清)──▶ 解析 pending promise         系统提示=manifest 轨道+scope+safety
```

---

## 1. 会话模型(有状态)

服务端维护 `sessions: Map<sessionId, Session>`:
```ts
Session {
  id, token,                 // 来自已发布 token(per-cap)
  manifest,                  // 该能力的 manifest(轨道:role/goal/boundaries/skill_set/tools/scope)
  agent,                     // pi-agent-core Agent 实例(常驻,承载多轮状态)
  sse,                       // 当前挂着的 SSE response(可空)
  pendingAsk: Map<askId, resolve>,  // ask_user 等待消费者回答的 resolver
  artifact,                  // 最近一版产物(+ 历史版本,迭代用)
  scope,                     // manifest.agent.boundaries / scope
  createdAt, lastActiveAt
}
```
- 生命周期:`/start` 建;空闲 TTL(如 30min)回收;`agent.abort()` 可叫停(对应 UI"暂停")。
- 多轮:每条消费者消息 → `agent.prompt(msg)`,Agent 自己保留对话历史 → 迭代"更短/聚焦X"不重来。

---

## 2. 工具(v1 含外部工具,全部过 scope/安全闸)

`buildMiniappTools(session)` 返回:

| 工具 | 作用 | 闸门 |
|---|---|---|
| **`ask_user`** | agent 反问消费者一个结构化澄清(问题 + 可选项),暂停推进直到回答 | 无(纯交互) |
| **`fetch_url`** | 读取消费者提供的 URL 文本(README/官网/BP) | 仅 http(s);**SSRF 闸**:拒内网/localhost/非常规端口;超时 8s;截断 ~8k 字;只读 |
| **`read_text`** | 接收消费者粘贴的长文本片段(作为上下文) | 截断;只读 |
| (v2) `read_file` | 读消费者上传文件 | 类型/大小白名单 |

**实现要点**:
- `ask_user.execute()` 返回一个 **Promise**,把 `resolve` 存进 `session.pendingAsk[askId]`,并经 SSE 发 `ask` 事件给前端;`POST /api/miniapp/answer` 到达时 `resolve(answer)` → agent 续跑。
- `fetch_url.execute()`:URL 白/黑名单校验(`new URL`,拒 `localhost/127./10./192.168./169.254/[::1]`、非 80/443 端口)→ `fetch`(超时 race)→ 抽正文截断 → 返回 `{content}`;失败返回可读错误(agent 据此告知消费者)。
- 每个工具 execute 内 `log()` + 经 SSE 发 `tool` 事件(name/target/status/why),驱动前端工具 chip 与"为什么调它"。

**scope 闸**:systemPrompt 内写死 `agent.boundaries`(=我们做的 scope 边界)+ 指令"输入疑似超出适用范围时,先用 ask_user 或 scope-warn 告知消费者再决定是否继续";另在 `/start` 时对首条输入做一次轻量 scope 预检(可选)。

---

## 3. systemPrompt(轨道 = manifest 编译)

`compileAgentSystem(manifest)`:
```
你是「{role}」。目标:{goal}。
【固定轨道】按以下步骤推进(这是创作者定义的工作流,不要偏离):
{skill_set[0].steps 拆成的多步,或 review_questions 作为引导收集项}
【适用范围/边界】{agent.boundaries 列表};超出范围要诚实告知消费者(scope-warn),不要硬做。
【交互方式】引导式:一次只问 1-2 个问题,收集够了再动手;动手时把你在做什么、调了什么工具说清楚;
信息有歧义/分叉用 ask_user 反问;产出后支持消费者多轮微调,复用上一稿、不重来。
【工具】ask_user / fetch_url / read_text:只在边界内、为达成目标而用,并说明为什么调。
最终给出 artifact(markdown),并简述你做了什么、在什么边界内。
```
- 注意:这把原来 `compile()` 的单次填槽,升级为"引导 agent 自己收集"——`required_context` 改作"引导项清单"喂给 agent,而非前端一次性表单(契合引导式对话)。仍保留 `compile` 的安全网思想:消费者给的所有输入都进上下文,不丢。

---

## 4. SSE 事件协议(可见工作)

`GET /api/miniapp/stream?sessionId=` 建 SSE;turn/answer 触发的 agent 事件按类型推:

| event | 载荷 | 前端渲染(对照 Figma) |
|---|---|---|
| `message_delta` | {text} | agent 气泡流式文字 |
| `step` | {label, state:✓/⟳/○} | 工作卡微步骤清单 + 顶部 step-rail 推进 |
| `tool` | {name, target, status, why} | 🔧 tool-chip(读取中→✓)+ 折叠"为什么调它" |
| `ask` | {askId, question, options?} | gold 澄清气泡 + 大号单选 + 暂停条 |
| `artifact` | {markdown, version} | 产物锚点卡(+ 版本切换/ diff) |
| `done` | {} | 收尾,显示迭代 chips |
| `scope_warn` | {msg} | 非阻断越界提示条 |

实现:`agent.subscribe(ev=>...)` 把 pi-agent-core 事件映射成上面这些,写进当前 SSE。`step`/`tool`/`ask`/`scope_warn` 由工具 execute 主动发;`message_delta` 来自 assistant 文本增量;`artifact` 在最终(或 agent 标记)时发。

---

## 5. API(消费侧新增,旧 /api/run 保留给创作者 eval)

| 方法 路径 | 作用 |
|---|---|
| `POST /api/miniapp/start` {token} | 凭已发布 token 建会话 → {sessionId, title, scope, starters, steps} |
| `GET /api/miniapp/stream?sessionId` | SSE 长连,推 agent 事件 |
| `POST /api/miniapp/turn` {sessionId, message} | 一轮:`agent.prompt(message)`,事件走 SSE |
| `POST /api/miniapp/answer` {sessionId, askId, answer} | 解析 pending ask_user,agent 续跑 |
| `POST /api/miniapp/abort` {sessionId} | `agent.abort()`(UI 暂停/重开) |

复用 `findPublished(token)` 取 manifest;消费仍要求 token+已发布(沿用我们修过的鉴权)。

---

## 6. 前端(消费侧改写,对照 Figma 7 屏)

新 `miniapp.html`(或重写 loop.html 的 consumer 视图),严格照 Figma:
- 共用对话骨架:顶栏(能力名+scope chip+暂停/重开)+ 常驻 step-rail + 对话流 + composer。
- EventSource 消费 SSE → 渲染:agent 气泡 / 工作卡(step+tool-chip+为什么调它)/ 澄清气泡(单选→/answer)/ 产物锚点卡(导出/版本/diff)/ 越界条。
- 入口屏(477:65):scope badge + step 预览 + starter(点击=对话第一条消息)+ "开始对话"。
- 迭代:产物下方 chips("更短/聚焦X/换角度")+ composer 自由输入 → /turn 续聊 → artifact v2(版本切换)。

---

## 7. 安全 / 韧性

- **SSRF**:fetch_url 严格校验(见 §2),这是引入外部工具后最大风险点。
- **超时/中止**:每工具 + 每 turn 有超时;abort 可中止;SSE 断线前端自动重连(EventSource 默认重连)。
- **降级**:pi-agent-core 出错 → 退回单次 `run()` 出一版 artifact(不至于全黑);工具失败 → agent 告知消费者并继续。
- **成本**:多轮 agent 比单次贵;给会话 turn 数/工具调用次数软上限;metrics 记 token。
- **隔离**:工具只读、只在 scope 内;不执行破坏性操作(boundaries 已声明)。

---

## 8. 里程碑(代码阶段,Figma 已完成)

- **M1 会话基座**:sessions Map + `/start` + `/stream`(SSE) + `/turn` 走 runAgent,先只 message_delta(纯对话,无工具)。验收:能多轮对话、流式可见。
- **M2 工具 + 可见**:ask_user + fetch_url + read_text + step/tool 事件。验收:agent 调 fetch_url 读真链接,前端显示 tool-chip + 为什么调它;ask_user 暂停/答复续跑。
- **M3 产物 + 迭代**:artifact 事件 + 版本/diff + 迭代 chips。验收:产出后"更短"能有状态更新成 v2。
- **M4 scope 闸 + 安全**:SSRF 校验 + 越界提示 + 降级。验收:内网 URL 被拒;越界输入有提示;agent 出错有兜底。
- **M5 前端落地 Figma + E2E**:7 屏对照实现 + 浏览器走通 + 集成/单元测试。验收:全链路通畅。

---

## 9. 待拍板

1. **前端**:新建 `miniapp.html` 独立页(推荐,干净)vs 重写 loop.html consumer 视图。→ 倾向独立页。
2. **SSE vs 轮询**:SSE(推荐,流式可见最自然)vs 简单轮询。→ 倾向 SSE。
3. **required_context 角色**:改为"引导项清单"喂 agent(契合引导式)vs 保留入口表单先收一遍再进对话。→ 倾向纯引导(agent 自己问),入口只给 starter。
4. **会话持久化**:内存 Map(MVP 够)vs 落盘恢复。→ 倾向内存起步。
