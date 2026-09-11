# Combo 单机 k3s 清单

这套清单把主栈的 PostgreSQL、热态 Redis、MinIO、桶初始化任务、数据库迁移任务和 API、Web 两个业务镜像部署到单节点 k3s（tecent2）。持久卷使用默认可用的 `local-path` 存储类。

三个环境全部在这台主机上，应用使用 in-place 命名：

| 环境       | 应用 namespace  | 基建 namespace                    |
| ---------- | --------------- | --------------------------------- |
| Test       | `combo-test`    | `combo-test`（自己的 foundation） |
| Preview    | `combo-preview` | `combo-foundation`（共享）        |
| Production | `combo-prod`    | `combo-foundation`（共享）        |

Preview 与 Production 共用一套 Postgres、`redis-hot` 和 MinIO，放在 `combo-foundation` namespace；Test 有独立的一套 foundation，数据常驻保留。两套 foundation 由 `environments/test-foundation/` 与 `environments/shared-foundation/` 两个 kustomize overlay 定义，复用根目录的 `postgres.yaml`、`redis-hot.yaml`、`minio.yaml` 与 `job-minio-init.yaml`，并把 MinIO Service 收敛为 ClusterIP。

## 应用清单

`api.yaml` 与 `web.yaml` 是两个业务面的基础清单，引用 `combo-env` Secret 与 `ghcr-pull`，并带环境占位符。`release/base/apps/` 与 `release/base/migrate/` 提供发布专用补丁，`release/overlays/{test,preview,production}/` 按环境设置 namespace。发布渲染由 `scripts/render-env.mjs` 完成，把占位符替换为每环境实际主机名、公开入口与 Secret 名。

所有应用与迁移镜像必须使用 `repository@sha256` 摘要引用，不允许可移动标签。主栈运行面只读取 API 数据库角色、S3、Resend、OTP HMAC 和支付配置；迁移兼容流程仍保留既有数据库角色密码。凭据只通过 `scripts/configure-first-party-auth-secrets.sh` 原位轮换，不删除重建；V2 的 authz/billing 密码只存在于 `combo-v2` 自己的 Secret。

## combo-v2 验证命名空间

`v2/` 保存四个 V2 服务、Agent 自有 Redis 状态容器与持久卷、迁移 Job 的手工部署清单。它独立于三环境晋级链，不进 `render-env.mjs` 与 `deploy-env.sh`。所有对象固定到 `combo-v2`，PostgreSQL 客户端固定使用独立 `combo_v2` 数据库。

平台、Agent 与 Redis 的镜像都按摘要渲染，平台与 Agent 镜像标注源码 SHA。Agent 自有 Redis 只监听同 Pod 的回环地址，使用 1Gi 独立持久卷、AOF 每次落盘和单实例替换，不接生产存储，不保存对话正文。

`combo-env` 保存平台凭据；`restart-life-credentials` 只保存 Agent 独立身份。Authz 保存 Agent 密钥摘要，公开登录使用随机验证码。旧共享入口凭据不再注入；升级同时轮换旧 Billing 内部密钥。V2 Billing 只启用 TEST 支付渠道。

升级前须停下四个 V2 服务，由 `scripts/migrate-v2-host.sh` 持共享基础设施锁执行至 0017 的迁移并核验共享角色与三环境健康。成功后应用同候选清单。服务器部署须有独立授权，不得从代码合入推导授权；拆除或删除持久卷也须单独确认。

## 发布顺序

`.github/workflows/deploy.yml` 统一处理三环境部署。`render-env.mjs` 按环境渲染 foundation / migrate / apps 三份清单，`deploy-env.sh` 在主机上依次执行：确保 foundation 就绪（不重建）、跑迁移 Job（幂等，per-foundation 锁串行）、应用应用清单并等待 rollout。Test 每次只更新应用，基础实例常驻、数据保留。Preview 与 Production 的应用 rollout 互不阻塞，共享 foundation 的迁移串行执行。

## 日常更新

Production 不随 `main` 自动更新。Preview 与 Production 都只消费已通过对应前置检查的 `combo-build-<SHA>` 构建清单与摘要镜像；服务器上的 `kubectl apply`、Kustomize 镜像改写或 Nginx 热改都不是正式发布入口。Secret、TLS、namespace 和无关资源始终不在部署删除范围。

## 当前生产状态与流量拓扑

系统 Nginx 只反向代理到 systemd 单元维护的 Web IPv4 loopback 端口：Test `18083`、Preview `18081`、Production `18082`。MinIO 保持集群内 ClusterIP，只供 API 和桶初始化 Job 使用；公网不暴露对象存储 NodePort 或主机转发。Web forwarder 单元模板在 `infra/host/release/`。

观测栈部署在 `observability` 命名空间，用 Helm 单独安装与升级，配置和安装说明在 `observability/` 子目录；API 的 OTLP 上报地址由清单配置。Grafana 在节点的 30300 端口。
