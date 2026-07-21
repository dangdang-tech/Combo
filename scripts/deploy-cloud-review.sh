#!/usr/bin/env bash
# 固定单槽 Cloud Review 部署：基础设施就绪 -> 迁移完成 -> 六个业务工作负载 rollout。
set -euo pipefail

SHA="${SHA:?SHA 必填（40 位提交 SHA；三镜像必须已在 GHCR）}"
KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config}"
SRC_ROOT="${SRC_ROOT:-/opt/combo-preview/infra/k8s}"
WORK_ROOT="${WORK_ROOT:-$HOME/combo-preview-k8s-deploy}"
NAMESPACE=combo-preview
export KUBECONFIG

if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "[cloud-review] SHA 必须是 40 位小写十六进制完整提交 SHA" >&2
  exit 64
fi

for command_name in kubectl rsync sed; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "[cloud-review] 缺少命令：$command_name" >&2
    exit 69
  }
done

test -f "$SRC_ROOT/overlays/cloud-review/kustomization.yaml" || {
  echo "[cloud-review] 找不到 overlay：$SRC_ROOT/overlays/cloud-review" >&2
  exit 66
}

rsync -a --delete "$SRC_ROOT/" "$WORK_ROOT/"
for kustomization in \
  "$WORK_ROOT/overlays/cloud-review/migrate/kustomization.yaml" \
  "$WORK_ROOT/overlays/cloud-review/apps/kustomization.yaml"; do
  sed -i "s/newTag: cloud-review/newTag: $SHA/g" "$kustomization"
done

# Namespace 可以安全幂等创建；Secret 必须由 cloud-review 专属人工前置提供，脚本绝不复制 production Secret。
kubectl apply -f "$WORK_ROOT/overlays/cloud-review/platform/namespace.yaml"
for secret_name in combo-preview-env combo-preview-bootstrap combo-preview-ghcr-pull; do
  kubectl -n "$NAMESPACE" get secret "$secret_name" >/dev/null 2>&1 || {
    echo "[cloud-review] 缺少专属 Secret $NAMESPACE/$secret_name；拒绝回退到生产 Secret" >&2
    exit 78
  }
done
for key in DEV_SESSION_SECRET htpasswd; do
  value="$(kubectl -n "$NAMESPACE" get secret combo-preview-bootstrap -o "jsonpath={.data.$key}")"
  test -n "$value" || {
    echo "[cloud-review] combo-preview-bootstrap 缺少非空键：$key" >&2
    exit 78
  }
done

echo "[cloud-review] 1/3 部署并等待独立基础设施"
kubectl -n "$NAMESPACE" delete job minio-init --ignore-not-found
kubectl kustomize --load-restrictor=LoadRestrictionsNone "$WORK_ROOT/overlays/cloud-review/platform" | kubectl apply -f -
kubectl -n "$NAMESPACE" rollout status statefulset/postgres --timeout=300s
kubectl -n "$NAMESPACE" rollout status statefulset/redis-queue --timeout=300s
kubectl -n "$NAMESPACE" rollout status statefulset/minio --timeout=300s
kubectl -n "$NAMESPACE" rollout status deployment/redis-hot --timeout=300s
kubectl -n "$NAMESPACE" wait --for=condition=complete job/minio-init --timeout=300s

echo "[cloud-review] 2/3 先执行数据库迁移（此时不会更新业务 Deployment）"
kubectl -n "$NAMESPACE" delete job migrate --ignore-not-found
kubectl kustomize --load-restrictor=LoadRestrictionsNone "$WORK_ROOT/overlays/cloud-review/migrate" | kubectl apply -f -
kubectl -n "$NAMESPACE" wait --for=condition=complete job/migrate --timeout=300s

echo "[cloud-review] 3/3 迁移成功后滚动固定单副本业务面"
kubectl kustomize --load-restrictor=LoadRestrictionsNone "$WORK_ROOT/overlays/cloud-review/apps" | kubectl apply -f -
for deployment in api worker consumer sweeper runtime web; do
  kubectl -n "$NAMESPACE" rollout status "deployment/$deployment" --timeout=300s
done

echo "[cloud-review] 已部署 $SHA 到 $NAMESPACE（web 30081，MinIO API/console 30901/30902）"
