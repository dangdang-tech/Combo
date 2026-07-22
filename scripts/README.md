# 运维与验收脚本

本目录保存本地启动、健康冒烟、数据库迁移、生产部署和集成验收脚本。

- `start.sh` 在升级时先按 Compose 项目与服务标签删除并确认历史 Logto 容器退出，再停止当前项目的旧业务容器，随后按基础设施、建桶、数据库迁移和新业务服务的顺序启动。它不删除卷，不停止数据服务或其他 Compose 项目。
- `smoke.sh` 验证存活、就绪、统一错误信封和匿名会话边界，不依赖外部邮件供应商。
- `acceptance-smoke.sh` 验证主链路端点和会话边界。需要鉴权链路时，调用方必须提供已经通过邮箱验证码建立的临时 Cookie 文件；所有鉴权写请求都携带 `WEB_BASE` 的精确 Origin，并先验证错误 Origin 返回 403。
- `integration/resend-auth-e2e.sh` 创建隔离的 Compose 项目和临时凭据，数据库所有者密码会包含 URI 保留字符。它先验证来源与请求体边界，再用 Playwright 操作真实登录页，并验证冷却限流、验证码轮换、发件配置错误、错误次数失效、登录会话轮换、Redis 与邮件供应商故障、PostgreSQL 故障、令牌降级攻击、跨服务共享会话、注销撤销和客户端 pathname 日志脱敏。
- `integration/db-migrate.sh` 在本机 PostgreSQL 验证完整迁移、第一方认证结构、重复执行幂等和非空用户库门禁。`integration/redis-dual.sh` 验证双 Redis 配置。
- `deploy-k8s.sh` 在不修改 Deployment 的前提下记录旧副本、revision 和镜像并预检空用户门禁，随后先武装失败恢复，再把旧业务副本缩到零并单独运行固定 SHA 的迁移 Job。Job 失败时脚本先删除并确认 Job 与 Pod 退出，才检查 schema。业务部署失败且 schema 兼容时，脚本撤销已修改 Deployment、验证旧镜像并恢复原副本；认证迁移本轮已经提交或状态未知时只允许前滚修复。
- `deployment-order.test.mjs` 验证 Compose 的废弃 Logto 清理、根环境文件与静默配置命令，以及 Kubernetes 的停机迁移顺序。它用临时假 Kubernetes 控制面注入第二个 apply、第二个 rollout 和迁移等待失败，并确认迁移 Job 先被终止且所有旧镜像与副本实际恢复。
- `check-production-artifacts.sh` 防止测试文件或测试邮件替身进入生产构建产物，并阻止已移除的外部认证、刷新令牌与开发登录配置重新进入活动源码。

端到端脚本的 Cookie 文件、响应、日志和敏感值哨兵都放在权限受限的 `/tmp` 临时目录，并在退出时清理。脚本只删除自己创建的 Compose 容器、卷、网络和镜像，不停止其他进程或项目。
