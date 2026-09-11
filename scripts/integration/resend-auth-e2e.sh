#!/usr/bin/env bash
# 第一方邮件验证码认证的完整隔离端到端入口。
# 真实浏览器与 API 边界共用临时 Compose 项目；所有凭据和测试数据随项目销毁。
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

fail() {
  printf 'resend auth e2e failed: %s\n' "$1" >&2
  exit 1
}

for command_name in docker node pnpm curl; do
  command -v "$command_name" >/dev/null 2>&1 || fail "missing command: $command_name"
done
docker info >/dev/null 2>&1 || fail 'Docker daemon is unavailable'

node --input-type=module -e '
  import { existsSync } from "node:fs";
  import { chromium } from "@playwright/test";
  process.exit(existsSync(chromium.executablePath()) ? 0 : 1);
' || fail 'Playwright Chromium is unavailable; run pnpm exec playwright install chromium once'

WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
[[ "$WORKTREE_ROOT" == "$ROOT_DIR" ]] || fail 'script must run from the checked-out repository root'
SOURCE_SHA="${SOURCE_SHA:-$(git rev-parse HEAD)}"
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || fail 'SOURCE_SHA must be a full lowercase commit SHA'
[[ "$(git rev-parse HEAD)" == "$SOURCE_SHA" ]] || fail 'SOURCE_SHA does not match the checkout'

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/combo-resend-auth-e2e.XXXXXX")"
chmod 700 "$TMP_DIR"
SENTINEL_FILE="$TMP_DIR/sentinels.txt"
COOKIE_JAR="$TMP_DIR/api.cookies"
LOG_FILE="$TMP_DIR/compose.log"
: >"$SENTINEL_FILE"
PROJECT_NAME="combo-resend-auth-e2e-${RANDOM:-0}-$$"

read -r WEB_PORT RESEND_MOCK_PORT POSTGRES_PORT REDIS_HOT_PORT MINIO_API_PORT \
  MINIO_CONSOLE_PORT API_PORT <<<"$(node --input-type=module -e '
  import net from "node:net";
  const servers = Array.from({ length: 7 }, () => net.createServer());
  await Promise.all(servers.map((server) => new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  })));
  process.stdout.write(servers.map((server) => server.address().port).join(" "));
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
')"

random_value() {
  node --input-type=module -e 'import {randomBytes} from "node:crypto"; process.stdout.write(randomBytes(32).toString("base64url"));'
}

PUBLIC_APP_ORIGIN="http://127.0.0.1:${WEB_PORT}"
PUBLIC_APP_ORIGINS="$PUBLIC_APP_ORIGIN"
RESEND_MOCK_BASE_URL="http://127.0.0.1:${RESEND_MOCK_PORT}"
POSTGRES_USER=combo
POSTGRES_DB=combo
POSTGRES_PASSWORD="owner/$(random_value)#?"
POSTGRES_API_PASSWORD="$(random_value)"
# 迁移仍维护三份历史数据库角色密码；当前应用只启动 combo_api。
POSTGRES_WORKER_PASSWORD="$(random_value)"
POSTGRES_RUNTIME_PASSWORD="$(random_value)"
S3_ACCESS_KEY="$(random_value)"
S3_SECRET_KEY="$(random_value)"
GRAFANA_ADMIN_PASSWORD="$(random_value)"
RESEND_MOCK_API_KEY="$(random_value)"
RESEND_API_KEY="$RESEND_MOCK_API_KEY"
RESEND_FROM_EMAIL=no-reply@example.test
RESEND_MOCK_FROM_EMAIL="$RESEND_FROM_EMAIL"
OTP_HMAC_SECRET="$(random_value)"
COMBO_SOURCE_SHA="$SOURCE_SHA"
COMBO_RELEASE_ID="release-$SOURCE_SHA"
COMBO_BUILT_AT="$(git show -s --format=%cI "$SOURCE_SHA" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>process.stdout.write(new Date(s.trim()).toISOString()))')"
COMBO_RELEASE_MANIFEST_DIGEST="sha256:$(SOURCE_SHA="$SOURCE_SHA" node -e 'const {createHash}=require("node:crypto");process.stdout.write(createHash("sha256").update(process.env.SOURCE_SHA).digest("hex"))')"
COMBO_WEB_ASSET_MANIFEST="sha256:$(printf '0%.0s' {1..64})"

export WEB_PORT RESEND_MOCK_PORT POSTGRES_PORT REDIS_HOT_PORT MINIO_API_PORT MINIO_CONSOLE_PORT API_PORT
export PUBLIC_APP_ORIGIN PUBLIC_APP_ORIGINS RESEND_MOCK_BASE_URL
export POSTGRES_USER POSTGRES_DB POSTGRES_PASSWORD POSTGRES_API_PASSWORD
export POSTGRES_WORKER_PASSWORD POSTGRES_RUNTIME_PASSWORD S3_ACCESS_KEY S3_SECRET_KEY
export GRAFANA_ADMIN_PASSWORD RESEND_MOCK_API_KEY RESEND_API_KEY RESEND_FROM_EMAIL RESEND_MOCK_FROM_EMAIL
export OTP_HMAC_SECRET COMBO_SOURCE_SHA COMBO_RELEASE_ID COMBO_BUILT_AT
export COMBO_RELEASE_MANIFEST_DIGEST COMBO_WEB_ASSET_MANIFEST

COMPOSE=(docker compose --project-name "$PROJECT_NAME" -f infra/docker-compose.yml -f infra/docker-compose.dev-test.yml)

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  "${COMPOSE[@]}" logs --no-color >"$LOG_FILE" 2>&1 || true
  "${COMPOSE[@]}" down --volumes --remove-orphans --rmi local >/dev/null 2>&1 || status=1
  rm -rf "$TMP_DIR"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

remember() {
  [[ -n "$1" ]] || fail 'refusing to record an empty sentinel'
  printf '%s\n' "$1" >>"$SENTINEL_FILE"
}
for sentinel in "$POSTGRES_PASSWORD" "$POSTGRES_API_PASSWORD" "$POSTGRES_WORKER_PASSWORD" \
  "$POSTGRES_RUNTIME_PASSWORD" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" "$RESEND_MOCK_API_KEY" \
  "$OTP_HMAC_SECRET"; do
  remember "$sentinel"
done

printf '%s\n' 'Building the isolated API/Web authentication stack...'
"${COMPOSE[@]}" config -q
"${COMPOSE[@]}" build migrate api web resend-mock
COMBO_WEB_ASSET_MANIFEST="sha256:$(
  docker run --rm --entrypoint sha256sum "${PROJECT_NAME}-web:latest" \
    /usr/share/nginx/html/web-asset-manifest.json | awk 'NR == 1 { print $1 }'
)"
[[ "$COMBO_WEB_ASSET_MANIFEST" =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'invalid Web asset digest'
export COMBO_WEB_ASSET_MANIFEST
"${COMPOSE[@]}" up -d --wait postgres redis_hot minio resend-mock migrate api web

printf '%s\n' 'Checking cookie-only authentication boundaries...'
anonymous_status="$(curl -sS -o "$TMP_DIR/anonymous.json" -w '%{http_code}' "$PUBLIC_APP_ORIGIN/api/v1/me")"
[[ "$anonymous_status" == 401 ]] || fail "anonymous /me returned $anonymous_status"

email="auth-$(node -e 'console.log(crypto.randomUUID().replaceAll("-",""))')@example.test"
remember "$email"
challenge_status="$(EMAIL="$email" node -e 'process.stdout.write(JSON.stringify({email:process.env.EMAIL}))' |
  curl -sS -o "$TMP_DIR/challenge.json" -w '%{http_code}' \
    -X POST "$PUBLIC_APP_ORIGIN/api/v1/auth/email/challenges" \
    -H "Origin: $PUBLIC_APP_ORIGIN" -H 'Content-Type: application/json' --data-binary @-)"
[[ "$challenge_status" == 202 ]] || fail "email challenge returned $challenge_status"

code=''
for _ in {1..20}; do
  # 单引号内的 ${...} 是传给 Node 的模板字面量。
  # shellcheck disable=SC2016
  code="$(EMAIL="$email" MOCK_URL="$RESEND_MOCK_BASE_URL" MOCK_KEY="$RESEND_MOCK_API_KEY" node --input-type=module -e '
    try {
      const response = await fetch(new URL("/__test/inbox/latest", process.env.MOCK_URL), {
        method: "POST",
        headers: {Authorization: `Bearer ${process.env.MOCK_KEY}`, "Content-Type": "application/json"},
        body: JSON.stringify({to: process.env.EMAIL}),
      });
      if (response.ok) process.stdout.write((await response.json()).code ?? "");
    } catch {}
  ')"
  [[ "$code" =~ ^[0-9]{6}$ ]] && break
  sleep 1
done
[[ "$code" =~ ^[0-9]{6}$ ]] || fail 'mailbox did not receive a six-digit code'
remember "$code"

verify_status="$(EMAIL="$email" CODE="$code" node -e 'process.stdout.write(JSON.stringify({email:process.env.EMAIL,code:process.env.CODE,returnTo:"/"}))' |
  curl -sS -c "$COOKIE_JAR" -o "$TMP_DIR/verify.json" -w '%{http_code}' \
    -X POST "$PUBLIC_APP_ORIGIN/api/v1/auth/email/verifications" \
    -H "Origin: $PUBLIC_APP_ORIGIN" -H 'Content-Type: application/json' --data-binary @-)"
[[ "$verify_status" == 200 ]] || fail "email verification returned $verify_status"
cookie_value="$(awk '$6 == "cb_session" { print $7 }' "$COOKIE_JAR")"
[[ "$cookie_value" =~ ^s1\.[A-Za-z0-9_-]{43}$ ]] || fail 'session cookie is missing or malformed'
remember "$cookie_value"

authenticated_status="$(curl -sS -b "$COOKIE_JAR" -o /dev/null -w '%{http_code}' "$PUBLIC_APP_ORIGIN/api/v1/me")"
[[ "$authenticated_status" == 200 ]] || fail "authenticated /me returned $authenticated_status"
bearer_status="$(curl -sS -b "$COOKIE_JAR" -H 'Authorization: Bearer forbidden' -o /dev/null -w '%{http_code}' "$PUBLIC_APP_ORIGIN/api/v1/me")"
[[ "$bearer_status" == 401 ]] || fail "Bearer substitution returned $bearer_status"

AUTH_E2E_WEB_BASE_URL="$PUBLIC_APP_ORIGIN" \
AUTH_E2E_RESEND_MOCK_BASE_URL="$RESEND_MOCK_BASE_URL" \
AUTH_E2E_RESEND_MOCK_API_KEY="$RESEND_MOCK_API_KEY" \
AUTH_E2E_SENTINEL_FILE="$SENTINEL_FILE" \
pnpm exec playwright test --config=playwright.config.ts --tsconfig=tsconfig.e2e.json

"${COMPOSE[@]}" logs --no-color >"$LOG_FILE" 2>&1
while IFS= read -r sentinel; do
  [[ -z "$sentinel" ]] && continue
  if grep -Fq "$sentinel" "$LOG_FILE"; then fail 'a sensitive sentinel appeared in service logs'; fi
done <"$SENTINEL_FILE"

printf '%s\n' 'Resend authentication end-to-end checks passed.'
