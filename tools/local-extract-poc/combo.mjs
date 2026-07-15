#!/usr/bin/env node
// combo.mjs — 本地提取 POC 用的假 combo CLI。
//
// 两个子命令，模拟未来真 CLI 与本机 agent（codex / Claude Code）之间的契约：
//   spec              打印当前提取规范（未来这一步是从服务端拉取）。
//   push <file.json>  校验一个能力项定义并「入库」（写进 out/ 目录，模拟上传）。
//
// 校验用的是仓库里的真 Schema（@cb/shared 的 CapabilityDefinitionSchema），
// 外加 runtime loader 同款的 version 检查和一道朴素的敏感信息扫描——
// 这三道就是未来服务端守门的本地预演。报错全部写成模型能照着改的人话。

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');

const { CapabilityDefinitionSchema } = await import(
  join(here, '../../packages/shared/dist/domains/capability.js')
);

// ---------- 提取规范（未来由服务端下发；改这里等于服务端发新版规范）----------
const SPEC = `# Combo 能力项提取规范（v1）

## 你要产出什么

从用户的 coding agent 会话历史里，归纳出可复用的「能力项」。一个能力项 = 一类可以反复交给 AI 执行的工作流，不是对某次会话的复述。产出物是 CapabilityDefinition v1 JSON（单个对象），逐项通过 \`node combo.mjs push <file.json>\` 提交。

## JSON 字段（全部必填语义如下）

- version：固定写数字 1。
- name：中文能力名，不超过 12 字，像一个 mini 应用的名字。
- summary：一句话说明这个能力帮用户完成什么。
- kind：从「写作 / 编码 / 分析 / 结构化文档 / 工作流」中选一个。
- instructions：给执行这个能力的 AI 的系统提示词，200–800 字。这是最重要的字段：要写成「怎么干活的完整知识」，包含步骤、判断标准、输出要求。写给一个没看过原会话的 AI，它读完就能干活。
- inputs：使用者开始前要填的输入字段，0–4 个。只列真正影响产出的；没有就给空数组 []。每个字段形如 {"key":"英文标识","label":"中文名","type":"string|text|number|enum","required":true|false,"options":["仅enum时给候选"]}。
- starterPrompts：1–3 条开场提示语，使用者一键填入就能开始的起手句。
- meta：附加元信息对象。请放入 {"origin":"local-codex","sourceSessions":["提取自哪些会话文件的文件名"]}。

## 归纳口径

1. 只归纳确有支撑的能力：会话里真实走通过的工作流才算数，失败的尝试、闲聊、一次性琐事不算。
2. 宁缺毋滥：一个会话通常只有 0–3 个值得沉淀的能力项。没有就是没有，不要硬凑。
3. 提炼方法论而不是搬运细节：instructions 里写的是可迁移的做法（步骤、判断标准、坑），不是该用户某个项目的具体路径、库名、业务名词。别人拿着这个能力项处理自己的项目也应该能用。
4. 你可以读会话全文，也可以顺藤摸瓜看会话里提到的仓库文件来确认工作流的真实形态——这是你比云端提取强的地方，用好它。

## 脱敏红线（push 时会被机器扫描，违反直接拒收）

任何字段里都不得出现：API key / token / 私钥、真实邮箱、IP 地址、内网域名、可识别到个人的信息。会话原文里有这些不要紧，你的产出里不能有；需要举例时用占位符（如 <YOUR_API_KEY>、example.com）。

## 提交流程

1. 逐个会话读取分析（jsonl 每行一个事件，关注 user/assistant 消息主线）。
2. 每归纳好一个能力项，写成单个 JSON 对象存临时文件，立即 push。
3. push 报错就照错误信息修，改完重新 push 同一项。
4. 全部完成后，汇报：入库了哪几项（名字 + 一句话）、放弃了哪些候选及原因。
`;

const cmd = process.argv[2];

if (cmd === 'spec') {
  process.stdout.write(SPEC);
  process.exit(0);
}

if (cmd === 'push') {
  const file = process.argv[3];
  if (!file) {
    fail(
      '用法：node combo.mjs push <file.json>，每次 push 一个能力项定义（单个 JSON 对象，不是数组）。',
    );
  }
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    fail(`读不到文件 ${file}。请确认路径存在。`);
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    fail(`这不是合法 JSON：${e.message}。请修复后重新 push。`);
  }
  if (Array.isArray(obj)) {
    fail('push 的是 JSON 数组。每次只能 push 一个能力项对象，请逐项分开 push。');
  }
  if (obj.version !== 1) {
    fail(
      `version 必须是数字 1（当前是 ${JSON.stringify(obj.version)}）。这是运行端识别格式的硬约定。`,
    );
  }
  const parsed = CapabilityDefinitionSchema.safeParse(obj);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - 字段 ${i.path.join('.') || '(根)'}：${i.message}`,
    );
    fail(`Schema 校验没过，逐条修：\n${lines.join('\n')}`);
  }
  const def = parsed.data;

  // 朴素敏感扫描（模拟服务端守门；真实现会更全）。
  const text = JSON.stringify(def);
  const patterns = [
    [/sk-[A-Za-z0-9]{20,}/, '疑似 API key（sk-…）'],
    [/AKIA[0-9A-Z]{16}/, '疑似 AWS AccessKey'],
    [/ghp_[A-Za-z0-9]{30,}/, '疑似 GitHub token'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '私钥内容'],
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, '邮箱地址'],
    [/\b(?:\d{1,3}\.){3}\d{1,3}\b/, 'IP 地址'],
  ];
  for (const [re, label] of patterns) {
    const m = text.match(re);
    if (m) {
      fail(
        `敏感信息扫描没过：内容里有${label}（“${m[0].slice(0, 40)}…”）。能力项是给别人复用的方法论，不该包含任何具体环境的机密或个人信息，请抹掉或改成占位符后重新 push。`,
      );
    }
  }

  if (def.name.length > 24) {
    fail(
      `name 太长（${def.name.length} 字）。上限 24 字，建议 12 字以内，像一个 mini 应用的名字。`,
    );
  }

  mkdirSync(outDir, { recursive: true });
  const n = readdirSync(outDir).filter((f) => f.endsWith('.json')).length + 1;
  const dest = join(outDir, `cap-${String(n).padStart(2, '0')}.json`);
  writeFileSync(dest, JSON.stringify(def, null, 2) + '\n');
  console.log(
    `OK：能力项「${def.name}」已通过校验并入库（${dest}）。继续 push 下一个，或全部完成后汇报入库清单。`,
  );
  process.exit(0);
}

fail('未知子命令。可用：spec（打印提取规范）、push <file.json>（校验并入库一个能力项）。');

function fail(msg) {
  const plain = msg.startsWith('用法') || msg.startsWith('未知');
  console.error(plain ? msg : `push 失败：${msg}`);
  process.exit(1);
}
