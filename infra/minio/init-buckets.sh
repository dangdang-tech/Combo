#!/bin/sh
# 一次性 minio_mc 容器入口：只确保不可变 Agent Package 使用的 combo-artifacts 存在。
# 脚本不删除桶、不删除对象，也不枚举或改写已有业务数据。
set -eu

S3_ENDPOINT="${S3_ENDPOINT:-http://minio:9000}"
S3_ACCESS_KEY="${S3_ACCESS_KEY:-minioadmin}"
S3_SECRET_KEY="${S3_SECRET_KEY:-minioadmin}"

# 配置别名（重试等待 minio 起来；healthcheck 已 gate，这里只做容错重试）
i=0
until mc alias set local "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "[init-buckets] cannot reach minio at $S3_ENDPOINT" >&2
    exit 1
  fi
  sleep 2
done

mc mb --ignore-existing local/combo-artifacts
echo "[init-buckets] ensured bucket 'combo-artifacts'"

echo "[init-buckets] done"
