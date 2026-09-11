# authoring 服务源码总览

这是 Combo 当前主栈的单一 API 服务。它承载邮箱认证、账户、充值、J-012 结构化 Draft、Agent Transfer、公开发布与接收器交付，HTTP 路由前缀是 `/api/v1`。

## 四层布局

- `processes/` 放唯一的 API 进程入口。
- `bootstrap/` 组装 Fastify、基础设施、健康检查和业务路由。
- `modules/` 按 account、agent-package-release、agent-draft 和 billing 四个业务领域组织代码。account 是第一方认证唯一写入方，agent-draft 保存私有编译快照，agent-package-release 负责 Transfer、公开发布与接收器交付，billing 是外部充值与内部钱包入账的唯一写入方。
- `platform/` 提供配置、HTTP 边界、PostgreSQL、热态 Redis、不可变对象存储、Resend、本地会话校验和链路追踪等公共设施。

依赖保持单向。processes 使用 bootstrap 与 modules，bootstrap 使用 modules 与 platform，modules 使用 platform，platform 不依赖业务模块。共享类型、错误信封、Cookie 常量和校验契约来自 `@cb/shared`。

## 文件

- `index.ts` 默认加载 API 进程入口。
- `tsconfig.json` 为编辑器覆盖源码与测试文件的类型项目，实际生产构建仍使用包根目录的配置。

## 登录与创作主链路

1. React 向 `POST /api/v1/auth/email/challenges` 请求邮箱验证码，再向 verification 端点提交六位码。
2. account 模块在 PostgreSQL 中一次消费验证码，首次登录时创建用户和邮箱身份，并签发只保存摘要的七天会话。
3. 浏览器只持有一枚 HttpOnly Cookie。HTTPS 发布入口显式配置根路径、Secure 且主机限定的 `__Host-cb_session`，本地 HTTP 开发入口显式配置根路径 `cb_session`，选择不依赖 `NODE_ENV`。authoring 的受保护路由只按当前安全策略对应的 Cookie 查询本地会话，不接受 Bearer 或 refresh 凭据。
4. 登录成功后只允许回到首页或规范的 `/agent-transfers/:id` 路由；其他返回地址统一回落到首页。

## Agent 交付

Test 环境的 Transfer 路由接受 Desktop 发起的精确摘要意图、浏览器账户批准和私有上传。用户必须再次通过 Cookie 与精确 Origin 明确确认公开发布；匿名页面和接收器端点只读取已发布且未撤销的 Release。Package 文件写入固定 `combo-artifacts` 桶并保持不可覆盖。

## 充值主链路

1. 已登录用户手动填写充值金额并用 `rechargeIntentId` 创建内部充值订单。
2. billing 模块调用固定环境的乐收赢扫码支付（C扫B `/v3/prepay`）接口，只把经过验签和安全校验的支付动作返回浏览器。
3. 浏览器支付结果不改变余额；乐收赢通知或原订单主动查单确认成功后，数据库事务同时完成订单成功、钱包增加和不可变资金流水追加。
4. 网络结果不确定时订单进入 `unknown`。用户轮询内部订单会在短租约保护下查询原支付流水，不会生成新的支付流水。
