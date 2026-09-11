# domains — 业务域契约

这个目录按业务域定义对外接口的数据形状与校验规则，目前只保留认证和待恢复充值订单。每个域同时导出 Zod 运行时 schema 和推导出的 TypeScript 类型。

## 文件

- `auth.ts` 定义邮箱验证码认证域。该文件提供严格的 challenge、verification 与 logout 请求 schema、必填 traceId 的成功包络、当前用户视图 `MeView`、中间件使用的 `AuthContext`、六位验证码与七天会话常量，以及 `sanitizeAuthReturnTo` 站内回跳净化函数。显式安全入口使用 `__Host-cb_session`，显式本地 HTTP 入口使用 `cb_session`，两者都使用根路径。`MeView.email` 是必填的规范邮箱，`MeView.account` 固定为 `creator-` 加八位小写 Base32，登出结果的已知字段只有 `loggedOut: true`。
- `pending-recovery.ts` 定义创建待恢复充值订单所需的严格输入，以及订单和恢复结果视图。金额以规范十进制分字符串表示，并限制在 PostgreSQL bigint 正数范围内。
- `index.ts` 汇总转出以上全部文件。

## 认证契约边界

认证域只定义邮箱六位验证码、`GET /me`、`POST logout` 和一枚按显式传入的 HTTPS 策略命名的不透明 Cookie 所需契约。请求邮箱只执行保守结构校验，不裁剪地址；authoring 使用同一规范化结果完成投递、摘要和身份写入。`sanitizeAuthReturnTo` 最多接受五百一十二字符，只保留首页或小写规范 UUID v4 的 `/agent-transfers/:id`，其他输入统一回落到首页。

## 上下游

authoring 的账号模块使用邮箱请求、验证结果、当前用户、登出、Cookie 和回跳契约，billing 模块使用待恢复订单视图。web 使用相同的认证请求、响应和回跳定义实现自定义登录与站内导航。
