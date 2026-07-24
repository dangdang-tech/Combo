# 发布与运维脚本

本目录保存仓库级验证、部署和运维脚本。发布脚本不得读取、复制或提交环境密钥；需要凭据的步骤只能在对应的受保护 GitHub Environment 中运行。

`release-manifest.mjs` 创建和校验 canonical、不可覆盖的发布清单。清单把一个完整 main 源码 SHA 唯一映射到 API、Runtime、Web 三个 `repository@sha256` 镜像、迁移头和 Web 静态资源摘要。Worker 与 migration 固定使用 API 镜像。

`web-asset-manifest.mjs` 为 Web 与 Runtime Web 的实际构建文件生成严格、确定性的内容摘要清单。正式 CI 从最终 Web 镜像中提取并复验这份清单，而不是从标签或宿主构建目录推断。

Test 使用 `combo-preview`，Preview 使用 `combo-review`，Production 使用 `combo`。新的 release 部署器只管理 migration 与 API、Worker、Runtime、Web 四个业务面；Secret、PVC/PV、旧 Preview 恢复和 NodePort 都不属于新发布事实源。
