#!/usr/bin/env bash
cd "$(dirname "$0")"
MAJ=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null)
[ -n "$MAJ" ] && [ "$MAJ" -ge 20 ] 2>/dev/null || { echo "需要 Node ≥20(当前 $(node -v 2>/dev/null||echo 未装))。--env-file 要求 Node20+。"; exit 1; }
[ -d node_modules ] || { echo "未装依赖,先运行: npm install"; exit 1; }
# 云端(railway 等)由平台注入 env、无 .env 文件 → 直接起;本地用 --env-file=.env。
if [ -f .env ]; then
  grep -qE 'OPENROUTER_API_KEY=sk-or-v1-' .env || echo "⚠ .env 里 OPENROUTER_API_KEY 还是占位符 —— 请填入真实 key(sk-or-v1-…),否则 LLM 调用会失败"
  exec node --env-file=.env loop-server.mjs
elif [ -n "$OPENROUTER_API_KEY" ]; then
  exec node loop-server.mjs
else
  echo "缺 .env 且环境里也没 OPENROUTER_API_KEY —— 本地请: cp .env.example .env 填 key;云端请在平台配置 OPENROUTER_API_KEY"; exit 1
fi
