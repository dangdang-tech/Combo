#!/usr/bin/env bash
# 集成：在真实 PostgreSQL 上执行全部业务迁移，并验证第一方邮件认证 schema、迁移幂等和非空用户库门禁。
# 入参：DATABASE_URL 必填。脚本只接受本机数据库，并会额外创建和删除一个随机临时数据库。
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

log() { printf '\033[1;34m[it:db]\033[0m %s\n' "$*"; }
fail() {
  printf '\033[1;31m[it:db:fail]\033[0m %s\n' "$*" >&2
  exit 1
}

: "${DATABASE_URL:?需设置 DATABASE_URL（指向可达 PostgreSQL）}"
command -v pnpm >/dev/null 2>&1 || fail '需要 pnpm'
command -v psql >/dev/null 2>&1 || fail '需要 psql（断言 schema 用）'
command -v node >/dev/null 2>&1 || fail '需要 node（安全解析数据库地址用）'

DB_HOST="$(DATABASE_URL="$DATABASE_URL" node --input-type=module -e '
  const url = new URL(process.env.DATABASE_URL);
  process.stdout.write(url.hostname);
')"
case "$DB_HOST" in
  localhost | 127.0.0.1 | ::1 | '[::1]') ;;
  *) fail "拒绝对非本机 PostgreSQL 运行集成迁移：${DB_HOST}" ;;
esac

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agora-db-migrate.XXXXXX")"
chmod 700 "$TEMP_DIR"
trap 'rm -rf "$TEMP_DIR"' EXIT
TEMP_DB="agora_auth_gate_${RANDOM:-0}_$$"
ADMIN_URL="$(DATABASE_URL="$DATABASE_URL" node --input-type=module -e '
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = "/postgres";
  process.stdout.write(url.toString());
')"
TEMP_URL="$(DATABASE_URL="$DATABASE_URL" TEMP_DB="$TEMP_DB" node --input-type=module -e '
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = "/" + process.env.TEMP_DB;
  process.stdout.write(url.toString());
')"
TEMP_DB_CREATED=0

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ "$TEMP_DB_CREATED" -eq 1 ]]; then
    psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -qAtc \
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TEMP_DB}' AND pid <> pg_backend_pid();" \
      >/dev/null 2>&1 || true
    psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -qc "DROP DATABASE IF EXISTS \"${TEMP_DB}\";" \
      >/dev/null 2>&1 || true
  fi
  rm -rf "$TEMP_DIR"
  exit "$status"
}
trap cleanup EXIT INT TERM

log '执行全量迁移 ...'
pnpm -C "$ROOT_DIR" -F @cb/db migrate

log '断言全部迁移文件只记账一次 ...'
expected="$(find "${ROOT_DIR}/db/migrations" -name '*.sql' | wc -l | tr -d ' ')"
applied="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAc 'SELECT count(*) FROM schema_migrations')"
[[ "$applied" == "$expected" ]] || fail "记账数 ${applied} != 迁移文件数 ${expected}"

log '断言业务表与四张认证表齐全 ...'
for table_name in \
  users tasks uploads capabilities sessions messages turns artifacts audit_llm_calls \
  auth_identities auth_otp_challenges auth_sessions auth_audit_events; do
  exists="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAc "SELECT to_regclass('public.${table_name}') IS NOT NULL")"
  [[ "$exists" == t ]] || fail "缺少表 ${table_name}"
done

log '断言第一方身份列、摘要列与认证约束 ...'
legacy_columns="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAc "
  SELECT count(*)
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'users'
    AND column_name IN ('logto_user_id', 'email');
")"
[[ "$legacy_columns" == 0 ]] || fail 'users 仍包含旧认证字段'

disabled_column="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAc "
  SELECT count(*)
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'disabled_at';
")"
[[ "$disabled_column" == 1 ]] || fail 'users 缺少 disabled_at'

plaintext_columns="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAc "
  SELECT count(*)
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN ('auth_otp_challenges', 'auth_sessions')
    AND column_name IN ('code', 'otp_code', 'token', 'session_token');
")"
[[ "$plaintext_columns" == 0 ]] || fail '认证表出现明文验证码或会话令牌列'

for constraint_name in \
  ck_users_account_mvp \
  ck_users_roles_mvp \
  ck_auth_otp_digest_length \
  ck_auth_session_digest \
  ck_auth_session_ttl \
  ck_auth_audit_details_mvp; do
  count="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAc \
    "SELECT count(*) FROM pg_constraint WHERE conname = '${constraint_name}'")"
  [[ "$count" == 1 ]] || fail "缺少认证约束 ${constraint_name}"
done

for index_name in uq_users_account_lower uq_auth_identity_subject uq_auth_otp_unfinished_target; do
  count="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAc \
    "SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = '${index_name}'")"
  [[ "$count" == 1 ]] || fail "缺少认证索引 ${index_name}"
done

log '断言 API、worker 与 runtime 的真实 PostgreSQL 权限隔离 ...'
role_privileges="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAc "
  SELECT CASE WHEN
    has_table_privilege('combo_api', 'auth_sessions', 'INSERT')
    AND has_table_privilege('combo_runtime', 'auth_sessions', 'SELECT')
    AND NOT has_table_privilege('combo_runtime', 'auth_sessions', 'INSERT')
    AND has_table_privilege('combo_worker', 'tasks', 'SELECT')
    AND NOT has_table_privilege('combo_worker', 'auth_sessions', 'UPDATE')
  THEN 'ok' ELSE 'bad' END;
")"
[[ "$role_privileges" == ok ]] || fail '应用数据库角色授权矩阵不正确'

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAtc \
  'SET ROLE combo_runtime; SELECT count(*) FROM users; SELECT count(*) FROM auth_sessions;' \
  >/dev/null || fail 'runtime 角色无法读取会话事实表'
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAtc \
  'SET ROLE combo_worker; SELECT count(*) FROM tasks;' \
  >/dev/null || fail 'worker 角色无法读取任务表'
if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAtc \
  "SET ROLE combo_runtime; INSERT INTO auth_sessions (user_id, token_digest, auth_method) VALUES (gen_uuid_v7(), decode(repeat('00', 32), 'hex'), 'email_otp');" \
  >"$TEMP_DIR/runtime-auth-write.log" 2>&1; then
  fail 'runtime 角色错误地获得认证会话写权限'
fi
if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAtc \
  "SET ROLE combo_worker; UPDATE auth_sessions SET revoked_at = now();" \
  >"$TEMP_DIR/worker-auth-write.log" 2>&1; then
  fail 'worker 角色错误地获得认证会话写权限'
fi

log '断言迁移重复执行幂等 ...'
pnpm -C "$ROOT_DIR" -F @cb/db migrate
applied_again="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAc 'SELECT count(*) FROM schema_migrations')"
[[ "$applied_again" == "$expected" ]] || fail "二次迁移后记账数变化为 ${applied_again}"

log '在独立临时数据库中验证非空 users 门禁与事务回滚 ...'
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -qc "CREATE DATABASE \"${TEMP_DB}\";"
TEMP_DB_CREATED=1
psql "$TEMP_URL" -v ON_ERROR_STOP=1 --single-transaction -qf \
  "$ROOT_DIR/db/migrations/0000_baseline_schema.sql"
psql "$TEMP_URL" -v ON_ERROR_STOP=1 -qc "
  INSERT INTO users (logto_user_id, account, email)
  VALUES ('legacy-subject', 'legacy-account', 'legacy@example.test');
"

if psql "$TEMP_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -f "$ROOT_DIR/db/migrations/0004_first_party_email_auth.sql" \
  >"$TEMP_DIR/nonempty-gate.log" 2>&1; then
  fail '0004 在非空 users 数据库中错误地执行成功'
fi

rollback_state="$(psql "$TEMP_URL" -v ON_ERROR_STOP=1 -tAc "
  SELECT CASE WHEN
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'logto_user_id'
    )
    AND to_regclass('public.auth_identities') IS NULL
  THEN 'ok' ELSE 'bad' END;
")"
[[ "$rollback_state" == ok ]] || fail '非空 users 门禁失败后出现部分迁移'

psql "$TEMP_URL" -v ON_ERROR_STOP=1 -qc 'DELETE FROM users;'
psql "$TEMP_URL" -v ON_ERROR_STOP=1 --single-transaction -qf \
  "$ROOT_DIR/db/migrations/0004_first_party_email_auth.sql"
empty_gate_state="$(psql "$TEMP_URL" -v ON_ERROR_STOP=1 -tAc "
  SELECT CASE WHEN
    to_regclass('public.auth_identities') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'logto_user_id'
    )
  THEN 'ok' ELSE 'bad' END;
")"
[[ "$empty_gate_state" == ok ]] || fail '0004 未能在空 users 数据库中完整执行'

log '迁移集成全部通过 ✓'
