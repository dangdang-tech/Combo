#!/usr/bin/env bash
# 主链路 P0 验收 smoke。对【已起栈的 live 全栈】跑最小端到端探针，
# 校验 slim 主链路 建任务(领配对码) → 本机助手上传(connect) → 流水线提取 → 能力项 → 发布 的关键不变量：
#   ① SSE 真流（text/event-stream + 首帧 state_snapshot + id: 恢复协议）；② 幂等（建任务同 idempotencyKey 回放同一任务）；
#   ③ 端点齐全且鉴权前置（未授权按契约 401，不是 404 漏挂、不绕过守卫）；④ ErrorEnvelope 无 code（对外不裸露内部错误码）。
#
# 诚实边界（关键）：主链路读写全部 requireAuth（登录用户），SSE 用 requireSseAuth（仅同源 Cookie 会话，
#   显式拒绝 Bearer / query token）；connect 通道（/connect/script、/connect/upload）凭配对码鉴权、无登录态。
#   真实会话 Cookie（cb_session）由浏览器走 OIDC 登录取得，裸 curl 无法铸造；本地栈若开了 DEV_LOGIN_ENABLED，
#   可用 POST /api/v1/auth/dev-login 铸 dev 会话。故本脚本分两段：
#     A) 匿名段（无需登录，CI/任何人可跑）：对 live 栈断言不变量在【协议边界】成立——
#        未授权访问按契约落 401/404 ErrorEnvelope（无 code/无堆栈）、SSE 拒绝非 Cookie 来源、
#        每条主链路端点真实注册（不是 404 漏挂）、connect 脚本通道不向 `| sh` 管道裸吐 JSON。
#     B) 鉴权段：优先用调用方提供的 CB_SESSION_COOKIE；未提供则自动尝试 dev-login（栈没开则优雅跳过）。
#        带会话走 建任务 → 幂等回放 → 任务 SSE 真流，断言幂等回放同任务、SSE 首帧 state_snapshot + id:。
#
# 无 Docker / 栈未起：优雅报「需 Docker + 已起栈」并退出（非崩溃）。
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3000}"
WEB_BASE="${WEB_BASE:-http://localhost}"
# 鉴权段：可显式给真实会话 Cookie；留空则 B 段自动尝试 dev-login。
CB_SESSION_COOKIE="${CB_SESSION_COOKIE:-}"

pass() { printf '\033[1;32m[pass]\033[0m %s\n' "$*"; }
skip() { printf '\033[1;33m[skip]\033[0m %s\n' "$*"; }
log() { printf '\033[1;34m[accept]\033[0m %s\n' "$*"; }
fail() {
  printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || fail "需要 curl"

# —— 前置：live 栈必须可达；不可达说明没起栈（多半无 Docker），优雅退出而非崩溃 ——
log "前置 GET ${API_BASE}/health（确认 live 栈已起）"
if ! curl -fsS -o /dev/null --max-time 5 "${API_BASE}/health" 2>/dev/null; then
  cat >&2 <<EOF
$(printf '\033[1;33m[need-docker]\033[0m') live 全栈未就绪（${API_BASE}/health 不可达）。

主链路验收 smoke 必须对一条真实起好的全栈跑，本机当前未检测到可达 API。
请先用 Docker 起栈再跑本脚本：

  cd <仓库根>
  cp .env.compose.example .env      # 然后填全部强随机密钥（compose \${VAR:?} 会拦空值/弱默认）
  ./scripts/start.sh                # 固定启动序起栈并等健康（postgres→logto→migrate→业务）
  ./scripts/smoke.sh                # 基础冒烟（/health /ready /me + Logto discovery）
  ./scripts/acceptance-smoke.sh     # 本脚本：主链路 P0 验收探针

无 Docker 环境无法跑本验收（需真实 PG/Redis/MinIO/Logto）。退出码 0（非失败，仅未就绪）。
EOF
  exit 0
fi
pass "live 栈可达（/health 200）"

# —— /ready 五 required 依赖必须全 ready（db/redis_queue/redis_hot/minio/logto；llm degraded 不算失败）——
log "前置 GET ${API_BASE}/ready（五 required 依赖就绪）"
ready="$(curl -fsS "${API_BASE}/ready")" || fail "/ready 不可达"
echo "$ready" | grep -q '"ready":true' || fail "/ready ready!=true（依赖未就绪，无法跑验收）：$ready"
pass "/ready ready=true（五 required 依赖就绪）"

# ErrorEnvelope 不变量断言：body 必含 userMessage 与 traceId、必不含 code、必不含堆栈/原始 Error。
assert_error_envelope() {
  # $1=场景名 $2=body
  local name="$1" body="$2"
  echo "$body" | grep -q '"userMessage"' || fail "${name}: 缺 userMessage（裸露错误？）：$body"
  echo "$body" | grep -q '"code"' && fail "${name}: body 含 code（对外不裸露内部错误码）：$body"
  echo "$body" | grep -qiE 'stack|Error:|SQLSTATE|at /|node_modules' && fail "${name}: body 含堆栈/原始报错：$body"
  echo "$body" | grep -q '"traceId"' || fail "${name}: 缺 traceId（前端反馈代码靠它）：$body"
  return 0
}

# 取 HTTP 状态码（不用 curl -f，-f 在 4xx/5xx 会吞 body 拿不到信封）。
http_code() { curl -sS -o /dev/null -w '%{http_code}' "$@"; }

# ════════════════════════════════════════════════════════════════════════════
# A 段：匿名不变量（无需登录，任何人/CI 可跑）
# ════════════════════════════════════════════════════════════════════════════
log "A 段：匿名协议边界不变量"

# A1 · ErrorEnvelope 无 code —— 未知路由 404
log "A1 GET /api/v1/__not_exist__（期望 404 ErrorEnvelope，无 code）"
c="$(http_code "${API_BASE}/api/v1/__not_exist__")"
[ "$c" = "404" ] || fail "未知路由期望 404，实际 ${c}"
assert_error_envelope "404" "$(curl -sS "${API_BASE}/api/v1/__not_exist__")"
pass "A1 未知路由 404 ErrorEnvelope（含 userMessage/traceId、无 code、无堆栈）"

# A2 · 受保护读端点未带会话 → 401 ErrorEnvelope（/me requireAuth）
log "A2 GET /api/v1/me（无会话，期望 401 ErrorEnvelope）"
c="$(http_code "${API_BASE}/api/v1/me")"
[ "$c" = "401" ] || fail "/me 无会话期望 401，实际 ${c}"
assert_error_envelope "/me 401" "$(curl -sS "${API_BASE}/api/v1/me")"
pass "A2 /me 无会话 → 401 ErrorEnvelope"

# A3 · 主链路【写命令】端点真实注册 + requireAuth 前置 —— 无会话应 401（不是 404 漏挂、不是 200/501 绕鉴权）。
log "A3 主链路写命令端点（无会话 → 401，证明端点已注册且鉴权前置）"
declare -a WRITE_ENDPOINTS=(
  "POST /api/v1/tasks                                # 建任务（返回配对码）"
  "POST /api/v1/tasks/00000000-0000-7000-8000-000000000000/retry        # 重试失败任务"
  "POST /api/v1/capabilities/00000000-0000-7000-8000-000000000000/publish   # 发布能力项"
  "POST /api/v1/capabilities/00000000-0000-7000-8000-000000000000/unpublish # 下架能力项"
)
for entry in "${WRITE_ENDPOINTS[@]}"; do
  method="${entry%% *}"
  rest="${entry#* }"
  path="${rest%%#*}"
  path="$(echo "$path" | xargs)" # trim
  c="$(http_code -X "$method" "${API_BASE}${path}")"
  # 401（鉴权前置先拦）证明端点已注册；绝不能是 404（漏挂）或 200/501（绕过鉴权）。
  [ "$c" = "401" ] || fail "A3 ${method} ${path} 期望 401（鉴权前置），实际 ${c}（404=漏挂 / 200/501=绕鉴权）"
  body="$(curl -sS -X "$method" "${API_BASE}${path}")"
  assert_error_envelope "A3 ${method} ${path}" "$body"
done
pass "A3 全部主链路写命令端点已注册且 requireAuth 前置生效（无会话 → 401 ErrorEnvelope）"

# A4 · 主链路【读端点】真实注册 —— GET 无会话 → 401（requireAuth），证明端点齐全。
log "A4 主链路读端点（无会话 → 401，证明端点已注册）"
declare -a READ_ENDPOINTS=(
  "/api/v1/tasks"                                                  # 任务列表
  "/api/v1/tasks/00000000-0000-7000-8000-000000000000"             # 任务详情
  "/api/v1/capabilities"                                           # 能力项列表
  "/api/v1/capabilities/00000000-0000-7000-8000-000000000000"      # 能力项详情
)
for path in "${READ_ENDPOINTS[@]}"; do
  c="$(http_code "${API_BASE}${path}")"
  [ "$c" = "401" ] || fail "A4 GET ${path} 期望 401，实际 ${c}（404=漏挂）"
done
pass "A4 全部主链路读端点已注册（无会话 → 401）"

# A5 · SSE 真流端点存在 + SSE 鉴权铁律：仅同源 Cookie，拒绝 Bearer / query token，
#      且失败在【建流前】返 HTTP 401（不是 SSE error 帧）。slim 后唯一 SSE 流是任务进度流。
log "A5 SSE 端点鉴权（仅 Cookie；Bearer/query token 在建流前 401）"
sse="/api/v1/tasks/00000000-0000-7000-8000-000000000000/events"
# 无会话：401（无会话 Cookie）
c="$(http_code "${API_BASE}${sse}")"
[ "$c" = "401" ] || fail "A5 SSE ${sse} 无会话期望 401，实际 ${c}"
# 带 Bearer：SSE 禁 Authorization 来源 → 仍 401（不静默回落、不放行）
c="$(http_code -H 'Authorization: Bearer faketoken' "${API_BASE}${sse}")"
[ "$c" = "401" ] || fail "A5 SSE ${sse} 带 Bearer 期望 401（SSE 禁 Authorization），实际 ${c}"
# 带 query token：SSE 禁 query token → 仍 401
c="$(http_code "${API_BASE}${sse}?access_token=faketoken")"
[ "$c" = "401" ] || fail "A5 SSE ${sse} 带 query token 期望 401（SSE 禁 query token），实际 ${c}"
c="$(http_code "${API_BASE}${sse}?token=faketoken")"
[ "$c" = "401" ] || fail "A5 SSE ${sse} 带 ?token 期望 401（SSE 禁 query token），实际 ${c}"
# 建流前失败必须是 HTTP ErrorEnvelope（非 text/event-stream）。
ct="$(curl -sS -o /dev/null -w '%{content_type}' "${API_BASE}${sse}")"
echo "$ct" | grep -qi 'text/event-stream' && fail "A5 SSE ${sse} 未授权却开了流（应建流前 401，不是 event-stream）：$ct"
pass "A5 任务 SSE 流：无会话/Bearer/query token → 建流前 401 ErrorEnvelope（仅认同源 Cookie）"

# A6 · connect 通道（配对码鉴权，无登录态）：
#      /connect/script 走 `curl | sh` 管道，无码/坏码必须回【可执行脚本】而非 JSON（裸 JSON 进 sh 会报错）；
#      /connect/upload 坏请求体 → 400 ErrorEnvelope（校验前置，不裸过）。
log "A6 connect 通道（脚本通道不裸 JSON；上传坏体 400 信封）"
c="$(http_code "${API_BASE}/api/v1/connect/script")"
[ "$c" = "404" ] || fail "A6 /connect/script 无码期望 404，实际 ${c}"
ct="$(curl -sS -o /dev/null -w '%{content_type}' "${API_BASE}/api/v1/connect/script")"
echo "$ct" | grep -qi 'shellscript' || fail "A6 /connect/script 无码应回 text/x-shellscript（| sh 通道不裸 JSON），实际 ${ct}"
c="$(http_code "${API_BASE}/api/v1/connect/script?code=000000")"
[ "$c" = "404" ] || fail "A6 /connect/script 坏码期望 404，实际 ${c}"
c="$(http_code -X POST -H 'Content-Type: application/json' -d '{}' "${API_BASE}/api/v1/connect/upload")"
[ "$c" = "400" ] || fail "A6 /connect/upload 空体期望 400（校验前置），实际 ${c}"
assert_error_envelope "A6 connect/upload 400" "$(curl -sS -X POST -H 'Content-Type: application/json' -d '{}' "${API_BASE}/api/v1/connect/upload")"
pass "A6 connect 通道：脚本无码/坏码 404 且回 shellscript；上传坏体 400 ErrorEnvelope"

# A7 · logout 永不拦（bestEffortAuth：logout 语义是无论如何清会话，未登录也应 2xx）。
log "A7 POST /api/v1/auth/logout（未登录也应 2xx）"
c="$(http_code -X POST "${API_BASE}/api/v1/auth/logout")"
case "$c" in
  2*) pass "A7 logout 未登录 2xx（${c}），bestEffortAuth 永不拦" ;;
  *) fail "A7 logout 期望 2xx（bestEffortAuth），实际 ${c}" ;;
esac

# A8 · Web 静态站 + runtime 边界经 nginx 可达（同源反代）—— 可选，不可达仅 skip。
log "A8 GET ${WEB_BASE}/（nginx 静态站，可选）"
if curl -fsS -o /dev/null "${WEB_BASE}/" 2>/dev/null; then
  pass "A8 Web 静态站可达（nginx 同源）"
  # runtime 市集列表 requireAuth：匿名经 nginx 应 401 信封（证明 /api/v1/runtime/ 反代块生效、未漏到 authoring 404）。
  c="$(http_code "${WEB_BASE}/api/v1/runtime/capabilities")"
  if [ "$c" = "401" ]; then
    pass "A8 runtime 反代生效（匿名 /api/v1/runtime/capabilities → 401，非 404/502）"
  else
    fail "A8 匿名 GET ${WEB_BASE}/api/v1/runtime/capabilities 期望 401，实际 ${c}（404=反代漏块落到 authoring / 502=上游不通）"
  fi
else
  skip "A8 Web 未起/不可达（非阻塞）"
fi

# ════════════════════════════════════════════════════════════════════════════
# B 段：鉴权端到端（优先用 CB_SESSION_COOKIE；否则自动尝试 dev-login；都不行则优雅跳过）
# ════════════════════════════════════════════════════════════════════════════
if [ -z "${CB_SESSION_COOKIE}" ]; then
  log "B 段：未提供 CB_SESSION_COOKIE，尝试 dev-login（需栈开 DEV_LOGIN_ENABLED）"
  jar="$(mktemp)"
  dev_code="$(curl -sS -o /dev/null -w '%{http_code}' -c "$jar" -X POST "${API_BASE}/api/v1/auth/dev-login" || true)"
  if [ "$dev_code" = "200" ] || [ "$dev_code" = "201" ]; then
    CB_SESSION_COOKIE="$(awk '$6 == "cb_session" { print $7 }' "$jar" | tail -1)"
  fi
  rm -f "$jar"
fi

if [ -z "${CB_SESSION_COOKIE}" ]; then
  cat <<EOF
$(skip "B 段（鉴权端到端）未跑：无 CB_SESSION_COOKIE 且 dev-login 不可用")

主链路读写全部 requireAuth，SSE 仅认同源 Cookie 会话。要跑 B 段，二选一：

  a) 本地栈开 DEV_LOGIN_ENABLED=true 重起，重跑本脚本（会自动 dev-login）；
  b) 浏览器打开 ${WEB_BASE}/ 走 Logto 登录（${API_BASE}/api/v1/auth/login），
     开发者工具 → Application → Cookies 复制 cb_session 值，然后：
     CB_SESSION_COOKIE='<cb_session 值>' ./scripts/acceptance-smoke.sh

B 段会带会话走 建任务 → 幂等回放 → 任务 SSE 真流，
断言：同 idempotencyKey 回放同一任务（不重复建）、SSE 首帧 state_snapshot + id:（恢复协议）。
EOF
  log "A 段全部通过；B 段已优雅跳过（无会话）。"
  exit 0
fi

log "B 段：带会话 Cookie 跑鉴权端到端主链路"
CK=(-H "Cookie: cb_session=${CB_SESSION_COOKIE}")

# B0 · Cookie 有效性：/me 应 200。
log "B0 GET /api/v1/me（验会话有效）"
me_code="$(http_code "${CK[@]}" "${API_BASE}/api/v1/me")"
[ "$me_code" = "200" ] || fail "B0 /me 带会话期望 200，实际 ${me_code}（会话失效？重新登录取 cb_session）"
pass "B0 会话有效（/me 200）"

# B1 · 幂等：同 idempotencyKey 建任务两次 → 回放同一任务（首次 201，回放 200；配对码轮换新发不比对）。
log "B1 幂等：POST /tasks 同 idempotencyKey 两次 → 回放同一任务"
IDEM="accept-smoke-$(date +%s)-$$"
BODY="{\"idempotencyKey\":\"${IDEM}\",\"description\":\"acceptance-smoke 幂等探针\"}"
c1="$(curl -sS -o /tmp/accept-smoke-task1.json -w '%{http_code}' "${CK[@]}" -H 'Content-Type: application/json' -d "$BODY" "${API_BASE}/api/v1/tasks")"
c2="$(curl -sS -o /tmp/accept-smoke-task2.json -w '%{http_code}' "${CK[@]}" -H 'Content-Type: application/json' -d "$BODY" "${API_BASE}/api/v1/tasks")"
r1="$(cat /tmp/accept-smoke-task1.json)"
r2="$(cat /tmp/accept-smoke-task2.json)"
rm -f /tmp/accept-smoke-task1.json /tmp/accept-smoke-task2.json
[ "$c1" = "201" ] || fail "B1 首次建任务期望 201，实际 ${c1}：$r1"
[ "$c2" = "200" ] || fail "B1 幂等回放期望 200，实际 ${c2}：$r2"
t1="$(echo "$r1" | grep -o '"task":{"id":"[^"]*"' | head -1)"
t2="$(echo "$r2" | grep -o '"task":{"id":"[^"]*"' | head -1)"
[ -n "$t1" ] || fail "B1 建任务响应缺 task.id：$r1"
[ "$t1" = "$t2" ] || fail "B1 同 idempotencyKey 两次任务不同（${t1} != ${t2}）= 幂等失效"
TASK_ID="$(echo "$t1" | sed 's/.*"id":"//;s/"//')"
pass "B1 幂等：同 idempotencyKey 回放同一任务（${TASK_ID}，201→200）"

# B2 · SSE 真流：带 Cookie 连任务进度流，应得 text/event-stream + 首帧 state_snapshot + id:（恢复协议）。
log "B2 SSE 真流：GET /tasks/${TASK_ID}/events（断言 event-stream + state_snapshot + id:）"
ct="$(curl -s -o /dev/null -w '%{content_type}' "${CK[@]}" --max-time 3 "${API_BASE}/api/v1/tasks/${TASK_ID}/events" || true)"
echo "$ct" | grep -qi 'text/event-stream' || fail "B2 SSE 未返回 text/event-stream：$ct"
frames="$(curl -sS "${CK[@]}" --max-time 4 "${API_BASE}/api/v1/tasks/${TASK_ID}/events" 2>/dev/null || true)"
echo "$frames" | grep -q 'state_snapshot' || fail "B2 SSE 首帧未见 state_snapshot（真流应先发全量快照）：$frames"
echo "$frames" | grep -qE '^id:' || fail "B2 SSE 帧缺 id:（Last-Event-ID 恢复协议靠它）：$frames"
pass "B2 SSE 真流：text/event-stream + 首帧 state_snapshot + 带 id:（恢复协议）"

log "A + B 段验收全部通过。"
exit 0
