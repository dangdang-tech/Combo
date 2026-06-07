#!/usr/bin/env bash
cd "$(dirname "$0")"
echo "== Agora 环境自检 =="
MAJ=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null)
if [ -n "$MAJ" ] && [ "$MAJ" -ge 20 ] 2>/dev/null; then echo "✓ node $(node -v)(≥20)"; else echo "✗ Node 版本过低或未装:需 ≥20(--env-file 要求)。当前: $(node -v 2>/dev/null||echo 未装)"; fi
[ -d node_modules ] && echo "✓ node_modules 已装" || echo "✗ 未装依赖 → 运行: npm install"
if [ -f .env ] && grep -qE 'OPENROUTER_API_KEY=sk-or-v1-' .env; then echo "✓ .env 有真实 OpenRouter key"; else echo "✗ .env 缺真实 key → cp .env.example .env 后把 OPENROUTER_API_KEY 填成你自己的 sk-or-v1-...(占位符不算)"; fi
[ -d "$HOME/.claude/projects" ] || [ -d "$HOME/.codex/sessions" ] && echo "✓ 检测到本地 AI 历史(可一键导入)" || echo "ℹ 未检测到本地历史 —— 可在导入页用『粘贴』方式喂一段对话"
which curl >/dev/null 2>&1 && echo "✓ curl 可用(fetch_url 工具需要)" || echo "ℹ 无 curl,外部读取工具会降级"
echo "自检完成。启动: npm start  → http://localhost:4190"
