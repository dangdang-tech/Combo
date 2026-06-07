# Agora 模块地图

> 把整个产品拆成 10 个模块、3 组。基于对设计稿 / 工程 specs / 已落地代码 / AVM 地基的深读。
> 配套:`Agora-MVP-开工方案.md`(整体方案)、`Agora-M3-能力封装-展开.md`(桥的咽喉模块详解)。

## 核心判断
两头都是真的,只缺中间一座桥:
- **M1 采集 / M2 蒸馏 / M4 运行时** —— 已经是能跑的真代码。
- **M3 能力封装 / M5 渲染** —— 桥的两块新东西,补上主轴就通。
- 不要平均用力,火力集中在 **M3 + M5**。

---

## 一、链路骨干(价值链主轴 · 这 5 个串起来 = 整个产品)

| # | 模块 | 职责 | 现状 | 怎么推进 |
|---|---|---|---|---|
| **M1** | 采集 Capture | 真实工作痕迹/对话 → raw 包 | ✅ 真(`tools/raw-capture.js`) | 云端化 + 支持"粘贴/上传对话"来源 |
| **M2** | 蒸馏 Distill | raw → 干净 agent 定义(带 `{answer.X}`) | ✅ 真但依赖本地 claude(`tools/distill.js`) | 云端化 + 多 fixture 验质量 + capability 三分类 |
| **M3** | 能力封装 Manifest | distill 输出 → `AgenticAppManifest v0.1` 标准件 | 📋 纸上 spec | **写 distill→manifest 适配器(start-here)** ← 桥的咽喉 |
| **M4** | 运行时 Runtime | manifest+填槽 → 创作者 Host 上真跑 → 流式产物 | ✅ 真且上线(Ralphloop `submitFriendTaskV1` + 3 adapter) | promptCompiler 填槽 + 限流熔断 |
| **M5** | 生成式 UI Render | agent 输出 → 受控渲染(表单/卡片/评分) | 🟡 mock(agora-demo)+ 注册表 spec | intake_form + artifact_builder 兜底对 → componentRegistry |

## 二、两侧门面

| # | 模块 | 职责 | 现状 | 怎么推进 |
|---|---|---|---|---|
| **M6** | 创作侧 Builder | 创作者不写命令,把对话变成可发布 miniapp | 🟡 mock(creator 3步)+ spec(io-contract 6阶段) | RawInputImport → manifest review → publish |
| **M7** | 消费侧 Consumer | 逛市集/发现/打开/产物/分享/定价 | 🟡 部分真(marketplace/pricing/discovery JS 真)+ 详情页静态 | 接真 manifest 目录 + 登录/"装上"态 |

## 三、横切支撑

| # | 模块 | 职责 | 现状 | 怎么推进 |
|---|---|---|---|---|
| **M8** | 评测门禁 Eval/Gate | 上架前自动评测 + 发布门禁 | 📋 spec | smoke gate → 真 eval |
| **M9** | 安全信任 Security | 凭据净化 / 限流 / 跨机失真 | 📋 spec(buildspec §⑤) | secretscan(P0 邻近,**不可拖**) |
| **M10** | 结算 Settlement | 定价/抽成/run 计费/分账 | 🟡 mock(pricing 计算器是真 JS) | MVP 不碰,最后接计费后端 |

---

## 推进顺序(怎么逐个模块往前拱)

```
第一波(打通主轴 = MVP P0):  M3 + M5 兜底版  ──缝接──►  已有的 M1·M2·M4
                              （新写咽喉）       （复用真资产）
第二波(让它可信):            M9 安全(凭据净化)  +  M5 升级(结构化产物)
第三波(让两侧能自助):        M6 创作侧自助       +  M7 消费侧接真目录
第四波(向规格收敛):          M8 门禁  +  M10 结算  +  registry/多 app
```

每一波都跑在上一波打通的真链路上逐步加厚,不另起炉灶。
