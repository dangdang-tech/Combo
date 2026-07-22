# domains — 业务域契约

这个目录按业务域定义对外接口的数据形状与校验规则，覆盖认证、任务、能力项和试用会话，另含去敏规则引擎。每个域同时导出 Zod 运行时 schema 和推导出的 TypeScript 类型。

## 文件

- `auth.ts` 定义邮箱验证码认证域。该文件提供严格的 challenge、verification 与 logout 请求 schema，以及会忽略未知可选字段的成功响应解码器、必填 traceId 包络、当前用户视图 `MeView`、中间件使用的 `AuthContext`、六位验证码与七天会话常量和 `sanitizeAuthReturnTo` 站内回跳净化函数。它固定生产使用 `__Host-cb_session`，本地 HTTP 开发测试使用 `cb_session`，两者都使用根路径。`MeView.email` 是必填的规范邮箱，`MeView.account` 固定为 `creator-` 加八位小写 Base32，登出结果的已知字段只有 `loggedOut: true`。
- `task.ts` 定义任务域。该文件包含带幂等键的建任务请求、任务视图、仅在创建响应中出现一次的配对码，以及本机助手分片上传接口的请求与结果。
- `capability.ts` 定义能力项域。轻量索引视图用于列表展示，完整可运行定义存入 MinIO 并由试用服务读取，发布结果保存发布状态与分享令牌。
- `trial.ts` 定义试用域。该文件包含会话、消息、产物视图和建会话、改名、发消息请求；消息内容只在共享层约束为数组，严格块校验由 runtime 完成。
- `redaction.ts` 是无输入输出副作用的去敏规则引擎。`redact` 与 `redactBatch` 按带版本规则抹掉联系方式、密钥、证件号、银行卡号和网络地址等隐私信息，并返回聚合报告。
- `index.ts` 汇总导出以上文件。

## 认证契约边界

认证域只定义邮箱六位验证码、`GET /me`、`POST logout` 和一枚按环境命名的不透明 Cookie 所需契约。请求邮箱只执行保守结构校验，不裁剪地址；authoring 使用同一规范化结果完成投递、摘要和身份写入。`sanitizeAuthReturnTo` 最多接受五百一十二字符，并只保留 `/tasks`、`/tasks/` 子路径、`/capabilities`、`/try` 与 `/try/` 子路径。绝对地址、双斜杠、反斜杠、控制字符、编码斜杠和其他路径统一回落到 `/tasks`。

## 上下游

runtime 的认证中间件使用 `AuthSessionCookieValueSchema`、Cookie 常量、角色和 `AuthContext`，并用会话摘要读取 PostgreSQL。authoring 的账号模块使用邮箱请求、验证结果、当前用户、登出、Cookie 和回跳契约。web 与 runtime-web 使用相同请求、响应和回跳定义实现自定义登录与站内导航。

runtime 的能力加载模块使用 `CapabilityDefinitionSchema` 校验从 MinIO 读出的定义，agent 与会话模块使用 capability 和 trial 域类型。authoring 的任务、能力与提取流水线使用 task、capability 和 redaction 域定义。
