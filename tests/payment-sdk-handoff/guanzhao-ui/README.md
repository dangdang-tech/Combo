# 观照点数与支付流程设计交接

本目录交付右上角账户点数、发送按钮成本、扫码充值和充值后继续原问题的前端设计。负责人为 xz1220，关联 [Combo #357](https://github.com/dangdang-tech/Combo/issues/357) 与 [Payment SDK #7](https://github.com/dangdang-tech/combo-agent-sdk/pull/7)。这是可运行的 Mock 交接包，未接入真实支付、账户或模型服务。

## 当前交付

2026-09-15 修订：进入问事页即在右上角看到当前点数；标准与深入的发送按钮分别显示「发送 · 2 点」与「发送 · 20 点」；正常发送直接继续对话，不弹扣点确认。余额不足时在输入框下方轻提示差额并保留问题。充值到账后可继续同一个问题，不再增加确认页。

扫码页按观照既有 `app/commerce-view.tsx` 的订单与二维码结构整理：桌面左侧订单、右侧扫码，窄屏先扫码再看订单；展示微信或支付宝、金额、到账点数、有效期和原订单查询。演示二维码可解码为普通文本 `GUANZHAO DEMO - NOT FOR PAYMENT`，明确标注「非付款码」。真实接入应展示当前用户获授权订单返回的 `order.qrImage`，不能把本演示图用作收款码。

保留观照浅色「朱砂纸本」与深色「墨夜观星」主题。金额、问题、账户与状态都是合成演示数据。2 / 20 点及 100 点 / ¥10、320 点 / ¥30、800 点 / ¥68 仅用于体验与布局，正式成本必须来自服务端报价。

## 源文件与文档

`payment-lab.tsx` 管理十种状态与本地演示；`payment-question.tsx` 管理问题输入及按钮成本；`payment-qr.tsx` 提供演示扫码卡。样式按 `payment-lab.css`、`payment-responsive.css`、`payment-revision.css` 顺序加载，最后一份负责本轮调整。文件均位于 `source/app/payment-lab/`。

`source/app/theme-toggle.tsx` 沿用观照主题开关；`payment-tokens.css` 提供独立预览所需的主题变量。`main.tsx`、`index.html` 与 `vite.config.ts` 提供独立入口，`source/app/payment-lab/page.tsx` 保留 Next 路由入口。

接入责任见 `CONTRACT.md`，当前验证见 `ACCEPTANCE.md`，参考来源见 `REFERENCE.md`，图片索引见 `screenshots/README.md`。本轮证据保存在 `evidence/`；此前 30 点确认页与占位截图在历史提交 `2cdc31c` 中，不代表本轮行为。仓库预算禁止二进制改动，PNG 留在本地验收产物并附在 PR 中。

## 独立预览

复制整个目录到本地临时目录，在副本执行：

```bash
npm install --ignore-scripts --package-lock=false --workspaces=false
npm run dev
```

打开 `http://127.0.0.1:4597`。安装只影响副本，不修改 Combo 根依赖或锁文件。此目录不在 pnpm workspace 内，需单独运行 `npm run build` 与 TSX 类型检查；Combo 全仓门禁不能代替独立预览验证。

也可以将 `source/app/payment-lab/` 放入观照的 `app/payment-lab/`；沿用观照的全局样式和 `app/theme-toggle.tsx`，再完成类型与构建检查。独立用的 `payment-tokens.css` 不应覆盖正式全局主题。

## 如何体验

默认打开问事页，右上角 20 点。发送标准问题后变为 18 点，输入清空；再次填写问题并选择深入，按钮显示 20 点，发送时轻提示还差 2 点。点「去充值」，选择方式与套餐，进入扫码页。

「我已支付，查询状态」只查询同一演示订单，不加点。通过页面下方的「预览控制」模拟到账 320 点后，余额为 338 点；点「继续原来的解读」后沿用原问题与 20 点成本，余额为 318 点。重复查看已到账订单或返回问事不重复入账、扣点。

顶部状态选择器加载十种确定样本，用于视觉检查，不代表真实状态转换。刷新会重置演示账户、订单和对话；主题偏好由现有组件保存。二维码过期或结果未知时隐藏扫码区，并保留核实原订单的入口。

## 接入边界

真实扣点、报价、幂等、到账和资金预留均由服务端负责。用户点击显示成本的发送按钮表达本次请求的意愿；原余额不足调用使用原 `operationId` / `callId` 恢复，已有预留不能重复扣费。报价变化时应先更新按钮和报价状态，不按用户未看到的新价格执行。

创建本分支时 Combo 基线为 `5f6c7c6679dff298540ea8f204ae441cf8b71fc2`，观照视觉基线为 `e39fa29d80a730dabcd229e5dae21f79c3fbc580`。本目录不修改生产支付开关或旧 v1 支付合同；#357 的主动充值、业务点数与 KOL 实收仍属于已接受的后端增量。

本地 Mock 验证不能提升 `ACC-CONTRACT-055A`、`ACC-RECOVERY-055C`、`ACC-HOST-055D` 或 `ACC-UAT-055E` 的真实验收状态。真实渠道、账户、回调、模型、Host、跨用户隔离和部署均需另行完成。
