#!/usr/bin/env bash
# 一次性释放 Cloud Review 留在 combo-dev namespace 中的旧 NodePort。
# 只把精确匹配旧评审端口的 Service 恢复为 combo-dev 声明的 ClusterIP；
# 不删除 Service、Pod、PVC 或任何数据。
set -euo pipefail

KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"
COMBO_DEV_NAMESPACE=combo-preview
export KUBECONFIG

for command_name in kubectl mktemp python3 rm sed sort tr; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "[cloud-review] 释放旧 NodePort 缺少命令：$command_name" >&2
    exit 69
  }
done

cluster_services_file="$(mktemp)"
cleanup() {
  rm -f "$cluster_services_file"
}
trap cleanup EXIT

owner="$(
  kubectl get namespace "$COMBO_DEV_NAMESPACE" \
    -o 'jsonpath={.metadata.labels.combo\.dev/environment}'
)" || {
  echo "[cloud-review] 无法读取 $COMBO_DEV_NAMESPACE namespace 所有者" >&2
  exit 1
}
if [[ "$owner" != combo-dev ]]; then
  echo "[cloud-review] $COMBO_DEV_NAMESPACE 不属于 combo-dev，拒绝回收端口" >&2
  exit 78
fi

node_ports_for() {
  kubectl -n "$COMBO_DEV_NAMESPACE" get service "$1" \
    -o 'jsonpath={range .spec.ports[*]}{.nodePort}{"\n"}{end}' |
    sed '/^$/d' |
    sort -n |
    tr '\n' ' ' |
    sed 's/ $//'
}

service_type_for() {
  kubectl -n "$COMBO_DEV_NAMESPACE" get service "$1" -o 'jsonpath={.spec.type}'
}

service_selector_for() {
  kubectl -n "$COMBO_DEV_NAMESPACE" get service "$1" -o 'jsonpath={.spec.selector.app}'
}

# 全局读取失败必须中止；只有旧 combo-preview 与新 combo-review 的固定 Service
# 可以持有这三个端口，其他占用一律不自动修改。
kubectl get services --all-namespaces -o json > "$cluster_services_file"
python3 - "$cluster_services_file" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)

allowed = {
    ("combo-preview", "web", 30081),
    ("combo-preview", "minio", 30901),
    ("combo-preview", "minio", 30902),
    ("combo-review", "web", 30081),
    ("combo-review", "minio", 30901),
    ("combo-review", "minio", 30902),
}
violations = []
for service in payload.get("items", []):
    namespace = service.get("metadata", {}).get("namespace", "")
    name = service.get("metadata", {}).get("name", "")
    for port in service.get("spec", {}).get("ports", []):
        node_port = port.get("nodePort")
        if node_port in {30081, 30901, 30902} and (
            namespace,
            name,
            node_port,
        ) not in allowed:
            violations.append(f"{namespace}/{name}:{node_port}")
if violations:
    print(
        "[cloud-review] 评审 NodePort 被未知 Service 占用：" + ", ".join(violations),
        file=sys.stderr,
    )
    raise SystemExit(78)
PY

# 先完整预检两个 Service，再做任何写操作，避免部分修改。
minio_type="$(service_type_for minio)" || exit 1
minio_selector="$(service_selector_for minio)" || exit 1
minio_node_ports="$(node_ports_for minio)" || exit 1
web_type="$(service_type_for web)" || exit 1
web_selector="$(service_selector_for web)" || exit 1
web_node_ports="$(node_ports_for web)" || exit 1

[[ "$minio_selector" == minio ]] || {
  echo "[cloud-review] combo-preview/minio selector 不属于 combo-dev MinIO" >&2
  exit 78
}
[[ "$web_selector" == web ]] || {
  echo "[cloud-review] combo-preview/web selector 不属于 combo-dev Web" >&2
  exit 78
}

patch_minio=false
if [[ "$minio_type" == NodePort && "$minio_node_ports" == '30901 30902' ]]; then
  patch_minio=true
elif [[ "$minio_type" != ClusterIP || -n "$minio_node_ports" ]]; then
  echo "[cloud-review] combo-preview/minio 不是可识别的旧评审或 combo-dev Service" >&2
  exit 78
fi

patch_web=false
if [[ "$web_type" == NodePort && "$web_node_ports" == 30081 ]]; then
  patch_web=true
elif [[ "$web_type" != ClusterIP || -n "$web_node_ports" ]]; then
  echo "[cloud-review] combo-preview/web 不是可识别的旧评审或 combo-dev Service" >&2
  exit 78
fi

if "$patch_minio"; then
  kubectl -n "$COMBO_DEV_NAMESPACE" patch service minio \
    --type=merge \
    --patch-file=/dev/stdin <<'JSON' >/dev/null
{"spec":{"type":"ClusterIP","ports":[{"name":"api","protocol":"TCP","port":9000,"targetPort":9000}]}}
JSON
fi

if "$patch_web"; then
  kubectl -n "$COMBO_DEV_NAMESPACE" patch service web \
    --type=merge \
    --patch-file=/dev/stdin <<'JSON' >/dev/null
{"spec":{"type":"ClusterIP","ports":[{"name":"http","protocol":"TCP","port":80,"targetPort":8080}]}}
JSON
fi

minio_type="$(service_type_for minio)" || exit 1
minio_node_ports="$(node_ports_for minio)" || exit 1
web_type="$(service_type_for web)" || exit 1
web_node_ports="$(node_ports_for web)" || exit 1
[[ "$minio_type" == ClusterIP && -z "$minio_node_ports" ]] || {
  echo "[cloud-review] combo-preview/minio 仍占用 NodePort" >&2
  exit 1
}
[[ "$web_type" == ClusterIP && -z "$web_node_ports" ]] || {
  echo "[cloud-review] combo-preview/web 仍占用 NodePort" >&2
  exit 1
}

echo "[cloud-review] 旧评审 NodePort 已释放，combo-preview Service 保持 combo-dev 形态"
