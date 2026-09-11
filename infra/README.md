# 基础设施目录

本目录维护本地 Compose、生产覆盖层、Kubernetes 清单、容器镜像和同源 Nginx 入口。

私有 Agent Draft 复用 Creator Worker 的公开纯编译器出口；`Dockerfile.api` 按 authoring 依赖顺序构建，并在运行层携带所需工作区包的 manifest 与 dist。它不启动 Codex Host、Broker 或额外进程；三环境部署拓扑与授权边界保持不变。

- `docker-compose.yml` 定义生产口径的 PostgreSQL、热态 Redis、MinIO、观测组件、数据库迁移、Authoring API 和 Web。迁移容器用独立 PostgreSQL 连接字段接收数据库所有者凭据，不把原始密码拼进 URI；API 使用独立应用角色凭据，并从环境变量读取 Resend、邮箱发件人、公开站点来源和验证码摘要密钥。
- `docker-compose.dev-test.yml` 只用于本地测试，并增加 Resend HTTP 替身。它不会被生产覆盖层或生产清单引用。
- `docker-compose.prod.yml` 为部署环境改用已经发布的业务镜像，并收紧宿主端口。
- `Dockerfile.api` 与 `Dockerfile.web` 构建主栈的两个生产镜像。API 镜像携带 Shared 与 Creator Agent 的必要运行时产物，并包含迁移入口所需的应用角色配置脚本。`Dockerfile.resend-mock` 只构建测试替身。`Dockerfile.v2` 与 `entrypoint-v2.sh` 构建 combo-v2 验证栈的独立镜像，主栈镜像和迁移链不引用它。
- `resend-mock/` 保存无第三方依赖、无访问日志的测试邮件服务及其单元测试。
- `nginx.conf` 把 React 与 Authoring API 放在同一个站点下，使浏览器使用主机限定的 HttpOnly 会话 Cookie。生产 Cookie 使用 `__Host-` 前缀、Secure、根路径且没有 Domain；本地 HTTP 测试使用无前缀名称。访问日志只保留请求方法、响应状态和耗时。
- `k8s/` 保存主栈 API、Web、迁移与基础资源的 Kubernetes 清单。只有 API Pod 接收 Resend 与验证码密钥。
- `k8s/v2/` 与 `host/combo-v2-test.conf` 保存独立 V2 Test 的每 Agent 身份、TEST 收银台及有限公开支付路由。Agent 自有 Redis 状态容器与持久卷只保留协调元数据，代理不把用户 Cookie 或平台内部密钥交给 Agent。`host/release/` 的 V2 四个单元只监听主机回环地址。
- `minio/`、`redis/` 和 `observability/` 保存各基础设施组件的静态配置。MinIO 初始化只确保 `combo-artifacts` 桶存在，不删除或重写对象。
