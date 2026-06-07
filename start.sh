#!/usr/bin/env bash
cd "$(dirname "$0")"
[ -f .env ] || { echo "缺 .env(需 OPENROUTER_API_KEY + MODEL),见 README"; exit 1; }
exec node --env-file=.env loop-server.mjs
