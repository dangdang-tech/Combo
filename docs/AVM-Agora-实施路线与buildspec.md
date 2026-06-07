# AVM → Agora · 5 条路线 build spec + 实施路线图

> ultracode 产出:5 个 agent 基于 AVM 真实代码(/tmp/avm-src)各写一份可照敲的 build spec + 1 个 agent 合成统一路线。所有 spec 落到真实文件/结构体/命令。

---
## 〇、实施路线图(先读这个)

### 整体策略
这 5 个实验合起来是一条「从单机 AVM-core 工具，长成 Agora 三层平台」的演进:分发层(①远程 registry)、客观层(②runlog 评测/反馈回流)、护城河证明层(③跨 runtime matrix)、消费层(④Mini App 薄壳)、信任层(⑤安全闸)。核心策略不是新写一套系统,而是在已落地的 .avm.zip export/install + capstore 内容寻址 + runs.jsonl 真实日志 + 四态 MappingStatus 这四个既有原语之上,只做「新增、不改主链路」的薄层挂载,把单机工具的四个既有事实——包格式、内容寻址 ID、真实调用日志、跨 runtime 映射——分别升级成平台的四个市场原语:可寻址的分发单元(role@ver)、可信任的安全裁决(PASS/WARN/BLOCK)、可比较的客观信号(成功率/复用率/thumbs)、可消费的产品形态(params→表单→render)。关键耦合点是:① 定义了 role@ver 身份/版本寻址,③④⑤都要复用这个身份;⑤ 的安全裁决必须前置成为 ① 分发的准入门,否则 registry 会把明文凭据广播出去;② 的客观信号最终要喂回 ① 的 search 排序和 ④ 的消费选择。因此正确的演进不是 5 个并行实验,而是「先把可寻址+可信任的分发底座建对,再在其上挂客观信号与消费形态」。

### 推荐实施顺序

| 步 | 实验 | 为什么是这个顺序 | 依赖 |
|---|---|---|---|
| 1 | ⑤ 安全闸 (secretscan + inspect PASS/WARN/BLOCK + export 净化) | 必须最先做。一旦 ① registry 上线,任何带明文 MCP token 的包都会被全网广播,这是不可逆的 P0 凭据泄漏。export 净化(净化率 100%)和 inspect 裁决是分发的准入前置条件,而非事后补丁。它是纯函数单测(looksSecret/SanitizeMCPConfig/ScanCapBlob/verdictFor),不依赖任何其他实验,可独立交付且风险最低,先建立信任原语。 | 无(基于已有 packageio.ReadHandle.Open / Packages.Export gather / MCPConfigV1.Env) |
| 2 | ① AVM Hub 远程 registry (publish/search/install role@ver + index.json + RegistryService) | 分发是 Agora 的骨架,所有市场行为都挂在 role@ver 寻址上。放在 ⑤ 之后,这样 publish 可以强制调用 ⑤ 的 inspect:Verdict=block 拒绝发布,把安全裁决变成分发管线的硬门。它定义了 RegistryEntry/index.json 这个跨实验复用的身份+版本+元数据 schema,是后续 ②③④ 共享的寻址基础。 | ⑤(publish 前置 inspect 裁决);复用已有 packageio 校验 / capstore 内容寻址 / Packages.Install |
| 3 | ③ 跨 runtime matrix 证明 Demo (avm matrix + MatrixReport/四态对照表) | effort 最小(S),且零修改既有 driver——三个 driver 的 Plan() 已生成 FieldMapping,只是聚合投影。它产出护城河证据(同一定义跨 runtime 可解释),这张表/JSON 直接进 pitch deck 和创作者反应测试,是验证『为什么要上 registry』的市场信号采集器。放在 ① 之后,因为 demo 里跑的 agent 最好已能从 registry install,但技术上不强依赖,可与 ① 并行。 | 弱依赖 ①(matrix 演示的 agent 来自 registry install 更有说服力);技术上仅复用 RunService.Preview / Diagnostics.Runtimes / 四态 MappingStatus |
| 4 | ② runlog 评测 v0 (leaderboard 成功率/复用率 + score thumbs 反馈 hook) | 客观层。必须在 registry(install→run 产生真实 runs.jsonl)和 matrix(跨 runtime 复用率口径)之后,因为榜单的『复用率』口径要和 capstore 内容寻址去重、matrix 的 runtime 维度对齐才有意义。它把客观信号从真实调用回流,最终喂给 ① 的 search 排序。不改 run 主链路,只加 AppendFeedback + EvalService,风险可控,适合在底座稳定后挂载。 | ①(需要真实 install/run 产生的 runs.jsonl 量);③(runtime 维度与复用率口径对齐);复用已有 runlog.Log / RunRecord / Diagnostics |
| 5 | ④ Mini App 薄壳 (Agent.Params/Render + RunExec one-shot 捕获 + miniapp HTTP 壳) | 消费层探针,放最后。它依赖前四者全部就位:消费的 agent 来自 ①registry,跑之前要过 ⑤inspect 闸,选哪个 agent 看 ②leaderboard 信号,跨 runtime 行为靠 ③matrix 解释。它会迫使 AVM schema 长出两个新字段(Params/Render)和一条新执行通道(RunExec/--exec one-shot 捕获),这是改动面最大、最可能反推 schema 重构的实验,应在底座冻结后再做,并明确产出『AVM schema 还差什么』的结论文档作为下一轮 schema 演进输入。 | ①(消费来自 registry 的 agent);⑤(代跑前过安全闸,且 boundary 隔离直接复用);②(用客观信号选 agent);复用 boundary / process.RunCaptured / ui 的 spawn+parse 模式 |

### 应一次建好、跨实验复用的基建(别重复造)

- agent 身份 + 版本寻址 (role@ver):由 ① 的 RegistryEntry 定义,但必须从一开始就设计成跨 ②③④⑤ 共用的规范键——②leaderboard 按 agent 聚合、③matrix 标识被测 agent、④miniapp 路由 /a/{agent}、⑤inspect 报告主体都要用同一个 role@ver 标识,避免各实验自造 ID
- 内容寻址 capID (capstore deriveID):已存在,是『复用率』(②)、发布去重(①)、安全扫描定位(⑤ ScanCapBlob 按 cap 粒度)三处共享的去重/定位主键,一次建好严禁各实验重新发明哈希口径
- 远程索引 schema (index.json / RegistryIndex):不只是 ① 的拉取索引,应预留承载 ②的成功率/复用率/thumbs 聚合值、⑤的 inspect Verdict、③的 matrix 兼容矩阵摘要,使 search 结果天然带『可信任+客观信号+跨runtime兼容』三维元数据,避免后续为每个信号各开一张表
- boundary 代跑服务 (boundary.go + driver.Boundary() + process.RunCaptured + LaunchSpec.Capture):④的 one-shot 捕获通道一旦建好,③matrix 跑 Preview、②未来若要主动重跑评测、④消费代跑共用同一条隔离执行+输出捕获语义,RunExec 应被设计成通用『非交互一次性代跑』原语而非 miniapp 私有
- 安全裁决原语 (secretscan: looksSecret/SanitizeMCPConfig/ScanCapBlob/verdictFor + SecurityFinding + Verdict):⑤ 建立后,①publish 准入、④miniapp 代跑前置、未来审核队列种子事件都复用同一裁决函数与 PASS/WARN/BLOCK 口径,严禁分发层和消费层各写一套 secret 检测
- 反馈/评测数据 schema (RunRecord.Feedback + RunID + AgentScore):②定义的 thumbs + 成功率/复用率结构,要能被 ①search 排序、④消费选择直接读取,是客观层回流的统一载体
- CLI/Container/Render 装配范式:所有实验都走 service.Container 单一装配根 + cobra 子命令 + --json envelope + RenderXxx 的 tabwriter ASCII 无 emoji 渲染,这是已有的共享装配契约,5 个实验严格遵守可避免渲染/装配重复

### 里程碑 + 决策门

**阶段 0 — 信任底座(⑤)**
- export 净化:产物 mcp.json 明文 secret 数 = 0(净化率 100%)
- avm package inspect --policy 输出 PASS/WARN/BLOCK 裁决,含明文凭据包 Verdict=block 且退出码非零
- looksSecret/SanitizeMCPConfig/ScanCapBlob/verdictFor 四点纯函数单测全绿,SecurityFinding/PackageDetail.Findings schema 落地
> 🚦 决策门:净化率是否真 100%、误报率(把非 secret 标红)是否低到不影响正常包发布。若净化破坏了既有 install/run(净化后的引用无法解析回真实 token),则必须先解决 secret 引用解析机制再上 registry,否则不结算往下

**阶段 1 — 可寻址分发底座(①,publish 强制过 ⑤ 闸)**
- 静态 HTTP 文件服务器 + index.json 索引 + RegistryIndex/RegistryEntry schema
- publish/search/install role@ver 三动词,publish 前置调用 inspect,Verdict=block 拒绝发布
- 两个独立 AVM_HOME 间完成 publish→search→install role@ver 跨机分发,install 后 avm list 出现 agent 且 skill/MCP 经 capstore 内容寻址正确导入
- go test ./internal/... 全绿,.avm.zip 格式与 packageio/capstore 既有逻辑零修改
> 🚦 决策门:跨机分发是否真正复用了既有 install 流水线(没有 fork 出第二套导入逻辑);role@ver 身份键是否已被设计成 ②③④⑤ 可直接复用。若身份键还需为后续实验重构,先冻结 schema 再继续

**阶段 2 — 护城河证明 + 客观信号(③ 并行 → ②)**
- ③ avm matrix:codex/claude-code/opencode 三列 ×≥6 字段对照表,出现四态中至少 3 态,--json evidence 可逐字段 diff,scripts/demo/matrix-proof.sh 产出可进 pitch deck 的表
- ② avm leaderboard:从真实 runs.jsonl 算出 agent×runtime 成功率(ExitCode==0 占比)+复用率,口径与 capstore 去重/matrix runtime 维度对齐
- ② avm score up/down 把 thumbs 持久化到对应 RunRecord 并在榜单 UP/DOWN 列反映,run 主链路核心逻辑零修改
> 🚦 决策门:matrix 对照表是否真能在创作者反应测试中说服人『一次定义到处跑』有价值(市场信号);leaderboard 的复用率/成功率是否口径自洽、是否值得回流进 ①search 排序。若 matrix 证明跨 runtime 差异过大无法解释、或真实 runs.jsonl 量太小算不出有意义榜单,则消费层(④)的前提存疑,暂缓阶段 3

**阶段 3 — 消费形态探针 + schema 演进结论(④)**
- Agent.Params/Render 两个 schema 字段 + RunExec/--exec --param k=v one-shot 捕获通道(≤2 schema 字段 + 1 执行通道)
- cmd/miniapp/main.go + POST /a/{agent}/run,薄壳 0 新依赖 ≤200 行 stdlib,boundary 隔离直接复用
- 外行用户全程不碰 CLI/yaml:打开 /a/<agent>→看 Params 自动生成表单→提交→boundary 内代跑→看 render 产物
- 明确结论文档:params 描述够不够生成表单、render 最朴素 text/template 够不够出产物、AVM schema 为支撑『开发者配置→普通人能用』还差哪些字段/能力
> 🚦 决策门:这是整条路线的『要不要上结算』总门:Params/Render 这条最小 schema 是否真能从开发者定义自动长出可用产品。若结论是 schema 缺口巨大(params 不足以描述表单、render 不足以出产物),则下一轮要立项做正式 schema v2 + generative UI,而非继续薄壳;若薄壳已能跑通,则 Agora 消费层 MVP 成立,可进入正式产品化

### 贯穿性风险

- 凭据泄漏的不可逆性:① registry 一旦广播带明文 token 的包即不可撤回。这要求 ⑤ 必须严格前置于 ①,且 export 净化与 secret 引用解析必须配套——净化后若 install/run 无法把引用解析回真实凭据,会静默破坏跨机分发的可用性
- 身份/版本寻址口径不一致:role@ver(①)、capID 内容寻址(capstore)、RunRecord 的 agent 标识(②)、matrix 被测 agent(③)、miniapp 路由(④)、inspect 报告主体(⑤)若各自为政,会导致 search 排序、榜单聚合、安全报告无法 join。必须一次统一身份键
- 『复用率』与四态口径漂移:② 的复用率依赖 capstore 去重语义,③ 的四态 MappingStatus(native/rendered_as_instructions/ignored/unsupported)是跨 runtime 可比较的唯一公共口径。若 ② 的成功率不区分 runtime 差异、或 ③ 四态定义在 driver 间不一致,客观层信号会失真,误导 ④ 的消费选择和 ①search 排序
- License / 分发合规:① 把 agent(含 skills/MCP)跨机分发后,被分发内容的 license、第三方 MCP server 的可再分发性、capstore 内容的版权归属都成为平台责任。registry 应在 index.json 元数据里承载 license 字段并在 ⑤inspect 里纳入审核,否则 Agora 会变成未授权内容的广播通道
- 信任边界与代跑安全:④ miniapp 让外行用户触发服务端在 boundary 内代跑 agent,这把 LLM/任意 agent 执行暴露给非可信输入(params 注入、prompt 注入)。boundary 隔离(CODEX_HOME/HOME)只隔离文件系统,不防 prompt 注入与资源滥用;代跑前必须过 ⑤ 闸,且需限流/沙箱化
- 主链路零修改承诺的累积侵蚀:5 个实验都声称『不改 run/export/packageio/capstore 主链路』,但 ④ 的 RunExec/Params/Render 实际会反推 schema 与执行通道演进。需有明确的 schema 冻结点(阶段 1 结束冻结身份键、阶段 3 才允许 schema 扩展),否则各实验的『仅新增』会在主链路上累积成隐性 fork
- 审核与运营的人力缺口:⑤ 的标红是『审核队列种子事件』、② 的 thumbs 是社区信号,但都未定义谁来处理审核队列、谁来防刷榜/刷反馈。平台一旦开放分发与评分,缺少审核/反作弊运营会让信任层与客观层同时失效

---
## 各路线 build spec 详情

### ⑤ 安全闸：信任原语 + 堵 P0 凭据泄漏。在 avm package export 时把 MCP env 里的 secret 引用化（不再把明文 token 打进 .avm.zip），并扩展 avm package inspect 为一个会读 payload、自动标红「凭据进包 / 危险权限」的审核闸；标红结果即「审核队列」的种子事件。

**目标**:让 export 不再泄漏 MCP env token，让 inspect 能在不安装的前提下对一个 .avm.zip 给出 PASS/WARN/BLOCK 的安全裁决。

**验证假设**:Agora 的核心假设是「分发要建立在可审计的信任原语之上」。如果 inspect+export 能在本地、零配置地把"凭据进包/危险权限"变成结构化、可标红的裁决，就证明：用一个最小的 policy + scanner 就能给 P2P/registry 分发提供"安全闸"种子，无需先建中心化审核服务。

**工作量**:M　|　**成功标准**:export 产物的 mcp.json 中明文 secret 数 = 0（净化率 100%）；inspect 对"含明文凭据的包"判定 Verdict=block 且退出码非零，对"已净化的包"判定 pass 且退出码 0；新增逻辑全部走纯函数单测，覆盖 looksSecret/SanitizeMCPConfig/ScanCapBlob/verdictFor 四个点。

**复用 AVM 已有原语**
- /tmp/avm-src/internal/app/service/package.go (Packages.Export 的 gather 闭包 / Packages.Inspect)
- /tmp/avm-src/internal/runtime/driver.go (MCPConfigV1.Env —— 泄漏点结构体)
- /tmp/avm-src/internal/app/model/package.go (PackageDetail / PackageCapBlob)
- /tmp/avm-src/internal/app/model/capability.go (PayloadFormatMCPConfigV1 常量，用于识别 MCP payload)
- /tmp/avm-src/internal/infra/packageio/packageio.go (ReadHandle.Open，inspect 用它读 payload 字节)
- /tmp/avm-src/internal/presentation/cli/package.go (newPackageInspectCmd / newPackageExportCmd)
- /tmp/avm-src/internal/presentation/cli/render.go (RenderPackageDetail)

**新增表面(命令/字段/服务/接口/文件)**

| 类型 | 名称 | 说明 |
|---|---|---|
| file | `/tmp/avm-src/internal/app/service/secretscan.go` | 新文件：纯函数 secret 扫描 + MCP env 引用化逻辑，不依赖 IO，方便单测。导出 SanitizeMCPConfig(raw []byte) (clean []byte, refs []SecretRef, err error) 和 ScanCapBlob(kind, format string, payload []byte) []model.SecurityFinding。 |
| struct_field | `model.SecurityFinding` | 新结构体（package.go 内）：Level(string: info/warn/block)、Code(string)、CapKind、CapName、Path、Message、Detail。代表一条标红。 |
| struct_field | `model.PackageDetail.Findings` | 在 PackageDetail 上新增 Findings []SecurityFinding 与 Verdict string(pass/warn/block)，inspect 填充，JSON 与人读两条路都输出。 |
| command | `avm package inspect --policy <strict|default>` | 给 newPackageInspectCmd 加 --policy flag（默认 default）和 --fail-on <none|warn|block>（默认 block，命中即非零退出码，方便 CI 当闸）。 |
| struct_field | `runtime.MCPConfigV1 不改字段，新增约定` | 约定：env value 形如 ${AVM_SECRET:NAME} 表示引用而非明文。export 产物里 secret 值被替换成该形态；Plan 阶段（后续）才解引用。本实验只做 export 侧引用化，不改 Plan。 |
| config | `export 行为变更` | Packages.Export 的 gather 闭包对 PayloadFormatMCPConfigV1 的 payload 先过 SanitizeMCPConfig 再写 zip+算 checksum，保证包内 MCP 不含明文 secret。 |

**要改的文件**

- `/tmp/avm-src/internal/app/service/secretscan.go` — 新建。实现 SanitizeMCPConfig（解析 MCPConfigV1，对 Env 每个 value 跑 looksSecret(key,val)，命中则替换为 ${AVM_SECRET:<KEY>} 并记一条 SecretRef，重新 MarshalIndent 回字节）；实现 ScanCapBlob（对 MCP：解析 env，任何明文 secret 值→block 级 credential_in_package finding；对 command/args 里出现 rm -rf、curl|sh、sudo、绝对路径写系统目录→warn 级 dangerous_command；危险权限：env 含 *TOKEN*/*KEY*/*SECRET*/*PASSWORD* 且为明文→block）；实现 looksSecret(key,val) bool（key 命中 token|key|secret|password|apikey|auth 正则，或 val 是高熵/长度>=20 的非占位串且不以 ${ 开头）。
- `/tmp/avm-src/internal/app/model/package.go` — 新增 SecurityFinding 结构体与 Level/Verdict 常量（LevelInfo/Warn/Block, VerdictPass/Warn/Block）；给 PackageDetail 加 Findings []SecurityFinding 和 Verdict string 字段（json omitempty）。
- `/tmp/avm-src/internal/app/service/package.go` — 1) Inspect：保留现有 manifest+Files 读取，新增遍历 manifest.Capabilities，h.Open(blob.Path) 读 payload，调 ScanCapBlob 累加 findings，按最高等级算 Verdict，填进 PackageDetail。2) Export 的 gather 闭包：写 zip 前，若 rec.Format==model.PayloadFormatMCPConfigV1 则 payload,_,_=SanitizeMCPConfig(payload)（失败则原样+warn），再用净化后的 payload 算 sha256 与写 zip，使包内与 checksum 一致。
- `/tmp/avm-src/internal/presentation/cli/package.go` — newPackageInspectCmd 加 --policy 和 --fail-on flag，传给 service（先用最简单 policy：default=block-on-credential, strict=block-on-warn）；渲染后若 Verdict 触达 fail-on 阈值则返回非零退出（return cmdError）。
- `/tmp/avm-src/internal/presentation/cli/render.go` — RenderPackageDetail 末尾追加 Security 段：打印 Verdict 与每条 Finding（block 用 [BLOCK] 前缀红字/warn 用 [WARN]），无 finding 打印 'Security: PASS'。
- `/tmp/avm-src/internal/app/service/secretscan_test.go` — 新建单测：含明文 token 的 MCPConfigV1 → SanitizeMCPConfig 替换为 ${AVM_SECRET:GITHUB_TOKEN} 且 ScanCapBlob 给 block；占位 ${...} 不误报；export 端到端：含 token 的 agent export 后 inspect 该 zip 得 Verdict=pass（已净化）。

**关键代码骨架(可照敲)**

```go
// ---- internal/app/model/package.go (新增) ----
type SecurityLevel string
const (
    LevelInfo  SecurityLevel = "info"
    LevelWarn  SecurityLevel = "warn"
    LevelBlock SecurityLevel = "block"
)
const (
    VerdictPass = "pass"
    VerdictWarn = "warn"
    VerdictBlock = "block"
)
type SecurityFinding struct {
    Level   SecurityLevel  `json:"level"`
    Code    string         `json:"code"`     // e.g. "credential_in_package"
    CapKind CapabilityKind `json:"cap_kind,omitempty"`
    CapName string         `json:"cap_name,omitempty"`
    Path    string         `json:"path,omitempty"`
    Message string         `json:"message"`
    Detail  string         `json:"detail,omitempty"`
}
// PackageDetail 增加：
//   Findings []SecurityFinding `json:"findings,omitempty"`
//   Verdict  string            `json:"verdict,omitempty"`

// ---- internal/app/service/secretscan.go (新建) ----
package service
import (
    "encoding/json"; "fmt"; "regexp"; "strings"
    "github.com/xz1220/agent-vm/internal/app/model"
    "github.com/xz1220/agent-vm/internal/runtime"
)
var secretKeyRe = regexp.MustCompile(`(?i)(token|api[_-]?key|secret|password|passwd|auth|credential)`)
const secretRefPrefix = "${AVM_SECRET:" // value 形如 ${AVM_SECRET:GITHUB_TOKEN}

type SecretRef struct{ EnvKey, RefName string }

func looksSecret(key, val string) bool {
    if strings.HasPrefix(val, "${") { return false } // 已是引用/占位
    if secretKeyRe.MatchString(key) && val != "" { return true }
    if len(val) >= 20 && !strings.ContainsAny(val, " /\\") { return true } // 粗启发式高熵
    return false
}
// SanitizeMCPConfig 把 env 里的明文 secret 替换成引用，返回净化字节 + 引用清单
func SanitizeMCPConfig(raw []byte) ([]byte, []SecretRef, error) {
    var cfg runtime.MCPConfigV1
    if err := json.Unmarshal(raw, &cfg); err != nil { return raw, nil, err }
    var refs []SecretRef
    for k, v := range cfg.Env {
        if looksSecret(k, v) {
            ref := secretRefPrefix + strings.ToUpper(k) + "}"
            cfg.Env[k] = ref
            refs = append(refs, SecretRef{EnvKey: k, RefName: strings.ToUpper(k)})
        }
    }
    out, err := json.MarshalIndent(cfg, "", "  ")
    if err != nil { return raw, refs, err }
    return out, refs, nil
}
// ScanCapBlob 给 inspect 用：对一份 payload 产出 findings
func ScanCapBlob(kind model.CapabilityKind, format, path string, payload []byte) []model.SecurityFinding {
    var fs []model.SecurityFinding
    if format != model.PayloadFormatMCPConfigV1 { return fs }
    var cfg runtime.MCPConfigV1
    if json.Unmarshal(payload, &cfg) != nil { return fs }
    for k, v := range cfg.Env {
        if looksSecret(k, v) {
            fs = append(fs, model.SecurityFinding{
                Level: model.LevelBlock, Code: "credential_in_package",
                CapKind: kind, CapName: cfg.Name, Path: path,
                Message: fmt.Sprintf("MCP env %q ships a plaintext credential", k),
                Detail:  "export should have referenced it as ${AVM_SECRET:...}",
            })
        }
    }
    // 危险权限/命令启发式
    cmdline := cfg.Command + " " + strings.Join(cfg.Args, " ")
    for _, pat := range []string{"rm -rf", "sudo ", "curl", "| sh", "| bash"} {
        if strings.Contains(cmdline, pat) {
            fs = append(fs, model.SecurityFinding{
                Level: model.LevelWarn, Code: "dangerous_command",
                CapKind: kind, CapName: cfg.Name, Path: path,
                Message: "MCP launch command contains risky pattern: " + pat,
            })
        }
    }
    return fs
}
func verdictFor(fs []model.SecurityFinding) string {
    v := model.VerdictPass
    for _, f := range fs {
        if f.Level == model.LevelBlock { return model.VerdictBlock }
        if f.Level == model.LevelWarn { v = model.VerdictWarn }
    }
    return v
}

// ---- internal/app/service/package.go: Inspect 末尾改造 ----
func (s *Packages) Inspect(ctx context.Context, file string) (*model.PackageDetail, error) {
    // ... 现有 Read + manifest + defer h.Close() 不变 ...
    detail := &model.PackageDetail{Manifest: *manifest, Files: h.Files(), Source: file}
    for _, blob := range manifest.Capabilities {
        rc, err := h.Open(blob.Path)
        if err != nil { continue } // Verify 另行报错
        payload, _ := io.ReadAll(rc); _ = rc.Close()
        detail.Findings = append(detail.Findings,
            ScanCapBlob(blob.Kind, blob.Format, blob.Path, payload)...)
    }
    detail.Verdict = verdictFor(detail.Findings)
    return detail, nil
}

// ---- internal/app/service/package.go: Export gather 闭包内，写 zip 之前 ----
payload, name, err := readCapPayload(s.Caps, ref.ID, rec.Kind)
// ... 错误处理不变 ...
if rec.Format == model.PayloadFormatMCPConfigV1 {
    if clean, _, serr := SanitizeMCPConfig(payload); serr == nil {
        payload = clean   // 用净化字节写 zip 并参与 checksum
    }
}
capPath, err := packageCapabilityPath(rec.Kind, rec.Name, name)
// ... cw.Write(payload); sum := sha256.Sum256(payload) ... (沿用现有写法，确保 checksum 算的是 payload)

// ---- internal/presentation/cli/package.go: inspect cobra 注册 ----
func newPackageInspectCmd(deps Deps) *cobra.Command {
    var policy, failOn string
    cmd := &cobra.Command{
        Use: "inspect <file.avm.zip>", Short: "Inspect a package (security gate)",
        Args: cobra.ExactArgs(1),
        RunE: func(c *cobra.Command, args []string) error {
            g := globalFlags(c)
            detail, err := deps.Services.Packages.Inspect(c.Context(), args[0])
            if err != nil { return err }
            if g.JSON { _ = jsonWrite(c.OutOrStdout(), detail) } else {
                _ = RenderPackageDetail(c.OutOrStdout(), detail)
            }
            // 当闸：strict 把 warn 也拉到阈值
            threshold := failOn
            if policy == "strict" && threshold == "block" { threshold = "warn" }
            if gateTrips(detail.Verdict, threshold) {
                return service.NewError(service.CodeValidation,
                    "package inspect gate: verdict="+detail.Verdict, nil)
            }
            return nil
        },
    }
    cmd.Flags().StringVar(&policy, "policy", "default", "default|strict")
    cmd.Flags().StringVar(&failOn, "fail-on", "block", "none|warn|block")
    return cmd
}
// gateTrips: failOn=none→false; warn→verdict in {warn,block}; block→verdict==block
```

**怎么验证**:1) go build ./... 通过。2) 单测 secretscan_test.go：构造含 {"kind":"mcp","name":"gh","env":{"GITHUB_TOKEN":"ghp_xxxxxxxxxxxxxxxxxxxx"}} 的 MCPConfigV1，SanitizeMCPConfig 后 env GITHUB_TOKEN == "${AVM_SECRET:GITHUB_TOKEN}"，ScanCapBlob 原始 payload 返回一条 block。3) 端到端：手工造一个引用了该 MCP cap 的 agent → avm package export → 解开 zip 确认 capabilities/mcp/.../mcp.json 里 env 是 ${AVM_SECRET:...} 而非明文 → avm package inspect 该 zip 输出 Security: PASS / Verdict=pass，退出码 0。4) 反向：手工把明文 token 塞回 zip 内 mcp.json（不改 checksum 也行，inspect 不验 checksum），inspect --fail-on block 返回非零并打印 [BLOCK] credential_in_package。

**风险**
- looksSecret 高熵启发式可能误报（长 base64 命令参数被当 secret）——用 key 命中优先、长度阈值 20、排除含空格/斜杠的串来压低；首版宁可漏报 command 里的，env 里 key 命中是主信号。
- Sanitize 改了 payload 字节 → checksum 跟着变（因为 Export 里 checksum 是对 payload 算的，已用净化后字节算，二者一致），但要确保顺序：先 sanitize 再 sha256，sketch 已固定该顺序。
- Inspect 现在要读每个 cap payload，损坏/超大 payload 需容错（h.Open 失败 continue、ReadAll 错误跳过），不能让安全扫描把 inspect 整体打挂。
- MCPConfigV1.Env 是 map，Sanitize 原地改了传入 cfg 的 map；因为是从 json.Unmarshal 新建的 cfg，不会污染 capstore 里的原始记录，安全。

**本次明确不做(留给后续)**
- Plan 阶段对 ${AVM_SECRET:NAME} 的解引用（从用户 keychain/env 注入真值）——本实验只做 export 侧引用化，运行时注入留给后续。
- 中心化审核服务 / registry 端的队列存储与人审 UI——inspect 的 findings 只是'队列种子'，不落库。
- skill payload（SKILL.md）的内容扫描（prompt 注入、外联 URL）——首版只扫 MCP env/command。
- packageio.Verify 与安全扫描的合并；Verify 仍只管 checksum/path 安全，scan 走 Inspect。
- 签名/provenance（cosign 之类）信任链——不在本闸。
- boundary 命令侧的实时权限闸——本实验只覆盖 package inspect/export 这条静态分发链。

---

### ③ 跨 runtime "一次定义到处跑" 证明 Demo（护城河证明）

**目标**:新增 `avm matrix <agent>` 命令：把同一份 Agent 定义在 codex / claude-code / opencode 三个 driver 上各跑一次 Preview，输出一张「字段 × runtime」的 MappingStatus 对照表（人类表格 + --json 证据），证明同一定义跨 runtime 行为可解释、可复现。

**验证假设**:验证 Agora 的核心护城河假设：AVM 的 model.Agent 是稳定的「一次定义」层，三个 runtime driver 的 Plan() 各自把同一组字段（identity.name/description/role/instructions/skills/mcp/runtimes）翻译成 native / rendered_as_instructions / ignored / unsupported 四态，且这套翻译是声明式、可对照、可进 pitch 的真实证据——不是营销话术而是从真实 driver 代码跑出来的表。

**工作量**:S　|　**成功标准**:同一个 agent（含 role+skills+mcp）跑 `avm matrix` 一次性产出 codex/claude-code/opencode 三列、≥6 字段行的对照表，其中至少出现全部四态中的 3 态（native/rendered_as_instructions/ignored），且 --json evidence 可被脚本逐字段 diff 出「三 runtime 对同一字段 Status 一致或差异有 Note 解释」——这张表/JSON 即可直接进 pitch deck 与创作者反应测试。

**复用 AVM 已有原语**
- /tmp/avm-src/internal/app/service/run.go (RunService.Preview / buildPreview，已把 plan.Mappings 投影成 model.RunPreview.Mapping)
- /tmp/avm-src/internal/app/model/run.go (RunPreview.Mapping []FieldMappingSummary)
- /tmp/avm-src/internal/app/model/agent.go (FieldMappingSummary{Field,Status,Note})
- /tmp/avm-src/internal/app/model/run.go (MappingStatus 四态常量 MappingNative/RenderedAsInstructions/Ignored/Unsupported)
- /tmp/avm-src/internal/runtime/codex/driver.go, claudecode/driver.go, opencode/driver.go (各自 Plan() 里已生成 FieldMapping，无需改动)
- /tmp/avm-src/internal/app/service/diagnostics.go (Diagnostics.Runtimes(ctx) 返回所有已注册 runtime 列表，用来枚举三 runtime)
- /tmp/avm-src/internal/presentation/cli/render.go (statusIcon() 把四态映射成 OK/INS/--/NO；RenderRunPreview 的 Mapping 表)
- /tmp/avm-src/internal/presentation/cli/run.go (--preview --json 模式范本)
- /tmp/avm-src/internal/presentation/cli/root.go (NewRoot 里 AddCommand 注册位)
- /tmp/avm-src/internal/presentation/cli/runtime.go (parent+sub cmd cobra 范本)

**新增表面(命令/字段/服务/接口/文件)**

| 类型 | 名称 | 说明 |
|---|---|---|
| command | `avm matrix <agent> [--runtimes a,b,c] [--json]` | 枚举目标 runtime（默认全部已注册），对每个 runtime 调 Services.Run.Preview，把各 RunPreview.Mapping 按 (runtime → []FieldMappingSummary) 收集，pivot 成字段×runtime 表。人类模式用 tabwriter + statusIcon 渲染；--json 输出 model.MatrixReport 作为可进 pitch 的证据 artifact。 |
| struct_field | `model.MatrixReport` | 新结构体（internal/app/model/run.go）：{Agent string; Runtimes []string; Fields []string; Cells []MatrixCell; Errors []MatrixRuntimeError}，作为命令的 JSON 证据顶层对象。 |
| struct_field | `model.MatrixCell` | {Field string; Runtime string; Status MappingStatus; Note string} —— 一个字段在一个 runtime 的翻译结果，直接来自 FieldMappingSummary。 |
| struct_field | `model.MatrixRuntimeError` | {Runtime string; Code string; Message string} —— 某 runtime Preview 失败（如 binary 缺失/plan 失败）时记录，使表格仍可渲染其余列。 |
| service | `service.MatrixService (interface) + Matrixer (impl)` | 新 service（internal/app/service/matrix.go）：Report(ctx, agent string, runtimes []string) (*model.MatrixReport, error)。内部复用已注入的 RunService.Preview 逐 runtime 跑，聚合 Mapping。挂到 Container.Matrix 字段。 |
| struct_field | `service.Container.Matrix` | 在 internal/app/service/container.go 的 Container 里加 Matrix MatrixService 字段，main.go 组合根里 new。 |
| file | `scripts/demo/matrix-proof.sh` | 可复现录屏脚本：建一个有分量的 demo agent（带 skills+mcp+role），依次 avm matrix <agent> 人类表 + avm matrix <agent> --json > evidence.json，打印三 runtime 的字段对照，作为 pitch 证据 + 创作者反应测试素材。 |

**要改的文件**

- `/tmp/avm-src/internal/app/model/run.go` — 新增 MatrixReport / MatrixCell / MatrixRuntimeError 三个结构体（带 json tag，CLI 协议的一部分）。放在 RunPreview 相关定义之后。
- `/tmp/avm-src/internal/app/service/matrix.go` — 新文件：MatrixService 接口 + Matrixer 实现。构造 NewMatrixer(run RunService, registry runtime.Registry)。Report() 解析 runtimes（空则 registry.List() 全取），对每个调 run.Preview(RunRequest{Agent,Runtime})，把 pv.Mapping 拍平成 cells，Preview 出错则记 MatrixRuntimeError 并继续。字段全集按首次出现顺序去重收集。
- `/tmp/avm-src/internal/app/service/container.go` — Container struct 增加 Matrix MatrixService 字段。
- `/tmp/avm-src/cmd/avm/main.go` — 组合根里构造 service.NewMatrixer(runner, registry) 并塞进 Container.Matrix（与 Run/Diagnostics 同处注入；按 grep NewRunner/NewDiagnostics 的位置照写）。
- `/tmp/avm-src/internal/presentation/cli/matrix.go` — 新文件：newMatrixCmd(deps) cobra 命令，Args=ExactArgs(1)，--runtimes StringSlice，复用 globalFlags(c).JSON。JSON 模式 jsonWrite(report)；人类模式调新增的 RenderMatrix。
- `/tmp/avm-src/internal/presentation/cli/render.go` — 新增 RenderMatrix(w, *model.MatrixReport)：用 tabwriter 输出表头 FIELD\t<runtime1>\t<runtime2>... ，每行一个字段，单元格用已有 statusIcon(status) 渲染；底部打印 legend（OK=native, INS=rendered_as_instructions, --=ignored, NO=unsupported）和任何 MatrixRuntimeError。
- `/tmp/avm-src/internal/presentation/cli/root.go` — NewRoot 里 root.AddCommand(newMatrixCmd(deps))（放在 newRunCmd 之后）。
- `/tmp/avm-src/scripts/demo/matrix-proof.sh` — 新文件：复现/录屏脚本，建 demo agent + 跑两种输出 + 落 evidence.json。

**关键代码骨架(可照敲)**

```go
// ---- internal/app/model/run.go (追加) ----
// MatrixReport is the `avm matrix` evidence artifact: one Agent's field
// mapping across multiple runtimes. JSON tags are part of the CLI protocol.
type MatrixReport struct {
	Agent    string               `json:"agent"`
	Runtimes []string             `json:"runtimes"`
	Fields   []string             `json:"fields"`
	Cells    []MatrixCell         `json:"cells"`
	Errors   []MatrixRuntimeError `json:"errors,omitempty"`
}
type MatrixCell struct {
	Field   string        `json:"field"`
	Runtime string        `json:"runtime"`
	Status  MappingStatus `json:"status"`
	Note    string        `json:"note,omitempty"`
}
type MatrixRuntimeError struct {
	Runtime string `json:"runtime"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// ---- internal/app/service/matrix.go (新文件) ----
package service

import (
	\"context\"
	\"github.com/xz1220/agent-vm/internal/app/model\"
	\"github.com/xz1220/agent-vm/internal/runtime\"
)

type MatrixService interface {
	Report(ctx context.Context, agent string, runtimes []string) (*model.MatrixReport, error)
}

type Matrixer struct {
	Run      RunService
	Registry runtime.Registry
}

func NewMatrixer(run RunService, reg runtime.Registry) *Matrixer {
	return &Matrixer{Run: run, Registry: reg}
}

func (m *Matrixer) Report(ctx context.Context, agent string, runtimes []string) (*model.MatrixReport, error) {
	if len(runtimes) == 0 {
		for _, di := range m.Registry.List() { // DriverInfo{Name}
			runtimes = append(runtimes, di.Name)
		}
	}
	rep := &model.MatrixReport{Agent: agent, Runtimes: runtimes}
	fieldSeen := map[string]struct{}{}
	for _, rt := range runtimes {
		pv, err := m.Run.Preview(ctx, model.RunRequest{Agent: agent, Runtime: rt})
		if err != nil {
			// typed service.Error -> Code/Message; degrade gracefully.
			code, msg := \"PREVIEW_FAILED\", err.Error()
			if se, ok := err.(*Error); ok { code, msg = string(se.Code), se.Message }
			rep.Errors = append(rep.Errors, model.MatrixRuntimeError{Runtime: rt, Code: code, Message: msg})
			continue
		}
		for _, fm := range pv.Mapping { // []model.FieldMappingSummary
			if _, ok := fieldSeen[fm.Field]; !ok {
				fieldSeen[fm.Field] = struct{}{}
				rep.Fields = append(rep.Fields, fm.Field)
			}
			rep.Cells = append(rep.Cells, model.MatrixCell{
				Field: fm.Field, Runtime: rt, Status: fm.Status, Note: fm.Note,
			})
		}
	}
	return rep, nil
}

// ---- internal/presentation/cli/matrix.go (新文件) ----
func newMatrixCmd(deps Deps) *cobra.Command {
	var runtimes []string
	cmd := &cobra.Command{
		Use:   \"matrix <agent>\",
		Short: \"Show how one Agent definition maps across runtimes (one definition, runs everywhere)\",
		Args:  cobra.ExactArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			rep, err := deps.Services.Matrix.Report(c.Context(), args[0], runtimes)
			if err != nil { return err }
			if globalFlags(c).JSON { return jsonWrite(c.OutOrStdout(), rep) }
			return RenderMatrix(c.OutOrStdout(), rep)
		},
	}
	cmd.Flags().StringSliceVar(&runtimes, \"runtimes\", nil, \"subset of runtimes (default: all registered)\")
	return cmd
}

// ---- internal/presentation/cli/render.go (追加) ----
// RenderMatrix pivots cells into a FIELD x RUNTIME table reusing statusIcon.
func RenderMatrix(w io.Writer, r *model.MatrixReport) error {
	if r == nil || len(r.Fields) == 0 { return render.Linef(w, \"(no mapping)\") }
	// index: field -> runtime -> status
	idx := map[string]map[string]model.MappingStatus{}
	for _, c := range r.Cells {
		if idx[c.Field] == nil { idx[c.Field] = map[string]model.MappingStatus{} }
		idx[c.Field][c.Runtime] = c.Status
	}
	tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
	fmt.Fprintf(tw, \"FIELD\\t%s\\n\", strings.Join(r.Runtimes, \"\\t\"))
	for _, f := range r.Fields {
		fmt.Fprintf(tw, \"%s\", f)
		for _, rt := range r.Runtimes {
			cell := \"·\"
			if s, ok := idx[f][rt]; ok { cell = statusIcon(s) }
			fmt.Fprintf(tw, \"\\t%s\", cell)
		}
		fmt.Fprintln(tw)
	}
	tw.Flush()
	fmt.Fprintln(w, \"\\nlegend: OK=native  INS=rendered_as_instructions  --=ignored  NO=unsupported  ·=field-absent\")
	for _, e := range r.Errors {
		fmt.Fprintf(w, \"warn: %s preview failed [%s] %s\\n\", e.Runtime, e.Code, e.Message)
	}
	return nil
}

# ---- scripts/demo/matrix-proof.sh (新文件) ----
#!/usr/bin/env bash
set -euo pipefail
AGENT=triage-bot
avm agent create \"$AGENT\" --description \"Cross-runtime triage agent\" --role \"incident responder\"  # 用真实 agent 子命令；带 role 才能体现 INS 态
# (附：import 1 个 skill + 1 个 mcp 让 skills/mcp 行也亮起来)
echo '== Human table ==' ; avm matrix \"$AGENT\"
echo '== JSON evidence ==' ; avm matrix \"$AGENT\" --json | tee evidence.json
```

**怎么验证**:1) go build ./... && go test ./internal/app/service/... ./internal/presentation/cli/...。2) 新增 matrix_test.go：用 run_test.go 里现成的 fake registry/repo 构造一个带 role+skills+mcp 的 agent，断言 Report 返回的 Fields 含 identity.role(INS) / skills(OK) / mcp(OK) / runtimes(--)，且 codex/claude-code/opencode 三列都填满。3) 手动 `avm matrix triage-bot` 看到三列对照表；`--json` 校验 cells 数量 = 字段数×成功runtime数。4) 某 runtime binary 缺失时该列降级为 Errors，表格其余列仍渲染（用 opencode 二进制不存在的环境验证）。

**风险**
- Preview 会触发 driver.Plan，对带 skills/mcp 的 agent 需要 capstore 里有对应记录；demo agent 必须先 import 真实 skill/mcp，否则 resolveMCPConfigs/materializeSkills 报错使该 runtime 整列降级——脚本里要先 import。
- Preview 内部 Writer.DryRun 会探测 boundary 目录，可能产生磁盘读；matrix 跑三次 Preview 属只读，但要确认不会因 boundary 不存在而报 IO 错（现有 Preview 已容忍）。
- service.Error 的具体类型断言（*Error）需对照 errors.go 实际定义，若是值类型而非指针要改断言。
- opencode 的 mcp 行 Note 说 'infra wires transport'，与 codex/claude 的 Note 文案不同——对照表要展示 Note 差异而非误判为不一致。

**本次明确不做(留给后续)**
- 不做真正的跨 runtime 实际启动/跑同一 prompt 比对输出一致性（那需要真实 binary + LLM，留给后续 e2e）——本次只证明『定义到配置』的映射一致性，不证明『模型输出』一致性。
- 不改任何 driver 的 Plan/MappingStatus 逻辑，只读现有 FieldMapping。
- 不做 UI/录屏自动化，scripts 只给可手动复现的 shell。
- 不实现 diff 模式（runtime A vs B 的字段差异高亮），matrix 先给全量对照表；差异高亮留给后续。
- 不持久化 evidence 到 runlog，只 stdout/--json。

---

### ② runlog 评测 v0：在 AVM 已有的 runs.jsonl 真实调用日志之上做最便宜的评测层——新增 avm leaderboard 聚合榜单（成功率/复用率）+ avm score run 后反馈 hook（👍/👎），把"客观层"从真实调用回流。

**目标**:不改 run 主链路核心逻辑，仅基于已有 runs.jsonl 聚合出 agent×runtime 的成功率/复用率榜单，并允许给最近一次 run 追加一条 thumbs 反馈，全部走现有 CLI/Container 装配模式。

**验证假设**:验证 Agora "客观评测可以零成本从真实运行数据回流"——即不需要新建评测管线，仅靠 runlog.jsonl 里已有的 exit_code/耗时/agent/runtime 字段 + 一个轻量反馈 hook，就能产出有信号的成功率/复用率榜单，足以驱动后续 agent 选型与排序。

**工作量**:M　|　**成功标准**:avm leaderboard 能在不修改 run 主链路核心逻辑的前提下，从真实 runs.jsonl 正确算出每个 agent×runtime 的成功率（ExitCode==0 占比）与复用率，且 avm score up/down 能把一条 thumbs 反馈持久化到对应 RunRecord 并在榜单 UP/DOWN 列反映；全部新增代码走现有 Container/Cobra/Render 装配，go build + 新增单测全绿。

**复用 AVM 已有原语**
- /tmp/avm-src/internal/infra/runlog/runlog.go (Log 接口 Append/List、FSLog、FileName=runs.jsonl)
- /tmp/avm-src/internal/app/model/run.go (RunRecord 结构体：Agent/Runtime/StartedAt/EndedAt/ExitCode/Drift/Warnings)
- /tmp/avm-src/internal/app/service/diagnostics.go (Diagnostics 已持有 runlog.Log，可加 Leaderboard/Score 方法或单独 service)
- /tmp/avm-src/internal/app/service/run.go (Run 主链路在 line 390-400 写 runlog，可读最近一条 record 供 score 定位)
- /tmp/avm-src/internal/app/service/container.go (service.Container 单一装配根)
- /tmp/avm-src/internal/presentation/cli/root.go (NewRoot 里 AddCommand 注册命令、Deps、globalFlags、--json envelope)
- /tmp/avm-src/internal/presentation/cli/init.go (newStatusCmd/newDoctorCmd 的 cobra 写法模板)
- /tmp/avm-src/internal/presentation/cli/render.go (RenderStatus 的 tabwriter + ASCII 无 emoji 渲染范式)
- /tmp/avm-src/cmd/avm/main.go (line 86 runlog.New、line 91-99 Container 装配)
- /tmp/avm-src/internal/infra/home/home.go (RunLogDir() 已存在)

**新增表面(命令/字段/服务/接口/文件)**

| 类型 | 名称 | 说明 |
|---|---|---|
| struct_field | `RunRecord.Feedback` | 在 model/run.go 的 RunRecord 加可选字段 Feedback *Feedback `json:"feedback,omitempty"`；新增 Feedback 结构体 {Score string(`up`/`down`), Note string, At time.Time}。旧行无该字段，JSON omitempty 向后兼容。 |
| struct_field | `RunRecord.RunID` | 加 RunID string `json:"run_id,omitempty"`，Run() 写日志时用 startedAt 纳秒+agent 生成稳定 id，作为 score 命令定位最近一次 run 的 key（避免靠行号）。旧行无 id 时 fallback 到 agent+started_at 匹配。 |
| struct_field | `AgentScore / Leaderboard` | model 新增 Leaderboard{Rows []AgentScore}；AgentScore{Agent,Runtime string; Runs,Successes int; SuccessRate float64; ReuseRate float64; AvgDurationMs int64; ThumbsUp,ThumbsDown int}。成功=ExitCode==0；复用率=该 agent 出现 run 次数/总 run 次数（粗口径，见 out_of_scope）。 |
| service | `EvalService` | 在 service 包新增 eval.go：interface EvalService{ Leaderboard(ctx,limit int)(*model.Leaderboard,error); Score(ctx, model.ScoreRequest) error }。实现 Evaluator{Log runlog.Log}。Leaderboard 调 Log.List(0) 聚合；Score 调新增 Log.AppendFeedback 或 rewrite。 |
| command | `avm leaderboard` | cobra 子命令，--limit N（聚合最近 N 条，0=全部）、继承 --json。文本走 RenderLeaderboard(tabwriter, ASCII 列：AGENT RUNTIME RUNS SUCCESS% REUSE% UP DOWN)。 |
| command | `avm score` | cobra 子命令 `avm score [up|down]`，可选 --run <run_id>（默认对最近一次 run），--note string。无 emoji，CLI 用 up/down 文本；UI 层再映射 👍/👎。 |
| struct_field | `runlog.Log.AppendFeedback` | 在 runlog.Log 接口加 AppendFeedback(runID string, fb model.Feedback) error；FSLog 实现：List→定位匹配 record→设置 Feedback→整文件 rewrite（v0 全量重写，量小可接受；并发用已有 mu）。 |

**要改的文件**

- `/tmp/avm-src/internal/app/model/run.go` — RunRecord 增加 RunID 与 Feedback *Feedback 字段；新增 Feedback 结构体（Score/Note/At）。新增 Leaderboard、AgentScore、ScoreRequest 模型（ScoreRequest{RunID string; Score string; Note string}）。
- `/tmp/avm-src/internal/infra/runlog/runlog.go` — Log 接口加 AppendFeedback(runID string, fb model.Feedback) error；FSLog 实现：读全量→按 RunID（或 fallback agent+started_at）找最后匹配项→赋 Feedback→截断重写整个 runs.jsonl（持已有 l.mu）。List 逻辑不变。
- `/tmp/avm-src/internal/app/service/run.go` — Run() line ~391 Append RunRecord 时填 RunID（如 fmt.Sprintf("%d-%s", startedAt.UnixNano(), agent.Identity.Name)）。其余主链路不动。
- `/tmp/avm-src/internal/app/service/eval.go` — 新建：EvalService 接口 + Evaluator 实现（持 runlog.Log）。Leaderboard 聚合成功率/复用率/avg 耗时/thumbs；Score 解析 up/down→AppendFeedback；RunID 为空时调 Log.List 取最近一条的 RunID。
- `/tmp/avm-src/internal/app/service/container.go` — Container 加字段 Eval EvalService。
- `/tmp/avm-src/cmd/avm/main.go` — line ~91 Container 字面量里加 Eval: service.NewEvaluator(log)（复用已构造的 log）。
- `/tmp/avm-src/internal/presentation/cli/eval.go` — 新建：newLeaderboardCmd(deps)、newScoreCmd(deps)，仿 init.go 的 newStatusCmd 写法，支持 --json envelope。
- `/tmp/avm-src/internal/presentation/cli/root.go` — NewRoot 里 root.AddCommand(newLeaderboardCmd(deps)) 和 newScoreCmd(deps)。
- `/tmp/avm-src/internal/presentation/cli/render.go` — 新增 RenderLeaderboard(w, *model.Leaderboard)，tabwriter + ASCII 列，复用现有 import（sort/tabwriter 已在）。

**关键代码骨架(可照敲)**

```go
// === model/run.go (新增) ===
type Feedback struct {
	Score string    `json:"score"` // "up" | "down"
	Note  string    `json:"note,omitempty"`
	At    time.Time `json:"at"`
}
// RunRecord 增加两字段：
//   RunID    string    `json:"run_id,omitempty"`
//   Feedback *Feedback `json:"feedback,omitempty"`

type ScoreRequest struct {
	RunID string `json:"run_id,omitempty"` // empty => most recent run
	Score string `json:"score"`            // "up" | "down"
	Note  string `json:"note,omitempty"`
}
type AgentScore struct {
	Agent, Runtime string
	Runs, Successes int
	SuccessRate, ReuseRate float64
	AvgDurationMs int64
	ThumbsUp, ThumbsDown int
}
type Leaderboard struct{ Rows []AgentScore `json:"rows"` }

// === infra/runlog/runlog.go (接口 + 实现) ===
// interface 加：AppendFeedback(runID string, fb model.Feedback) error
func (l *FSLog) AppendFeedback(runID string, fb model.Feedback) error {
	l.mu.Lock(); defer l.mu.Unlock()
	recs, err := l.listLocked() // 复用 List 的解析（抽一个不加锁的 helper）
	if err != nil { return err }
	idx := -1
	for i := range recs { if recs[i].RunID == runID { idx = i } } // 取最后匹配
	if idx < 0 { return errors.New("runlog: run not found: " + runID) }
	recs[idx].Feedback = &fb
	// 全量重写
	tmp, err := os.CreateTemp(l.Dir, "runs-*.tmp")
	if err != nil { return err }
	w := bufio.NewWriter(tmp)
	for _, r := range recs {
		b, _ := json.Marshal(r); w.Write(b); w.WriteByte('\n')
	}
	w.Flush(); tmp.Close()
	return os.Rename(tmp.Name(), l.path())
}

// === service/eval.go (新建) ===
type EvalService interface {
	Leaderboard(ctx context.Context, limit int) (*model.Leaderboard, error)
	Score(ctx context.Context, req model.ScoreRequest) error
}
type Evaluator struct{ Log runlog.Log }
func NewEvaluator(log runlog.Log) *Evaluator { return &Evaluator{Log: log} }

func (e *Evaluator) Leaderboard(ctx context.Context, limit int) (*model.Leaderboard, error) {
	recs, err := e.Log.List(limit)
	if err != nil { return nil, WrapError(CodeIOFailure, err, "read runlog: "+err.Error(), nil) }
	total := len(recs)
	type key struct{ a, r string }
	agg := map[key]*model.AgentScore{}
	for _, rec := range recs {
		k := key{rec.Agent, rec.Runtime}
		s := agg[k]; if s == nil { s = &model.AgentScore{Agent: rec.Agent, Runtime: rec.Runtime}; agg[k] = s }
		s.Runs++
		if rec.ExitCode == 0 { s.Successes++ }
		s.AvgDurationMs += rec.EndedAt.Sub(rec.StartedAt).Milliseconds()
		if rec.Feedback != nil {
			if rec.Feedback.Score == "up" { s.ThumbsUp++ } else if rec.Feedback.Score == "down" { s.ThumbsDown++ }
		}
	}
	lb := &model.Leaderboard{}
	for _, s := range agg {
		if s.Runs > 0 {
			s.SuccessRate = float64(s.Successes) / float64(s.Runs)
			s.AvgDurationMs = s.AvgDurationMs / int64(s.Runs)
			if total > 0 { s.ReuseRate = float64(s.Runs) / float64(total) }
		}
		lb.Rows = append(lb.Rows, *s)
	}
	sort.Slice(lb.Rows, func(i, j int) bool {
		if lb.Rows[i].SuccessRate != lb.Rows[j].SuccessRate { return lb.Rows[i].SuccessRate > lb.Rows[j].SuccessRate }
		return lb.Rows[i].Runs > lb.Rows[j].Runs
	})
	return lb, nil
}
func (e *Evaluator) Score(ctx context.Context, req model.ScoreRequest) error {
	if req.Score != "up" && req.Score != "down" {
		return NewError(CodeValidation, "score must be up or down", map[string]any{"score": req.Score})
	}
	runID := req.RunID
	if runID == "" {
		recs, err := e.Log.List(1)
		if err != nil { return WrapError(CodeIOFailure, err, err.Error(), nil) }
		if len(recs) == 0 { return NewError(CodeValidation, "no runs to score", nil) }
		runID = recs[0].RunID
	}
	return e.Log.AppendFeedback(runID, model.Feedback{Score: req.Score, Note: req.Note, At: time.Now()})
}

// === service/run.go (Run() 内 Append 处补一行) ===
// runID := fmt.Sprintf("%d-%s", startedAt.UnixNano(), agent.Identity.Name)
// _ = s.Log.Append(model.RunRecord{ RunID: runID, Agent: ..., ... })

// === cli/eval.go (新建) ===
func newLeaderboardCmd(deps Deps) *cobra.Command {
	var limit int
	cmd := &cobra.Command{
		Use:   "leaderboard",
		Short: "Aggregate run success/reuse rates from run history",
		RunE: func(c *cobra.Command, args []string) error {
			g := globalFlags(c)
			lb, err := deps.Services.Eval.Leaderboard(c.Context(), limit)
			if err != nil { return err }
			if g.JSON { return jsonWrite(c.OutOrStdout(), lb) }
			return RenderLeaderboard(c.OutOrStdout(), lb)
		},
	}
	cmd.Flags().IntVar(&limit, "limit", 0, "aggregate only the most recent N runs (0=all)")
	return cmd
}
func newScoreCmd(deps Deps) *cobra.Command {
	var runID, note string
	cmd := &cobra.Command{
		Use:   "score [up|down]",
		Short: "Attach thumbs feedback to a run (default: most recent)",
		Args:  cobra.ExactArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			if err := deps.Services.Eval.Score(c.Context(), model.ScoreRequest{
				RunID: runID, Score: args[0], Note: note,
			}); err != nil { return err }
			fmt.Fprintf(c.OutOrStdout(), "recorded %s feedback\n", args[0])
			return nil
		},
	}
	cmd.Flags().StringVar(&runID, "run", "", "run id (default: most recent run)")
	cmd.Flags().StringVar(&note, "note", "", "optional feedback note")
	return cmd
}

// === cli/render.go (新增) ===
func RenderLeaderboard(w io.Writer, lb *model.Leaderboard) error {
	if lb == nil || len(lb.Rows) == 0 { return render.Linef(w, "(no runs yet)") }
	tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "AGENT\tRUNTIME\tRUNS\tSUCCESS%\tREUSE%\tUP\tDOWN")
	for _, r := range lb.Rows {
		fmt.Fprintf(tw, "%s\t%s\t%d\t%.0f\t%.0f\t%d\t%d\n",
			r.Agent, r.Runtime, r.Runs, r.SuccessRate*100, r.ReuseRate*100, r.ThumbsUp, r.ThumbsDown)
	}
	return tw.Flush()
}

// === cli/root.go ===
// root.AddCommand(newLeaderboardCmd(deps))
// root.AddCommand(newScoreCmd(deps))

// === cmd/avm/main.go (Container 字面量) ===
// Eval: service.NewEvaluator(log),

// === service/container.go ===
// Eval EvalService
```

**怎么验证**:1) go build ./... 通过；go vet ./...。2) 单测 service/eval_test.go：构造 fake runlog.Log（仿 cli_fakes_test.go 风格）喂入若干 RunRecord（含 ExitCode 0/非0、同一 agent 多次），断言 SuccessRate/ReuseRate/AvgDurationMs/排序正确。3) runlog AppendFeedback 测：Append 两条→AppendFeedback(runID)→List 验证对应行 Feedback.Score 被写入且其它行不变、行数不变。4) 端到端：AVM_HOME=tmp，avm run 后 avm leaderboard 应出现该 agent；avm score up 后再 avm leaderboard 的 UP 列 +1；avm leaderboard --json 输出可被解析为 model.Leaderboard。5) 向后兼容：手写一条无 run_id/feedback 的旧 jsonl 行，List/Leaderboard 不报错。

**风险**
- AppendFeedback 用全量 rewrite，runs.jsonl 很大时有 O(n) 重写成本——v0 数据量小可接受，留待后续改增量/索引。
- RunID 为空的旧记录无法被 score 精确定位，只能 fallback 到 agent+started_at；本 v0 直接要求新 run 才有 run_id，旧记录 score 不支持。
- 复用率口径粗（run 次数占比），并非真正的'跨 agent 复用'语义，可能误导——已在 out_of_scope 注明只做调用频次代理指标。
- 并发：rewrite 与 Append 共用 l.mu 串行化，但跨进程并发写仍可能竞争（与现状一致，不在本实验解决）。
- Run 主链路当前 Append 用 _ = 忽略错误；加 RunID 不改变该容错策略，不阻塞 run。

**本次明确不做(留给后续)**
- 不做真正的成本/token/质量评测，仅用 exit_code + 耗时 + thumbs 这些已有/最便宜的信号。
- 不做'复用率'的精确语义（如被多少不同项目/agent 引用），v0 仅用 run 次数占比作代理。
- 不做交互式 run 后自动弹 👍/👎 prompt（CLI 是 plumbing，交互留给 TS/UI 层；本实验只给 avm score 命令做 hook 入口）。
- 不改 runlog 存储格式为 DB/索引；保持 append-only jsonl + 全量 rewrite。
- 不做时间窗/趋势/per-runtime 健康分衰减，只做静态聚合快照。
- 不给旧的无 run_id 历史记录补 id 或迁移。
- emoji 渲染（👍/👎）不在 Go CLI 做，CLI 用 up/down 文本，emoji 映射留给 UI 层。

---

### ④ Mini App 薄壳（消费形态探针）：给 1 个 AVM agent 套一个网页表单（params 旋钮），提交后服务端在 boundary 内 one-shot 跑 agent，捕获输出并用最朴素的 render_template 渲染产物。目的是用最小代码暴露出 AVM schema 为了支撑「开发者配置 → 普通人能用的产品」这条链路，到底还差哪些字段（params / render_template）和哪条执行能力（非交互 one-shot run + 输出捕获）。

**目标**:用一个 HTTP 薄壳 + AVM 最小 schema 扩展（params/render），证明「Agora 的 params 旋钮」可以从 agent 定义自动生成网页表单，并在 boundary 内安全代跑出可渲染产物。

**验证假设**:Agora 的核心假设是「开发者配置的 agent 可以直接变成普通人能用的产品」。当前 AVM 缺两样东西就走不通：(1) 一个能把用户输入（params）喂给 agent 并捕获其文本产物的「非交互 one-shot run」——现有 avm run 只能交互式接管 stdio（LaunchSpec.Stdin=true，process.OS.Run 直接把 cmd.Stdout 接到 os.Stdout）；(2) Agent schema 里描述「这个 agent 对外暴露哪些旋钮 / 产物怎么渲染」的字段（params / render）。本实验通过最小落地验证：只要补上 Agent.Params + Agent.Render + 一个 `avm run --exec --json` one-shot 通道，薄壳就能纯靠 avm --json 把一个 agent 变成一个可填表、可出结果的网页。

**工作量**:M　|　**成功标准**:一个外行用户（不碰任何 CLI/yaml）能在浏览器里：打开 /a/<agent> → 看到由 Agent.Params 自动生成的表单 → 填写并提交 → 在 boundary 内代跑后看到渲染产物。代码层面：avm 只新增 ≤2 个 schema 字段(Params/Render)+1 条 one-shot 通道(RunExec/--exec)，薄壳 0 新依赖、≤200 行 stdlib。明确产出一份『AVM schema 还差什么』的结论：params 描述够不够生成表单、render 最朴素 text/template 够不够出产物。

**复用 AVM 已有原语**
- /tmp/avm-src/internal/app/model/agent.go (Agent/Identity/Instructions 结构体 — 在此新增 Params/Render 字段)
- /tmp/avm-src/internal/app/model/run.go (RunRequest/RunResult — 新增 Params 输入与 Output 捕获字段)
- /tmp/avm-src/internal/presentation/cli/run.go (newRunCmd 的 cobra 注册与 --json 分支 — 新增 --exec/--param 标志)
- /tmp/avm-src/internal/app/service/run.go (Runner.Run 的 loadPlan→apply→spawn 全流程 — 复用，新增 RunExec 走捕获式 process 调用)
- /tmp/avm-src/internal/infra/process/runner.go (process.OS.Run / Result — 新增 RunCaptured 捕获 stdout)
- /tmp/avm-src/internal/runtime/types.go (LaunchSpec — 新增 PromptStdin/Capture 语义)
- /tmp/avm-src/internal/runtime/codex/driver.go (LaunchSpec — 复用 boundary，新增 exec 模式 args: codex exec --json)
- /tmp/avm-src/internal/runtime/boundary.go + driver Boundary() (CODEX_HOME/HOME 隔离 — 直接复用，薄壳不碰隔离)
- /tmp/avm-src/ui/src/avm-client.ts (run<T>(binary, ['--json', ...args]) shell-out 模式 — 服务端薄壳照搬这套 spawn+parse JSON)
- /tmp/avm-src/ui/src/protocol.ts (zod schema 模式 — 薄壳服务端复用相同的 JSON 契约)

**新增表面(命令/字段/服务/接口/文件)**

| 类型 | 名称 | 说明 |
|---|---|---|
| struct_field | `Agent.Params` | 在 /tmp/avm-src/internal/app/model/agent.go 的 Agent 结构体新增 `Params []ParamSpec yaml:"params,omitempty" json:"params,omitempty"`。ParamSpec 是最小字段集：Name/Label/Type(string|text|number|enum)/Required/Default/Options/Description。这是 Agora『params 旋钮』在 AVM schema 的落点。 |
| struct_field | `Agent.Render` | 新增 `Render *RenderSpec yaml:"render,omitempty" json:"render,omitempty"`。RenderSpec 最小字段：Mode(text|markdown，默认 text) + Template(Go text/template 字符串，可引用 {{.Output}} 和 {{.Params.xxx}}，留空则原样回显 Output)。最朴素的『render 先用最朴素方式出』。 |
| command | `avm run --exec --param k=v --json` | 给 newRunCmd 加 --exec(bool，切换到 one-shot 捕获模式) 和 --param(StringArray，k=v，可重复)。--exec --json 时，把 params 注入 prompt，非交互跑 agent，捕获 stdout 文本，按 Agent.Render 渲染，输出 RunExecResult JSON。 |
| struct_field | `RunRequest.Params + RunExecResult` | run.go model 新增 RunRequest.Params map[string]string；新增 RunExecResult{Agent,Runtime,RawOutput,Rendered,ExitCode,Warnings}。 |
| service | `RunService.RunExec` | service/run.go 的 RunService 接口 + Runner 新增 RunExec(ctx, req)：复用 loadPlan/apply，但走 drv.LaunchSpec 的 exec 变体 + process.RunCaptured 捕获 stdout，再 model 层 renderOutput(agent.Render, raw, params)。 |
| file | `cmd/miniapp/main.go` | 新增独立薄壳二进制（不污染 avm core）：一个 net/http 服务端，GET /a/{agent} 读 `avm --json agent show` 拿 Params 自动生成 HTML 表单；POST /a/{agent}/run 在内部 spawn `avm --json run <agent> --exec --param ...` 拿 RunExecResult，把 Rendered 塞进 HTML 模板返回。 |
| endpoint | `POST /a/{agent}/run` | 薄壳的代跑端点：表单提交→服务端 shell-out avm（boundary 隔离天然继承，薄壳自己不开沙箱）→渲染产物。 |

**要改的文件**

- `/tmp/avm-src/internal/app/model/agent.go` — Agent 结构体新增 Params []ParamSpec 和 Render *RenderSpec 两个字段；新增 ParamSpec、RenderSpec 类型定义；Validate() 里加 params name 唯一性 + type 枚举校验（最小）。
- `/tmp/avm-src/internal/app/model/run.go` — RunRequest 新增 Params map[string]string;新增 RunExecResult 结构体(Agent,Runtime,RawOutput,Rendered,ExitCode,Warnings)。
- `/tmp/avm-src/internal/app/model/render.go (新文件)` — 新增 RenderOutput(spec *RenderSpec, raw string, params map[string]string) (string, error)：spec 为 nil 或 Template 空时直接返回 raw；否则用 text/template 渲染 {{.Output}}/{{.Params}}。纯函数，便于单测。
- `/tmp/avm-src/internal/infra/process/runner.go` — 新增 RunCaptured(ctx, spec) (CapturedResult, error)：与 Run 同构，但 cmd.Stdout 接 bytes.Buffer 捕获、stdin 喂 spec.PromptStdin；CapturedResult{ExitCode, Stdout, Stderr}。Runner 接口加 RunCaptured。
- `/tmp/avm-src/internal/runtime/types.go` — LaunchSpec 新增 PromptStdin string(非空则作为 stdin 喂入) 与隐含 capture 语义（capture 由 service 选择 RunCaptured 决定，不必加字段）。
- `/tmp/avm-src/internal/runtime/driver.go` — Driver 接口新增 ExecLaunchSpec(ctx, agent, plan, prompt string) (LaunchSpec, error)（非交互 one-shot 变体）；codex 实现，claude-code/opencode 先返回 unsupported error（out_of_scope 占位）。
- `/tmp/avm-src/internal/runtime/codex/driver.go` — 实现 ExecLaunchSpec：复用 Boundary/env，args 改为 codex exec --json（非交互），把 prompt 作为参数或 stdin（按 codex exec 约定，初版用 stdin），Stdin 改由 PromptStdin 供给。
- `/tmp/avm-src/internal/app/service/run.go` — RunService 接口加 RunExec；Runner.RunExec 复用 loadPlan+drift gate+Writer.Apply，然后 drv.ExecLaunchSpec(prompt=buildPrompt(agent,params)) → s.Process.RunCaptured → model.RenderOutput → 返回 RunExecResult。新增 buildPrompt(agent, params) 把 params 拼成给 agent 的输入文本。
- `/tmp/avm-src/internal/presentation/cli/run.go` — newRunCmd 加 --exec(bool) 与 --param(StringArray k=v);当 --exec 时调 deps.Services.Run.RunExec，--json 输出 RunExecResult，否则打印 Rendered。
- `/tmp/avm-src/cmd/miniapp/main.go (新文件，新二进制)` — net/http 薄壳：解析 avm 二进制路径(flag/env)；/a/{agent} GET 渲染表单(从 agent show 的 Params)；POST 调 avm run --exec --json 渲染产物。纯 stdlib，无新依赖。
- `/tmp/avm-src/internal/presentation/cli/agent.go` — 确认 agent show 的 --json 输出（AgentDetail.Agent）已包含新 Params/Render 字段（因 JSON tag 自动带出，无需改逻辑，仅核对）。

**关键代码骨架(可照敲)**

```go
// ---------- 1) model/agent.go: params + render 最小 schema ----------
// Agent 结构体新增两个字段
type Agent struct {
    Identity     Identity        `yaml:\"identity\"           json:\"identity\"`
    Instructions Instructions    `yaml:\"instructions\"       json:\"instructions\"`
    Skills       []CapabilityRef `yaml:\"skills,omitempty\"   json:\"skills,omitempty\"`
    MCP          []CapabilityRef `yaml:\"mcp,omitempty\"      json:\"mcp,omitempty\"`
    Runtimes     []RuntimePref   `yaml:\"runtimes,omitempty\" json:\"runtimes,omitempty\"`
    Params       []ParamSpec     `yaml:\"params,omitempty\"   json:\"params,omitempty\"`   // NEW: Agora 旋钮
    Render       *RenderSpec     `yaml:\"render,omitempty\"   json:\"render,omitempty\"`   // NEW: 产物渲染
}

// ParamSpec 是「普通人填的一个表单字段」的最小描述。
type ParamSpec struct {
    Name        string   `yaml:\"name\"                  json:\"name\"`        // 机器名，prompt 占位用
    Label       string   `yaml:\"label,omitempty\"       json:\"label,omitempty\"`       // 表单上显示给人看
    Type        string   `yaml:\"type,omitempty\"        json:\"type,omitempty\"`        // string|text|number|enum，空=string
    Required    bool     `yaml:\"required,omitempty\"    json:\"required,omitempty\"`
    Default     string   `yaml:\"default,omitempty\"     json:\"default,omitempty\"`
    Options     []string `yaml:\"options,omitempty\"     json:\"options,omitempty\"`     // type=enum 时的选项
    Description string   `yaml:\"description,omitempty\" json:\"description,omitempty\"`
}

type RenderSpec struct {
    Mode     string `yaml:\"mode,omitempty\"     json:\"mode,omitempty\"`     // text|markdown，空=text
    Template string `yaml:\"template,omitempty\" json:\"template,omitempty\"` // 空=原样回显 Output
}

var paramTypes = map[string]bool{\"\": true, \"string\": true, \"text\": true, \"number\": true, \"enum\": true}

func (a *Agent) Validate() error {
    if a == nil { return errors.New(\"agent: nil\") }
    if !agentNameRE.MatchString(a.Identity.Name) {
        return errors.New(\"agent: identity.name must match [a-z][a-z0-9-]{0,62}\")
    }
    seen := map[string]struct{}{}
    for _, p := range a.Params {
        if p.Name == \"\" { return errors.New(\"agent: param.name required\") }
        if _, dup := seen[p.Name]; dup { return fmt.Errorf(\"agent: duplicate param %q\", p.Name) }
        seen[p.Name] = struct{}{}
        if !paramTypes[p.Type] { return fmt.Errorf(\"agent: param %q has unknown type %q\", p.Name, p.Type) }
        if p.Type == \"enum\" && len(p.Options) == 0 { return fmt.Errorf(\"agent: enum param %q needs options\", p.Name) }
    }
    return nil
}

// ---------- 2) model/render.go (新文件): 最朴素渲染 ----------
package model
import (\"bytes\"; \"text/template\")
type renderData struct { Output string; Params map[string]string }
func RenderOutput(spec *RenderSpec, raw string, params map[string]string) (string, error) {
    if spec == nil || spec.Template == \"\" { return raw, nil } // 朴素默认：原样回显
    t, err := template.New(\"render\").Parse(spec.Template)
    if err != nil { return raw, err }
    var b bytes.Buffer
    if err := t.Execute(&b, renderData{Output: raw, Params: params}); err != nil { return raw, err }
    return b.String(), nil
}

// ---------- 3) model/run.go: 输入 params + 捕获式结果 ----------
type RunRequest struct {
    Agent       string            `json:\"agent\"`
    Runtime     string            `json:\"runtime,omitempty\"`
    DriftPolicy DriftPolicy       `json:\"drift_policy,omitempty\"`
    Params      map[string]string `json:\"params,omitempty\"`  // NEW
}
type RunExecResult struct {
    Agent     string    `json:\"agent\"`
    Runtime   string    `json:\"runtime\"`
    RawOutput string    `json:\"raw_output\"`
    Rendered  string    `json:\"rendered\"`
    ExitCode  int       `json:\"exit_code\"`
    Warnings  []Warning `json:\"warnings,omitempty\"`
}

// ---------- 4) process/runner.go: 捕获式跑 ----------
type CapturedResult struct { ExitCode int; Stdout, Stderr string }
type Runner interface {
    Run(ctx context.Context, spec runtime.LaunchSpec) (Result, error)
    RunCaptured(ctx context.Context, spec runtime.LaunchSpec) (CapturedResult, error) // NEW
}
func (OS) RunCaptured(ctx context.Context, spec runtime.LaunchSpec) (CapturedResult, error) {
    if spec.Bin == \"\" { return CapturedResult{}, errors.New(\"process: empty Bin\") }
    cmd := exec.CommandContext(ctx, spec.Bin, spec.Args...)
    var out, errb bytes.Buffer
    cmd.Stdout = &out; cmd.Stderr = &errb
    if spec.PromptStdin != \"\" { cmd.Stdin = strings.NewReader(spec.PromptStdin) }
    if spec.Workdir != \"\" { cmd.Dir = spec.Workdir }
    if len(spec.Env) > 0 { env := make([]string,0,len(spec.Env)); for k,v := range spec.Env { env = append(env, k+\"=\"+v) }; cmd.Env = env }
    err := cmd.Run()
    res := CapturedResult{Stdout: out.String(), Stderr: errb.String()}
    if err != nil {
        if ctx.Err() != nil { return CapturedResult{ExitCode:-1}, ctx.Err() }
        var ee *exec.ExitError
        if errors.As(err, &ee) { res.ExitCode = ee.ExitCode(); return res, nil }
        return CapturedResult{ExitCode:-1, Stdout: out.String(), Stderr: errb.String()}, err
    }
    res.ExitCode = cmd.ProcessState.ExitCode()
    return res, nil
}

// ---------- 5) runtime/types.go: LaunchSpec 加 PromptStdin ----------
type LaunchSpec struct {
    Bin, Workdir string
    Args []string
    Env  map[string]string
    Stdin       bool
    PromptStdin string // NEW: 非空 → RunCaptured 把它喂给子进程 stdin
}

// ---------- 6) runtime/driver.go + codex: ExecLaunchSpec one-shot ----------
// driver.go 接口新增：
ExecLaunchSpec(ctx context.Context, agent *model.Agent, plan *Plan, prompt string) (LaunchSpec, error)
// codex/driver.go 实现（复用 Boundary，args 走 codex exec 非交互）：
func (d *Driver) ExecLaunchSpec(ctx context.Context, agent *model.Agent, plan *runtime.Plan, prompt string) (runtime.LaunchSpec, error) {
    facts, err := d.Facts(ctx); if err != nil { return runtime.LaunchSpec{}, err }
    if !facts.Available { return runtime.LaunchSpec{}, errors.New(\"codex: binary not available\") }
    bnd, err := d.Boundary(ctx, agent); if err != nil { return runtime.LaunchSpec{}, err }
    env := inheritEnviron(os.Environ()); for k,v := range bnd.Env { env[k]=v }
    ws := boundaryWorkspaceDir(bnd.StateDir)
    return runtime.LaunchSpec{
        Bin:  facts.BinaryPath,
        Args: []string{\"exec\", \"--cd\", ws, \"--json\"}, // codex 非交互 one-shot；prompt 走 stdin
        Env:  env, Workdir: ws,
        PromptStdin: prompt,
    }, nil
}

// ---------- 7) service/run.go: RunExec ----------
type RunService interface {
    Preview(ctx context.Context, req model.RunRequest) (*model.RunPreview, error)
    Run(ctx context.Context, req model.RunRequest) (*model.RunResult, error)
    RunExec(ctx context.Context, req model.RunRequest) (*model.RunExecResult, error) // NEW
}
func (s *Runner) RunExec(ctx context.Context, req model.RunRequest) (*model.RunExecResult, error) {
    agent, drv, plan, _, rtName, err := s.loadPlan(ctx, req)
    if err != nil { return nil, err }
    // 复用 drift gate + apply（与 Run 相同的前半段，抽成 applyManaged(ctx,req,plan...) 共用）
    if err := s.applyManaged(ctx, req, agent, plan, rtName); err != nil { return nil, err }
    prompt := buildPrompt(agent, req.Params)
    spec, err := drv.ExecLaunchSpec(ctx, agent, plan, prompt)
    if err != nil { return nil, WrapError(CodeRuntimePlanFailure, err, \"exec launch spec\", map[string]any{\"runtime\":rtName}) }
    cap, runErr := s.Process.RunCaptured(ctx, spec)
    if runErr != nil { return nil, WrapError(CodeRuntimeBinaryMissing, runErr, \"runtime exec failed\", map[string]any{\"runtime\":rtName}) }
    rendered, rerr := model.RenderOutput(agent.Render, cap.Stdout, req.Params)
    if rerr != nil { plan.Warnings = append(plan.Warnings, model.Warning{Code:\"render.template-failed\", Message: rerr.Error()}) ; rendered = cap.Stdout }
    return &model.RunExecResult{Agent: agent.Identity.Name, Runtime: rtName, RawOutput: cap.Stdout, Rendered: rendered, ExitCode: cap.ExitCode, Warnings: plan.Warnings}, nil
}
func buildPrompt(a *model.Agent, params map[string]string) string {
    var b strings.Builder
    b.WriteString(a.Instructions.System); b.WriteString(\"\\n\\n\")
    for _, p := range a.Params {
        v := params[p.Name]; if v == \"\" { v = p.Default }
        fmt.Fprintf(&b, \"%s: %s\\n\", firstNonEmpty(p.Label, p.Name), v)
    }
    return b.String()
}

// ---------- 8) cli/run.go: --exec / --param ----------
var execMode bool
var rawParams []string
cmd.Flags().BoolVar(&execMode, \"exec\", false, \"one-shot non-interactive run; capture & render output\")
cmd.Flags().StringArrayVar(&rawParams, \"param\", nil, \"param as key=value (repeatable)\")
// 在 RunE 内，preview 分支之后：
if execMode {
    req.Params = parseParams(rawParams) // split on first '='
    res, err := deps.Services.Run.RunExec(c.Context(), req)
    if err != nil { return err }
    if g.JSON { return jsonWrite(c.OutOrStdout(), res) }
    fmt.Fprintln(c.OutOrStdout(), res.Rendered)
    if res.ExitCode != 0 { return &exitCodeError{code: res.ExitCode} }
    return nil
}

// ---------- 9) cmd/miniapp/main.go: 薄壳 skeleton（纯 stdlib，照搬 avm-client shell-out 模式）----------
package main
import (\"bytes\";\"encoding/json\";\"fmt\";\"html/template\";\"net/http\";\"os\";\"os/exec\";\"strings\")
var avmBin = envOr(\"AVM_BIN\", \"avm\")
type paramSpec struct{ Name, Label, Type, Default, Description string; Required bool; Options []string }
type agentDetail struct{ Agent struct{ Identity struct{ Name, Description string } ; Params []paramSpec ; Render *struct{ Mode, Template string } } }
type execResult struct{ Rendered string `json:\"rendered\"`; RawOutput string `json:\"raw_output\"`; ExitCode int `json:\"exit_code\"` }

func avmJSON(args []string, stdin string, v any) error { // 照搬 avm-client.ts 的 run()
    cmd := exec.Command(avmBin, append([]string{\"--json\"}, args...)...)
    if stdin != \"\" { cmd.Stdin = strings.NewReader(stdin) }
    var out, errb bytes.Buffer; cmd.Stdout=&out; cmd.Stderr=&errb
    if err := cmd.Run(); err != nil { return fmt.Errorf(\"avm %v: %s\", args, errb.String()) }
    return json.Unmarshal(out.Bytes(), v)
}
func formHandler(w http.ResponseWriter, r *http.Request) { // GET /a/{agent}
    name := strings.TrimPrefix(r.URL.Path, \"/a/\")
    var d agentDetail
    if err := avmJSON([]string{\"agent\",\"show\",name}, \"\", &d); err != nil { http.Error(w, err.Error(), 500); return }
    formTmpl.Execute(w, d) // 渲染 <form>：每个 param 一个 input/select/textarea
}
func runHandler(w http.ResponseWriter, r *http.Request) { // POST /a/{agent}/run
    name := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, \"/a/\"), \"/run\")
    r.ParseForm()
    args := []string{\"run\", name, \"--exec\"}
    for k := range r.PostForm { args = append(args, \"--param\", k+\"=\"+r.PostForm.Get(k)) }
    var res execResult
    if err := avmJSON(args, \"\", &res); err != nil { http.Error(w, err.Error(), 500); return }
    resultTmpl.Execute(w, res) // 渲染 res.Rendered（mode=markdown 时可后续接 md→html）
}
func main() {
    http.HandleFunc(\"/a/\", func(w http.ResponseWriter, r *http.Request){
        if strings.HasSuffix(r.URL.Path, \"/run\") && r.Method == http.MethodPost { runHandler(w,r); return }
        formHandler(w,r)
    })
    fmt.Println(\"miniapp on :8787\"); http.ListenAndServe(\":8787\", nil)
}
// formTmpl/resultTmpl 用 html/template；param.Type=text→textarea, enum→select(options), 其余→input。
```

**怎么验证**:1) 单测：model.RenderOutput 三态（spec=nil 回显 / template 渲染 {{.Output}}+{{.Params.x}} / 模板语法错误回退 raw）；Agent.Validate 的 params 唯一性+enum 校验；buildPrompt 拼接。2) process.RunCaptured 用一个 fake bin（echo/cat 脚本，复用 runner_test.go 现有 fake-binary 套路）验证 stdout 捕获 + PromptStdin 喂入。3) 端到端冒烟：建一个带 params+render 的 agent yaml（runtimes: codex），`avm --json run <agent> --exec --param topic=foo`，断言 stdout 是合法 RunExecResult JSON 且 rendered 非空（若本机无 codex 二进制，用一个 stub runtime / fake LaunchSpec.Bin=cat 验证管线，把真实 codex exec 留到手测）。4) 薄壳：go run ./cmd/miniapp，浏览器开 /a/<agent> 看到自动生成的表单，提交后页面显示 Rendered 产物。截图存证。

**风险**
- codex exec 的真实非交互接口/输出格式未在本仓库验证——`codex exec --json` 的 stdout 可能是事件流而非纯文本产物，RawOutput 可能需要再解析（初版接受『RawOutput=整段 stdout』，把『解析 codex 事件取最终消息』列为后续）。
- one-shot 模式下 boundary 首跑可能触发 codex 重新登录(codex.auth-fork risk)，薄壳代跑场景下没有交互终端会卡住——需在 RunExec 设超时(context.WithTimeout) 并把『需要交互』作为结构化错误返回。
- 薄壳直接把 r.PostForm 透传成 --param，存在参数注入/越权风险（如用户传 --runtime 之类）——必须只接受 agent.Params 里声明过的 name，其余丢弃（白名单校验放在 runHandler）。
- applyManaged 抽取自现有 Run 前半段，若抽错会同时影响交互式 run——需保证抽取是纯重构 + 原 Run 测试全绿。
- html/template 直接渲染 agent 输出，若 render.mode=markdown 未做转义/净化会有 XSS——初版只做 text 模式(pre 包裹)，markdown→HTML 列为 out_of_scope。

**本次明确不做(留给后续)**
- 多轮对话 / 会话保持——本探针只做单次 params→产物 one-shot。
- claude-code / opencode 的 ExecLaunchSpec 实现——初版只打通 codex，其余 driver 返回 unsupported error 占位。
- 解析 codex exec 事件流提取『最终答案』——初版 RawOutput=整段 stdout。
- render 的 markdown→HTML 渲染 / 富文本 / 图片产物——初版只 text 模式 <pre> 回显。
- 鉴权 / 多租户 / 速率限制 / 持久化历史——薄壳是单机探针。
- 表单字段的复杂校验(正则/范围/文件上传)——只做 required + type 四种。
- 把薄壳并进 ui/(React)——初版用独立 Go stdlib 二进制 cmd/miniapp，避免牵动现有 ink TUI。
- 并发跑同一 agent 的 boundary 竞争(Writer.Apply 重入)——单机单请求探针先不处理。

---

### AVM Hub — remote registry (distribution-layer MVP): a static-file "agent npm registry" that the existing .avm.zip export/install plugs into, plus three new CLI verbs publish / search / install role@ver.

**目标**:把已实现的 .avm.zip export/install 接上一个共享中心：静态 HTTP 文件服务器 + index.json 索引 + CLI publish/search/install <role>@<ver>，让 install 能从远程按 role@version 拉取并复用现有安装流水线。

**验证假设**:Agora 路线的核心假设是"agent 角色可以像 npm 包一样被全局发现、寻址、分发"。本实验用最小代价验证：在不改动 packageio/.avm.zip 格式和 capstore 内容寻址的前提下，仅靠一个 index.json + 静态文件托管 + 一个 registry client，就能把单机 export/install 升级成跨机器的 publish→search→install role@ver 链路。

**工作量**:M　|　**成功标准**:在两个独立 AVM_HOME（模拟两台机器）之间，能用 publish→静态托管→search→install role@ver 完成一次 agent 角色的跨机分发，install 后 `avm list` 出现该 agent 且其引用的 skill/MCP 已通过 capstore 内容寻址正确导入；全程不修改 .avm.zip 格式与 packageio/capstore 既有逻辑（仅新增），go test ./internal/... 通过。

**复用 AVM 已有原语**
- /tmp/avm-src/internal/infra/packageio/packageio.go (.avm.zip Read/Write/Verify + checksum 校验，复用做发布前校验和拉取后校验)
- /tmp/avm-src/internal/app/service/package.go (Packages.Install/Export，Install 现在只吃本地 req.Source；Export 产出 .avm.zip)
- /tmp/avm-src/internal/app/model/package.go (PackageManifest / InstallRequest / PackageSummary)
- /tmp/avm-src/internal/infra/capstore/store.go (内容寻址 deriveID + Add 幂等去重，install 拉远程包后仍走它导入 caps，无需改动)
- /tmp/avm-src/internal/presentation/cli/package.go (cobra 子命令注册模式 newPackage*Cmd + deps.Services.Packages)
- /tmp/avm-src/internal/presentation/cli/root.go (Deps / globalFlags / wrapAllRunE 错误渲染)
- /tmp/avm-src/internal/app/service/container.go (service.Container，新增 Registry 服务挂这里)
- /tmp/avm-src/cmd/avm/main.go (buildDeps 组合根，新增 registry client 构造)
- /tmp/avm-src/internal/infra/home/layout.go (Layout，新增 RegistryCacheDir / registry 配置路径)
- /tmp/avm-src/internal/app/service/errors.go (复用 CodePackageNotFound / CodePackageChecksum / CodeIOFailure，新增 CodeRegistryUnreachable)

**新增表面(命令/字段/服务/接口/文件)**

| 类型 | 名称 | 说明 |
|---|---|---|
| command | `avm package publish <file.avm.zip>` | 把本地 .avm.zip 上传/拷贝到 registry，并更新 index.json。MVP 第一版只支持 file:// 或本地目录型 registry（写盘 + 重写 index.json）；http 上传留给后续。flags: --registry <url|dir>（默认读配置/AVM_REGISTRY 环境变量）。 |
| command | `avm package search <query>` | 拉取远程 index.json，对 name/description 做子串匹配，渲染 PackageSummary 列表（复用 RenderPackageList）。flags: --registry, --json。 |
| command | `avm package install <role>@<ver>` | 扩展现有 install：若 arg 不是本地文件而匹配 <role>[@<ver>] 形式，则查 index.json 解析出 .avm.zip 的 URL，下载到 RegistryCacheDir，校验 checksum，再走现有 Packages.Install 本地流水线。 |
| struct_field | `RegistryIndex / RegistryEntry` | 新文件 internal/app/model/registry.go：index.json 的最小 schema（schema_version + entries[]，每条含 name/version/description/author/path/checksum/size/published_at）。 |
| service | `RegistryService` | 新文件 internal/app/service/registry.go：Search/Resolve/Publish/FetchToCache。挂到 service.Container.Registry。封装 client + 与 PackageService 协作。 |
| service | `registryclient.Client` | 新 infra 包 internal/infra/registryclient/client.go：抽象 GetIndex()/FetchBlob(path)→ReadCloser/PutBlob+WriteIndex（仅本地/file 后端实现 Put）。http 后端只读。 |
| config | `RegistryCacheDir / registry config` | home.Layout 新增 RegistryCacheDir()（~/.avm/registry-cache）。默认 registry 来源：--registry flag > AVM_REGISTRY 环境变量 > 内置默认（空则报错提示配置）。 |
| file | `index.json 索引格式` | registry 根下 index.json，最小寻址：name+version→相对 blob 路径(blobs/<name>/<version>.avm.zip)+sha256。无 semver range，install 不带 @ver 时取 entries 中该 name 的最高 published_at。 |

**要改的文件**

- `/tmp/avm-src/internal/app/model/registry.go` — 新建。定义 RegistryIndex{SchemaVersion string; Entries []RegistryEntry} 和 RegistryEntry{Name,Version,Description,Author,Path,Checksum string; Size int64; PublishedAt time.Time}。JSON tag 全小写下划线。复用 PackageSummary 做 search 输出投影。
- `/tmp/avm-src/internal/infra/registryclient/client.go` — 新建 infra 包。定义 Client interface{GetIndex(ctx)(*model.RegistryIndex,error); FetchBlob(ctx,relPath)(io.ReadCloser,error)} 和可选 Writer interface{PutBlob(ctx,relPath,r)error; WriteIndex(ctx,*model.RegistryIndex)error}。两个实现：fileBackend(本地目录/file:// URL，读写都支持) 与 httpBackend(只读，GET index.json 与 blob)。New(ref string) 按 http/https 前缀选 backend，否则当本地目录。
- `/tmp/avm-src/internal/app/service/registry.go` — 新建。RegistryService interface{Search(ctx,query)([]model.PackageSummary,error); Resolve(ctx,name,version)(*model.RegistryEntry,error); FetchToCache(ctx,*model.RegistryEntry)(localPath string,err error); Publish(ctx,file string)(*model.RegistryEntry,error)}。Registry struct 持有 Client、IO packageio.IO、CacheDir string。Resolve 无 version 时按 PublishedAt 取最新。FetchToCache 下载 blob→写 CacheDir→packageio.Verify + sha256 比对 entry.Checksum。Publish 用 IO.Read 读 manifest 取 name/version，sha256 整个文件，PutBlob+把 entry 合并进 index 后 WriteIndex（需 Client 实现 Writer，否则报 CodeValidation '该 registry 只读')。
- `/tmp/avm-src/internal/app/service/container.go` — Container 增加字段 Registry RegistryService。
- `/tmp/avm-src/internal/app/service/errors.go` — 新增 CodeRegistryUnreachable = "REGISTRY_UNREACHABLE" 和 CodeRegistryEntryNotFound = "REGISTRY_ENTRY_NOT_FOUND"（也可复用 CodePackageNotFound）。
- `/tmp/avm-src/internal/infra/home/layout.go` — 新增 func (l Layout) RegistryCacheDir() string { return filepath.Join(l.Root, "registry-cache") }，并在 EnsureDirs 的列表里加上它。
- `/tmp/avm-src/internal/presentation/cli/package.go` — 新增 newPackagePublishCmd / newPackageSearchCmd，并在 newPackageCmd 里 AddCommand。改 newPackageInstallCmd：保留 cobra arg，但在 RunE 里先判断 args[0] 是否本地存在文件；不存在且匹配 role[@ver] 正则则走 registry 分支（Resolve→FetchToCache→把返回 localPath 塞进 model.InstallRequest.Source 再调 Install）。给 install/search/publish 加 --registry string flag。
- `/tmp/avm-src/cmd/avm/main.go` — buildDeps 里构造 registry client（来源：os.Getenv("AVM_REGISTRY")，可空，命令级 --registry 覆盖）与 service.NewRegistry(client, pkgs, layout.RegistryCacheDir())，挂进 Container.Registry。注意 client 选择最好延迟到命令执行（因为 --registry 是命令级 flag）——MVP 可在 CLI RunE 内用 registryclient.New(resolvedRef) 现场构造，service 接收 client 作为方法参数或 service 持有一个 factory。
- `/tmp/avm-src/internal/presentation/cli/render.go` — 复用现有 RenderPackageList 渲染 search 结果；如需展示 version/size 可加一个 RenderRegistrySearch（可选）。

**关键代码骨架(可照敲)**

```go
// ---- internal/app/model/registry.go ----
package model
import "time"
type RegistryIndex struct {
    SchemaVersion string          `json:"schema_version"`
    Entries       []RegistryEntry `json:"entries"`
}
type RegistryEntry struct {
    Name        string    `json:"name"`
    Version     string    `json:"version"`
    Description string    `json:"description,omitempty"`
    Author      string    `json:"author,omitempty"`
    Path        string    `json:"path"`        // relative blob path, e.g. blobs/<name>/<version>.avm.zip
    Checksum    string    `json:"checksum"`    // sha256 hex of whole .avm.zip
    Size        int64     `json:"size,omitempty"`
    PublishedAt time.Time `json:"published_at"`
}

// ---- internal/infra/registryclient/client.go ----
package registryclient
type Client interface {
    GetIndex(ctx context.Context) (*model.RegistryIndex, error)
    FetchBlob(ctx context.Context, relPath string) (io.ReadCloser, error)
}
type Writer interface { // implemented by fileBackend only
    PutBlob(ctx context.Context, relPath string, r io.Reader) error
    WriteIndex(ctx context.Context, idx *model.RegistryIndex) error
}
const IndexName = "index.json"
func New(ref string) (Client, error) {
    if strings.HasPrefix(ref, "http://") || strings.HasPrefix(ref, "https://") {
        return &httpBackend{base: strings.TrimRight(ref, "/"), hc: http.DefaultClient}, nil
    }
    dir := strings.TrimPrefix(ref, "file://")
    if dir == "" { return nil, errors.New("registryclient: empty registry ref") }
    return &fileBackend{dir: dir}, nil
}
// httpBackend.GetIndex: GET base+"/index.json", json.Decode.
// httpBackend.FetchBlob: GET base+"/"+relPath -> resp.Body (caller Close).
// fileBackend.GetIndex: os.ReadFile(filepath.Join(dir, IndexName)); if not exist -> empty index.
// fileBackend.FetchBlob: os.Open(filepath.Join(dir, relPath)).
// fileBackend.PutBlob: MkdirAll + fsutil.AtomicWriteFile.
// fileBackend.WriteIndex: json.MarshalIndent + AtomicWriteFile(index.json).

// ---- internal/app/service/registry.go ----
type RegistryService interface {
    Search(ctx context.Context, c registryclient.Client, query string) ([]model.PackageSummary, error)
    Resolve(ctx context.Context, c registryclient.Client, name, version string) (*model.RegistryEntry, error)
    FetchToCache(ctx context.Context, c registryclient.Client, e *model.RegistryEntry) (string, error)
    Publish(ctx context.Context, c registryclient.Client, file string) (*model.RegistryEntry, error)
}
type Registry struct { IO packageio.IO; CacheDir string }
func NewRegistry(io packageio.IO, cacheDir string) *Registry { return &Registry{IO: io, CacheDir: cacheDir} }

func (s *Registry) Resolve(ctx context.Context, c registryclient.Client, name, version string) (*model.RegistryEntry, error) {
    idx, err := c.GetIndex(ctx)
    if err != nil { return nil, WrapError(CodeRegistryUnreachable, err, "fetch index: "+err.Error(), nil) }
    var best *model.RegistryEntry
    for i := range idx.Entries {
        e := &idx.Entries[i]
        if e.Name != name { continue }
        if version != "" && e.Version != version { continue }
        if best == nil || e.PublishedAt.After(best.PublishedAt) { best = e }
    }
    if best == nil {
        return nil, NewError(CodePackageNotFound, fmt.Sprintf("no registry entry for %s@%s", name, version), map[string]any{"name": name, "version": version})
    }
    return best, nil
}
func (s *Registry) FetchToCache(ctx context.Context, c registryclient.Client, e *model.RegistryEntry) (string, error) {
    rc, err := c.FetchBlob(ctx, e.Path)
    if err != nil { return "", WrapError(CodeRegistryUnreachable, err, "fetch blob: "+err.Error(), nil) }
    defer rc.Close()
    data, err := io.ReadAll(rc); if err != nil { return "", WrapError(CodeIOFailure, err, err.Error(), nil) }
    sum := sha256.Sum256(data)
    if e.Checksum != "" && !strings.EqualFold(hex.EncodeToString(sum[:]), e.Checksum) {
        return "", NewError(CodePackageChecksum, "registry blob checksum mismatch", map[string]any{"name": e.Name})
    }
    dst := filepath.Join(s.CacheDir, e.Name+"-"+e.Version+".avm.zip")
    if err := fsutil.AtomicWriteFile(dst, data, 0o644); err != nil { return "", WrapError(CodeIOFailure, err, err.Error(), nil) }
    if err := s.IO.Verify(dst); err != nil { return "", WrapError(CodePackageChecksum, err, err.Error(), nil) }
    return dst, nil // caller passes this as InstallRequest.Source
}
func (s *Registry) Publish(ctx context.Context, c registryclient.Client, file string) (*model.RegistryEntry, error) {
    w, ok := c.(registryclient.Writer)
    if !ok { return nil, NewError(CodeValidation, "registry is read-only; publish needs a writable (file/dir) registry", nil) }
    manifest, h, err := s.IO.Read(file); if err != nil { return nil, WrapError(CodePackageInvalidManifest, err, err.Error(), nil) }
    h.Close()
    data, _ := os.ReadFile(file)
    sum := sha256.Sum256(data)
    rel := "blobs/" + manifest.Name + "/" + manifest.Version + ".avm.zip"
    if err := w.PutBlob(ctx, rel, bytes.NewReader(data)); err != nil { return nil, WrapError(CodeIOFailure, err, err.Error(), nil) }
    idx, _ := c.GetIndex(ctx); if idx == nil { idx = &model.RegistryIndex{SchemaVersion: "1"} }
    entry := model.RegistryEntry{Name: manifest.Name, Version: manifest.Version, Description: manifest.Description,
        Author: manifest.Author, Path: rel, Checksum: hex.EncodeToString(sum[:]), Size: int64(len(data)), PublishedAt: time.Now().UTC()}
    upsert(idx, entry) // replace same name+version else append
    if err := w.WriteIndex(ctx, idx); err != nil { return nil, WrapError(CodeIOFailure, err, err.Error(), nil) }
    return &entry, nil
}
// Search: GetIndex, substring match name/description -> []PackageSummary{Name,Version,Description,Source:"registry"}.

// ---- internal/presentation/cli/package.go (install dispatch) ----
var roleAtVerRe = regexp.MustCompile(`^([a-zA-Z0-9][\w.-]*)(?:@([\w.+-]+))?$`)
func newPackageInstallCmd(deps Deps) *cobra.Command {
    var resolution, registryRef string
    cmd := &cobra.Command{ Use: "install <package-or-file-or-role@ver>", Args: cobra.ExactArgs(1),
        RunE: func(c *cobra.Command, args []string) error {
            g := globalFlags(c)
            source := args[0]
            if _, statErr := os.Stat(source); statErr != nil { // not a local file -> try registry
                if m := roleAtVerRe.FindStringSubmatch(source); m != nil {
                    ref, rerr := resolveRegistryRef(registryRef); if rerr != nil { return rerr }
                    client, cerr := registryclient.New(ref); if cerr != nil { return cerr }
                    entry, err := deps.Services.Registry.Resolve(c.Context(), client, m[1], m[2]); if err != nil { return err }
                    local, err := deps.Services.Registry.FetchToCache(c.Context(), client, entry); if err != nil { return err }
                    source = local
                }
            }
            res, err := deps.Services.Packages.Install(c.Context(), model.InstallRequest{Source: source, Resolution: model.ConflictResolution(resolution)})
            if err != nil { return err }
            if g.JSON { return jsonWrite(c.OutOrStdout(), res) }
            return renderInstallResult(c.OutOrStdout(), res)
        }}
    cmd.Flags().StringVar(&resolution, "on-conflict", "", "rename|skip|overwrite|cancel")
    cmd.Flags().StringVar(&registryRef, "registry", "", "registry URL or dir (defaults to $AVM_REGISTRY)")
    return cmd
}
func resolveRegistryRef(flag string) (string, error) {
    if flag != "" { return flag, nil }
    if v := os.Getenv("AVM_REGISTRY"); v != "" { return v, nil }
    return "", service.NewError(service.CodeValidation, "no registry configured: pass --registry or set AVM_REGISTRY", nil)
}
// newPackageSearchCmd / newPackagePublishCmd: same --registry resolution, call Registry.Search / Registry.Publish.
// newPackageCmd: cmd.AddCommand(newPackageSearchCmd(deps)); cmd.AddCommand(newPackagePublishCmd(deps)).

// ---- cmd/avm/main.go (buildDeps) ----
// Registry: service.NewRegistry(pkgs, layout.RegistryCacheDir()),  // client constructed per-command in CLI from --registry/$AVM_REGISTRY

// ---- static server (MVP, zero AVM code) ----
// A writable registry dir served read-only over HTTP:
//   ~/avm-registry/index.json
//   ~/avm-registry/blobs/<name>/<version>.avm.zip
// Publish locally:  avm package publish ./alpha.avm.zip --registry ~/avm-registry
// Serve:            (cd ~/avm-registry && python3 -m http.server 8080)
// Install remote:   avm package install alpha@0.0.0 --registry http://localhost:8080
```

**怎么验证**:端到端走通：1) 用现有 `avm package export <agent> -o alpha.avm.zip` 产出包。2) `avm package publish ./alpha.avm.zip --registry /tmp/reg` 写出 /tmp/reg/index.json + /tmp/reg/blobs/alpha/<ver>.avm.zip。3) `cd /tmp/reg && python3 -m http.server 8080` 静态托管。4) `avm package search alpha --registry http://localhost:8080` 返回该条目。5) 换一台/清空本地 agents 后 `avm package install alpha@<ver> --registry http://localhost:8080`：从 http 下载→FetchToCache 校验 checksum + packageio.Verify→落到 registry-cache→走 Packages.Install 导入 agent+caps。6) 单测：registry service Resolve(取最新版本)、FetchToCache(checksum mismatch 报 CodePackageChecksum)、fileBackend Publish round-trip(index.json upsert)、CLI install 的 local-file vs role@ver 分支判定（复用 cli_fakes_test 模式加 fakeRegistry）。`go build ./... && go test ./internal/...` 全绿。

**风险**
- install 的本地文件 vs role@ver 判定靠 os.Stat：若用户的角色名恰好和 cwd 下某文件同名会走错分支。缓解：role@ver 正则 + 仅当含 @ 或 Stat 失败时才走 registry；本地路径优先。
- httpBackend 无鉴权/无 TLS 校验定制：MVP 仅适合可信内网/localhost，公网分发不安全（任意 .avm.zip 会被安装并写入 capstore）。明确标注为 MVP。
- index.json 全量读写 + upsert 无并发锁：多 publisher 并发会丢更新。MVP 单写者假设，留 TODO。
- service.Registry 方法接收 client 参数（因 --registry 是命令级 flag）与现有 service 全部用构造注入依赖的风格略不一致；需在 PR 里说明这是为支持运行时切换 registry 的有意取舍。
- 无 semver range 解析：install foo@^1 不支持，只能精确版本或省略取最新。

**本次明确不做(留给后续)**
- HTTP 上传式 publish（POST/PUT 到远程 registry）——第一版 publish 只支持本地/file 目录后端，远程托管用静态服务器只读暴露
- 鉴权 / 签名 / 信任链 / namespace 归属（谁能 publish 哪个 name）
- semver range / dist-tags(latest,beta) / yank / 版本废弃
- 依赖解析（一个角色依赖另一个角色/包的传递安装）
- registry 端的搜索索引/分页/全文检索——MVP 客户端拉全量 index.json 本地子串匹配
- installed-package registry（service.ErrPackageRegistryNotSupported 那条 List/Show 本地已装包账本）仍维持现状，不在本实验内
- GC / 缓存淘汰 registry-cache
- 并发 publish 的锁与原子 index 合并
- UI(TS 前端)对接，本实验只做 Go CLI 管线

---
