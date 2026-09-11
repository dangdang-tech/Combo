# 共享契约测试

本目录验证共享包向各应用公开的协议与解析边界。

- `auth.test.ts` 验证邮箱输入、验证码、返回地址、第一方认证请求与向前兼容响应、会话 Cookie、认证错误和健康依赖契约。Authoring 与 Web 共同消费这些规则。
- `pending-recovery.test.ts` 验证 Authoring billing 保留的严格充值输入、订单视图、恢复视图与 cents 边界。
- `release.test.ts` 验证 Web 使用的公开版本身份元数据与无缓存加载边界。
