# Combo Cloud Review（固定单槽）

Cloud Review 是团队共享的真实体验环境：代码在 GitHub Actions 构建，镜像推到 GHCR，然后部署到云主机 K3s 的独立 `combo-review` namespace。本地电脑不需要构建镜像、启动数据库或维持预览服务。

它是一个固定单槽环境，而不是每个 PR 一套临时栈。新版本会覆盖旧版本，但 PostgreSQL、Redis Queue 和 MinIO 的 PVC 会保留，适合连续体验真实的创建、提取、试用和前端产物交互链路。

## 隔离边界

- Namespace：`combo-review`，不读取 `combo` 或 Combo development 使用的 `combo-preview` namespace 中任何 Secret、PVC 或工作负载。
- Secret：`combo-preview-env`、`combo-preview-bootstrap`、`combo-preview-ghcr-pull`。
- PVC：`combo-preview-postgres-data-postgres-0`、`combo-preview-redis-queue-data-redis-queue-0`、`combo-preview-minio-data-minio-0`。
- NodePort：Web `30081`、MinIO API / console `30901` / `30902`，与生产 `30080` / `30900` 不冲突。
- 业务副本：API、Worker、Consumer、Sweeper、Runtime、Web 各 1 个，并显式设置 CPU / memory requests 与 limits。

Cloud Review 的 Web 入口整体受独立 Cookie 访问闸保护。用户从 `/__review/enter#<access-token>` 进入，邀请 token 只在浏览器 fragment 中出现，页面通过同源 HTTPS 换取 `HttpOnly + Secure + SameSite=Strict` Cookie，随即从地址栏清除 token。`dev-login` 只在非 production 模式启用，并位于这道保护之后；`/__review/bootstrap` 会自动创建隔离的预览身份并进入目标页面，失败时才显示重试操作。访问 token 与会话签名密钥都来自专属 `combo-preview-bootstrap`，不得复制生产 Secret。

本机导入助手是唯一的路由级例外：script、bin、upload 三类 `/api/v1/(import/)connect/*` 通道不要求 Review Cookie，因为 `curl | sh` 和下载后的助手不会携带它。script / upload 仍由应用层 pairing code / PairAuth 校验；创建配对码、查询状态等网页 API 没有放行，继续受全站保护。

## 一次性云端前置

1. 在 K3s 节点创建 namespace：

   ```sh
   kubectl apply -f /opt/combo-preview/infra/k8s/overlays/cloud-review/platform/namespace.yaml
   ```

2. 准备独立应用配置文件，例如 `/opt/combo-preview/secrets/app.env`。数据库、S3、Logto 回调 URL 和 LLM 配置都必须指向预览环境；不要复制整份生产 `.env`。

   ```sh
   kubectl -n combo-review create secret generic combo-preview-env \
     --from-env-file=/opt/combo-preview/secrets/app.env
   ```

3. 生成独立的 dev session 密钥与 Review 访问 token，再创建 bootstrap Secret：

   ```sh
   printf '%s' "$(openssl rand -hex 32)" > /opt/combo-preview/secrets/dev-session-secret
   printf '%s' "$(openssl rand -hex 32)" > /opt/combo-preview/secrets/review-access-token
   kubectl -n combo-review create secret generic combo-preview-bootstrap \
     --from-file=DEV_SESSION_SECRET=/opt/combo-preview/secrets/dev-session-secret \
     --from-file=REVIEW_ACCESS_TOKEN=/opt/combo-preview/secrets/review-access-token
   ```

4. 创建独立 GHCR pull Secret：

   ```sh
   kubectl -n combo-review create secret docker-registry combo-preview-ghcr-pull \
     --docker-server=ghcr.io \
     --docker-username='<github-user>' \
     --docker-password='<read-packages-token>'
   ```

命令中的源文件应保持 `0600`，不要提交到 Git。Secret 更新时使用 `kubectl create ... --dry-run=client -o yaml | kubectl apply -f -`，避免删除 namespace 或数据卷。

## GitHub Environment

创建受保护的 `cloud-review` Environment，启用 required reviewers，并配置：

- Secrets：`CLOUD_REVIEW_SSH_KEY`、`CLOUD_REVIEW_HOST`、`CLOUD_REVIEW_USER`、`CLOUD_REVIEW_ACCESS_TOKEN`、`CLOUD_REVIEW_OPENROUTER_API_KEY`。
- Variables：`CLOUD_REVIEW_BASE_URL`（例如 `https://review.buildwithcombo.com`）、`CLOUD_REVIEW_LLM_PROVIDER`（当前为 `openrouter`）、`CLOUD_REVIEW_LLM_MODEL`（OpenRouter 模型 ID）。

部署任务会把预览专属的 OpenRouter 凭据与模型选择合并进 `combo-preview-env`；凭据只通过 GitHub Environment Secret 和 SSH 标准输入传递，不写入仓库、命令参数或日志。Runtime 与 Worker 会在 Secret 更新后显式重启，部署脚本也会验证 Runtime 进程实际拿到了与 provider 匹配的 LLM 凭据和非空模型 ID。

`.github/workflows/cloud-review.yml` 会在 `codex/agent-studio-cloud-preview` 分支 push 后自动运行，也支持手动 `workflow_dispatch` 选择其他 ref。三镜像在 GitHub runner 中构建并以完整 commit SHA 推送；只有通过 Environment 审批后，固定槽位才会被覆盖。

从旧的共享 namespace 迁移时，workflow 会先运行 `scripts/release-cloud-review-nodeports.sh`。该脚本只在确认 `combo-preview` 由 combo-dev 持有、且 Service 精确占用旧评审端口时，将 MinIO 和 Web 恢复为 combo-dev 声明的 ClusterIP；它不会删除 Service、Pod、PVC 或数据。后续运行中该步骤保持幂等。

Web 镜像构建时同时写入 `VITE_DEPLOY_ENV=preview`、完整 `VITE_BUILD_SHA` 与触发部署的 `VITE_REVIEW_SOURCE`，便于页面和诊断信息明确区分云端评审版本。公网 smoke 把 Review token 写入权限为 `0600` 的临时 curl config，只在 HTTPS 请求头中传入，不把它写入命令行参数或日志。

访问 token 轮换时，同时更新 `combo-preview-bootstrap/REVIEW_ACCESS_TOKEN` 与 GitHub Environment Secret `CLOUD_REVIEW_ACCESS_TOKEN`，然后重新执行 Cloud Review workflow。部署脚本会强制重启 Web，使旧 Cookie 立即失效；不要只更新 Secret 而跳过部署。

## 部署顺序与验证

`scripts/deploy-cloud-review.sh` 强制执行以下顺序：

1. 创建 namespace，验证三个专属 Secret 存在且 bootstrap 键非空。
2. 部署并等待 PostgreSQL、两个 Redis、MinIO 与建桶 Job。
3. 删除并重建 migration Job，等待数据库迁移成功。
4. 只有迁移成功后才更新 API、Worker、Consumer、Sweeper、Runtime、Web，并等待六个 rollout；Runtime、Worker 和 Web 会显式重启以加载稳定名称 Secret 的新值。
5. GitHub runner 从公网运行 `scripts/cloud-review-smoke.sh`，验证匿名访问被拦、授权页面、bootstrap 会话、`/ready` 和 `/try/`。

各阶段 overlay 复用仓库根部的生产资源文件，因此渲染命令显式使用 Kustomize 的 `LoadRestrictionsNone`；输入仍只来自本次 checkout 后同步到 `/opt/combo-preview/infra/k8s` 的受版本控制目录，不读取 Secret 文件。

公网冒烟也可独立重放：

```sh
REVIEW_BASE_URL=https://review.buildwithcombo.com \
REVIEW_ACCESS_TOKEN='<preview-only-token>' \
bash scripts/cloud-review-smoke.sh
```

## 仍需人工完成

- DNS 与云主机 Nginx/TLS：当前固定入口使用 `review.43-160-242-46.sslip.io`，对象存储使用 `review-s3.43-160-242-46.sslip.io`；宿主反代模板见 `infra/nginx/cloud-review-host.conf`。防火墙不要直接向公网开放 30081、30901、30902。
- Logto：创建独立 preview application 或至少登记预览域名的 callback/logout URI，并把对应值写入 `combo-preview-env`。
- Secret：按上文一次性创建预览专属三 Secret；不要把生产 Secret 导出后改名复用。
