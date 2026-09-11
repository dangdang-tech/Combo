# 发布主机回环转发

本目录保存三环境 Web 的回环转发 systemd 单元模板。所有单元只监听 `127.0.0.1`，通过集群内 ClusterIP Service 转发流量，不使用 NodePort，也不负责读取或恢复 Secret。MinIO 只供集群内 API 与初始化 Job 使用，不再设置主机转发。

删除仓库中的单元模板不会停止已经安装的 systemd 单元，也不会移除系统 Nginx 路由；清理这些在线资源必须另获明确授权。

三个主栈单元：

| 单元                                | 监听端口 | 目标 namespace / Service |
| ----------------------------------- | -------- | ------------------------ |
| `combo-test-web-forward.service`    | `18083`  | `combo-test` / `web`     |
| `combo-preview-web-forward.service` | `18081`  | `combo-preview` / `web`  |
| `combo-prod-web-forward.service`    | `18082`  | `combo-prod` / `web`     |

另有 combo-v2 验证命名空间的四个单元（手工部署，随验证结束拆除）：

| 单元                                    | 监听端口 | 目标 namespace / Service    |
| --------------------------------------- | -------- | --------------------------- |
| `combo-v2-authz-forward.service`        | `18091`  | `combo-v2` / `authz`        |
| `combo-v2-restart-life-forward.service` | `18092`  | `combo-v2` / `restart-life` |
| `combo-v2-billing-forward.service`      | `18093`  | `combo-v2` / `billing`      |
| `combo-v2-llm-gateway-forward.service`  | `18094`  | `combo-v2` / `llm-gateway`  |

V2 的 Billing 只经 Nginx 公开支付路径，不公开内部计费与管理接口。Agent 收到的是当前用户断言，代理不转发 Cookie 或 Authorization。

单元以 `User=xingzheng` 运行，使用 `~/.kube/config` 建立 `kubectl port-forward`。安装到主机后执行 `systemctl daemon-reload` 并重启对应单元。系统 Nginx 的 server 块（`test.43-160-242-46.sslip.io`、`review.43-160-242-46.sslip.io`、`agora.43-160-242-46.sslip.io` / `buildwithcombo.com`）把对应域名反代到这些 loopback 端口。
