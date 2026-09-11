# @cb/shared 源码总览

这个目录是 authoring 与 web 共同依赖的契约层。接口请求与响应、错误分类和纯函数工具都在这里定义，各应用只消费这些定义，不重复建立另一套协议。

## 文件与子目录

- `index.ts` 是包入口，把下面三个子目录的导出全部转出去。
- `core/` 定义通用 ID、成功响应包络、无公开错误码的对外错误信封、健康检查、发布身份和 traceId 工具。
- `constants/` 定义 API 路由前缀与健康探针路径。
- `domains/` 定义认证和待恢复充值订单的运行时校验规则与类型。
- `__tests__/auth.test.ts` 检查邮箱请求、六位验证码、回跳白名单、会话 Cookie、成功包络、安全错误和就绪依赖。
- `__tests__/pending-recovery.test.ts` 检查待恢复充值订单的严格金额与视图契约。
- `__tests__/release.test.ts` 检查运行时发布身份和无缓存加载契约。

## 约定

每个数据传输对象同时导出 `XxxSchema` 和由该 schema 推导的 TypeScript 类型。服务端使用 schema 校验边界，前端使用同一类型解析结果。认证请求对象使用严格 schema 拒绝未知字段；`returnTo` 在解析时统一净化，只产生首页或规范的 Agent Transfer 路径。认证成功包络要求 `meta.traceId`。认证失败使用统一错误信封，并且不携带公开或内部错误码。

## 上下游

authoring 使用 core 的错误、健康和 trace 工具，constants 的路由前缀，以及 domains 中的认证与待恢复充值契约。web 使用认证视图、认证请求与结果、站内导航规则和发布身份。具体文件关系记录在各子目录 README 中。
