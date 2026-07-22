#!/usr/bin/env bash
# 生产口径全栈启动。固定顺序是基础设施、建桶、数据库迁移和业务容器。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${ROOT_DIR}/infra/docker-compose.yml")

log() { printf '\033[1;34m[start]\033[0m %s\n' "$*"; }
die() {
  printf '\033[1;31m[start:error]\033[0m %s\n' "$*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || die '需要 docker'
node <<'NODE' || die 'Docker daemon 不可用'
const { spawn } = require('node:child_process');
const child = spawn('docker', ['info'], { stdio: 'ignore' });
const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
child.once('error', () => {
  clearTimeout(timer);
  process.exit(1);
});
child.once('exit', (code) => {
  clearTimeout(timer);
  process.exit(code === 0 ? 0 : 1);
});
NODE

# Compose 会读取仓库根 .env。这里只为启动前弱值门禁读取同一文件，不输出任何配置值。
if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
fi

WEAK_DEFAULTS=(combo agora minioadmin postgres password admin root changeme secret test)
is_weak() {
  local value="${1:-}" normalized weak
  [[ -z "${value}" ]] && return 0
  normalized="$(printf '%s' "${value}" | tr '[:upper:]' '[:lower:]')"
  for weak in "${WEAK_DEFAULTS[@]}"; do
    [[ "${normalized}" == "${weak}" ]] && return 0
  done
  return 1
}

REQUIRED_STRONG_VALUES=(
  POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB
  POSTGRES_API_PASSWORD POSTGRES_WORKER_PASSWORD POSTGRES_RUNTIME_PASSWORD
  S3_ACCESS_KEY S3_SECRET_KEY
  GRAFANA_ADMIN_PASSWORD RESEND_API_KEY OTP_HMAC_SECRET
)
REQUIRED_CONFIG=(PUBLIC_APP_ORIGIN RESEND_FROM_EMAIL)
GUARD_FAILED=0
for key in "${REQUIRED_STRONG_VALUES[@]}"; do
  value="${!key:-}"
  if is_weak "${value}"; then
    printf '\033[1;31m[start:guard]\033[0m %s 缺失或命中已知弱默认值\n' "${key}" >&2
    GUARD_FAILED=1
  fi
done
for key in "${REQUIRED_CONFIG[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    printf '\033[1;31m[start:guard]\033[0m %s 未设置\n' "${key}" >&2
    GUARD_FAILED=1
  fi
done
if [[ -n "${OTP_HMAC_SECRET:-}" && ${#OTP_HMAC_SECRET} -lt 32 ]]; then
  printf '\033[1;31m[start:guard]\033[0m OTP_HMAC_SECRET 长度不足\n' >&2
  GUARD_FAILED=1
fi
[[ "${GUARD_FAILED}" -eq 0 ]] || die '配置门禁拒绝启动，请按 .env.compose.example 补齐生产配置'
log '0/6 配置门禁通过（未输出配置值）'

# Compose 不会自动删除已经从清单移除的服务。只按当前项目与旧服务标签删除历史 Logto 容器，
# 避免升级后托管登录面和数据库所有者连接继续存活；不触碰卷、数据服务或其他项目。
COMPOSE_PROJECT="${COMPOSE_PROJECT_NAME:-infra}"
OBSOLETE_SERVICES=(logto logto_db_seed logto_alteration)
remove_obsolete_project_containers() {
  local service container_id
  local -a obsolete_ids=()
  for service in "${OBSOLETE_SERVICES[@]}"; do
    while IFS= read -r container_id; do
      [[ -n "${container_id}" ]] && obsolete_ids+=("${container_id}")
    done < <(
      docker ps -aq \
        --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" \
        --filter "label=com.docker.compose.service=${service}"
    )
  done
  if [[ "${#obsolete_ids[@]}" -gt 0 ]]; then
    docker rm -f "${obsolete_ids[@]}" >/dev/null
  fi
  for service in "${OBSOLETE_SERVICES[@]}"; do
    if [[ -n "$(
      docker ps -aq \
        --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" \
        --filter "label=com.docker.compose.service=${service}"
    )" ]]; then
      die "当前 Compose 项目的废弃 ${service} 容器仍存在，拒绝执行迁移"
    fi
  done
}

log '1/6 删除并确认当前 Compose 项目的废弃 Logto 容器'
remove_obsolete_project_containers

# 0004 会删除旧认证列，不能与任何旧业务容器并行。只停止当前 Compose 项目的业务面，
# 数据库、Redis、MinIO 与其他 Compose 项目都不受影响。
log '2/6 停止并确认当前项目的旧业务容器已经退出'
"${COMPOSE[@]}" stop --timeout 60 api worker runtime web
if [[ -n "$("${COMPOSE[@]}" ps --status running -q api worker runtime web)" ]]; then
  die '旧业务容器仍在运行，拒绝执行停机式认证迁移'
fi

log '3/6 启动 PostgreSQL、双 Redis、MinIO 与观测组件'
"${COMPOSE[@]}" up -d --wait postgres redis_queue redis_hot minio loki tempo otel-collector grafana

log '4/6 初始化对象存储桶'
"${COMPOSE[@]}" up --no-deps --abort-on-container-exit --exit-code-from minio_mc minio_mc \
  || die '对象存储桶初始化失败，数据库迁移与业务容器保持停止'

log '5/6 执行业务与第一方认证数据库迁移'
"${COMPOSE[@]}" up --no-deps --abort-on-container-exit --exit-code-from migrate migrate \
  || die '数据库迁移失败，业务容器保持停止'

log '6/6 启动 authoring、worker、runtime 与 web'
"${COMPOSE[@]}" up -d --wait api worker runtime web

log '全栈已启动：'
log '  - API    http://localhost:3000/ready'
log '  - Web    http://localhost/'
log '  - MinIO  http://localhost:9001'
log '  - Grafana http://localhost:3003/d/combo-trace-debug/trace-debug'
