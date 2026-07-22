# Combo 单机 k3s 清单

这套清单把生产 Docker Compose 栈中的 PostgreSQL、两个 Redis 实例、MinIO、桶初始化任务、数据库迁移任务和三个业务镜像部署到单节点 k3s。所有资源位于 `combo` 命名空间，持久卷使用默认可用的 `local-path` 存储类。

清单保留了 Compose 中的数据持久化、Redis 队列不驱逐、Redis 热数据可驱逐、MinIO 建桶和独立数据库迁移等语义。Kubernetes 没有采用 Compose 的 `depends_on`；基础设施的就绪探针负责报告状态，两个一次性任务和业务工作负载由部署命令按顺序创建。第一方认证表与业务表位于同一个 PostgreSQL 数据库，不部署独立身份服务。

## 部署前准备

先创建命名空间，再从服务器上的生产环境文件创建应用配置 Secret：

```sh
kubectl apply -f infra/k8s/namespace.yaml
kubectl -n combo create secret generic combo-env --from-env-file=/opt/combo/infra/.env
kubectl -n combo create secret docker-registry ghcr-pull --docker-server=ghcr.io --docker-username=<GitHub 用户名> --docker-password=<具有 read:packages 权限的 PAT>
```

`ghcr-pull` 用的 token 需要长期有效：CD 流水线用的是 GitHub Actions 的临时 token、部署完即登出，集群里拉镜像必须另建一个 read:packages 权限的个人访问令牌（PAT）。

`combo-env` 必须包含迁移所有者使用的 `POSTGRES_USER`、`POSTGRES_PASSWORD` 与 `POSTGRES_DB`，以及三份独立应用角色密码和已经 URL 编码的 `API_DATABASE_URL`、`WORKER_DATABASE_URL`、`RUNTIME_DATABASE_URL`。迁移 Job 会把所有者配置映射到独立的 PostgreSQL 连接字段，因此所有者密码可以包含 `/`、`#` 与 `?` 等 URI 保留字符。它还要包含清单引用的 S3、LLM 配置，以及 `PUBLIC_APP_ORIGIN`、`RESEND_API_KEY`、`RESEND_FROM_EMAIL` 和 `OTP_HMAC_SECRET`。只有迁移 Job 接收所有者与三份角色密码；业务 Pod 只接收各自的数据库连接串。只有 authoring API 接收邮件和验证码密钥，authoring 与 runtime 都接收同一个公开站点来源。部署前还必须把 `kustomization.yaml` 中三个业务镜像的 `latest` 改成被部署提交的完整 SHA。可以在 `infra/k8s` 目录执行以下命令：

```sh
kustomize edit set image ghcr.io/dangdang-tech/combo-api=ghcr.io/dangdang-tech/combo-api:<SHA> ghcr.io/dangdang-tech/combo-runtime=ghcr.io/dangdang-tech/combo-runtime:<SHA> ghcr.io/dangdang-tech/combo-web=ghcr.io/dangdang-tech/combo-web:<SHA>
```

## 首次部署

首次部署应先创建基础设施，并等待 PostgreSQL、Redis 和 MinIO 就绪：

```sh
kubectl apply -f infra/k8s/postgres.yaml -f infra/k8s/redis-queue.yaml -f infra/k8s/redis-hot.yaml -f infra/k8s/minio.yaml
kubectl -n combo rollout status statefulset/postgres
kubectl -n combo rollout status statefulset/redis-queue
kubectl -n combo rollout status statefulset/minio
kubectl -n combo rollout status deployment/redis-hot
```

基础设施就绪后创建建桶任务和数据库迁移任务，并等待它们成功完成：

```sh
kubectl apply -f infra/k8s/job-minio-init.yaml -f infra/k8s/job-migrate.yaml
kubectl -n combo wait --for=condition=complete job/minio-init job/migrate --timeout=300s
```

两个任务完成后创建业务工作负载：

```sh
kubectl apply -f infra/k8s/api.yaml -f infra/k8s/worker.yaml -f infra/k8s/runtime.yaml -f infra/k8s/web.yaml
```

完成首次分阶段部署后，整套声明也可以使用 `kubectl apply -k infra/k8s` 重复应用。就绪探针会阻止尚未就绪的 API 和 runtime 接收流量，但不会替代首次部署时对任务完成状态的检查。

## 日常更新

日常更新由 CD 流水线全自动完成。main 的完整 CI 通过并发布同一 SHA 的三个镜像后，CD 把本目录同步到服务器 `/opt/combo/infra/k8s`，再执行 `scripts/deploy-k8s.sh`。脚本先检查 `0004` 是否已应用；尚未应用时必须确认 `users` 为空，失败不会修改任何 Deployment。预检通过后，脚本记录四个旧 Deployment 的副本、revision 和镜像，在第一次缩容前武装失败恢复，再把旧 api、worker、runtime 和 web 副本缩到零。脚本单独创建并等待固定 SHA 的迁移 Job，成功后逐个应用和等待固定 SHA 的四个业务面，最后由 CD 对 30080 入口运行冒烟。

迁移 Job 等待失败或超时时，脚本会先前台删除 Job 并确认所属 Pod 全部退出，之后才检查迁移记账。手动部署只接受包含 `0004`、`0005` 和四个第一方认证端点，且同一 SHA 已通过完整 CI 的镜像。第一方认证切换删除了旧身份列，因此不能回滚到切换前镜像；数据库问题必须以前滚修复处理。迁移在提交 `0004` 前失败时脚本会恢复原副本；如果 `0004` 在部署前已经存在，业务 apply 或 rollout 失败会撤销已修改 Deployment、验证旧镜像并恢复原副本。迁移本轮已经提交或状态未知时，旧镜像保持停止。

## 当前生产状态与流量拓扑

2026-07-17 已完成从 docker compose 到本套清单的割接（过程与验证记录见 issue #86）。系统 nginx 的两个公网 vhost 现在指向 k8s：`agora.43-160-242-46.sslip.io` 反代到节点 30080（web 的 NodePort），`s3.43-160-242-46.sslip.io` 反代到节点 30900（minio 的 NodePort，浏览器预签直传入口）。

历史 compose 栈的容器已停止但配置与数据卷仍保留，数据冻结在割接时刻，只用于灾难取证。第一方认证 schema 不兼容旧 Logto 镜像，不能把恢复旧 compose 当作当前数据库的回滚方案。

观测栈部署在 `observability` 命名空间，用 Helm 单独安装与升级，配置和安装说明在 `observability/` 子目录；业务三进程的 OTLP 上报地址已写进各自清单的环境变量。Grafana 在节点的 30300 端口。
