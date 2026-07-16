#!/bin/bash
# k8s 部署脚本：把指定提交的三镜像滚动部署到本机 k3s 的 combo 命名空间。
# 由 CD workflow 在服务器上调用（env SHA=<完整提交 SHA>），也可以在服务器上手动执行做回滚或重放。
# 前置：镜像已由 CI 推送 GHCR；集群里已有 combo-env 与 ghcr-pull 两个 Secret；清单在 /opt/combo/infra/k8s（CD 每次同步）。
set -euo pipefail
SHA="${SHA:?SHA 必填（完整提交 SHA，三镜像必须已在 GHCR）}"
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config}"
SRC=/opt/combo/infra/k8s
WORK=$HOME/combo-k8s-deploy

# 部署工作目录与 CD 同步目录分离：/opt/combo/infra 每次被 rsync --delete 整体覆盖，
# 工作目录里保留「钉过 tag 的当次渲染现场」，也避免在 CD 管理的目录里留本地改动。
rsync -a --delete "$SRC/" "$WORK/"
sed -i "s/newTag: .*/newTag: $SHA/" "$WORK/kustomization.yaml"

# 迁移 Job 的模板不可变，而镜像 tag 每次部署都变，直接 apply 会报错——必须先删旧 Job 再随整套清单重建。
kubectl -n combo delete job migrate --ignore-not-found

# 必须经 kustomize 渲染再 apply（镜像 tag 由 images 段注入）；直接 apply 单个原始文件会带上未钉版的 latest。
kubectl kustomize "$WORK" | kubectl apply -f -

kubectl -n combo wait --for=condition=complete job/migrate --timeout=300s
for d in api worker runtime web; do
  kubectl -n combo rollout status "deploy/$d" --timeout=300s
done
echo "[deploy-k8s] 已部署 $SHA"
