# 本地提取 POC

这个目录是「本地 codex 提取能力项」新链路的可行性验证环境，不是线上代码。验证的问题：用户在本机 codex 里通过 skill 触发提取，模型按服务端下发的规范归纳会话历史，逐项经 CLI 校验后提交——这条交互链路能不能跑通、产物质量如何。

## 文件

- `combo.mjs` 是模拟未来 combo CLI 的脚本，提供两个子命令：`spec` 打印提取规范（未来这一步改为从服务端拉取），`push` 校验一个能力项定义并写入 `out/` 目录（模拟上传入库）。校验用的是 `@cb/shared` 里的真 `CapabilityDefinitionSchema`，外加 runtime loader 同款的 version 检查和一道朴素的敏感信息扫描。
- `.codex/skills/combo-extract/SKILL.md` 是项目级 codex skill：薄引导，只写硬约束和「先跑 spec 再照办」的流程，重知识都在 spec 里。
- `out/` 存放通过校验的能力项 JSON，每个文件就是一份可直接被 runtime 消费的 CapabilityDefinition v1。
- `run*.log` 是每轮 codex exec 的完整输出，用来复盘模型行为。

## 怎么跑一轮验证

在本目录下执行 `codex exec --sandbox workspace-write "请把下面这些本机会话历史文件提取成 Combo 能力项并提交：<会话 jsonl 路径列表>"`，结束后看 `out/` 里的产物和日志里模型与 push 校验的交互过程。
