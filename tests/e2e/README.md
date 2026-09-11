# 浏览器端到端测试

本目录使用 Playwright 验收真实浏览器主链路。

`resend-auth.spec.ts` 从自定义登录页申请邮件验证码，通过仅在开发测试栈启用的 Resend 模拟服务读取验证码，确认单一 API 建立的会话 Cookie 对页面脚本不可见，并在注销后拒绝旧会话。测试数据只写入本次隔离 Compose 项目的临时 PostgreSQL。
