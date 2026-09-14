# 数据库退役维护

本目录保存需要独立授权和人工执行的退役 SQL。正常迁移、应用启动和自动 Preview 部署不会读取这里。

## 第一批旧入口

`retire-legacy-entrypoints.sql` 删除旧 `uploads`、五张 `oauth_*` 表、`project_agent_shares` 和三张
`project_history_agent_*` 表，以及七个专属函数。其余 32 张业务表和 `schema_migrations` 保留。
`reject_agent_immutable_mutation()` 仍由旧 Builder 使用，因此保留。

这一步目前只允许 Test 的 `combo_dev`，以及名称为 `combo_retirement_test_*` 的隔离验证库。
它使用与迁移 runner 相同的数据库锁，在一个事务中执行，不使用级联删除；存在旧 Worker/Runtime
连接或部分清理状态时失败。默认预检检查目标身份、账本、连接和对象完整性；实际删除时如遇意外
依赖，整笔事务回滚。只有显式设置 `apply_retirement=true` 才删除。

执行前应固定工作树提交，确认 Test 没有旧服务，完成私密的整库 custom-format 备份并恢复到隔离
PostgreSQL 验证。备份和执行回执只保存在服务器数据盘的受限目录，不能提交 Git 或输出业务内容。
回执记录代码提交、SQL 文件摘要、备份摘要、目标实例与数据库，以及前后表清单、行数和保留数据摘要。
脚本要求提供备份摘要，但不会代替操作者验证备份文件或测试恢复。

通过已经确认指向目标实例的 PostgreSQL 连接执行，凭据使用既有安全注入方式：

```sh
psql -X -v ON_ERROR_STOP=1 \
  -v expected_database=combo_dev \
  -v source_sha="$VERIFIED_SOURCE_SHA" \
  -v backup_sha256="$VERIFIED_BACKUP_SHA256" \
  -f db/maintenance/retire-legacy-entrypoints.sql
```

确认预检成功后，在同一命令中增加 `-v apply_retirement=true`。重复执行已完整退役的状态是空操作。
完成后核对十表和七函数不存在，其余表的数据和约束不变，并重新验证 canonical 迁移账本、登录、
Agent Package 和充值接口。历史迁移、历史前缀测试以及 V2 的 `uploads` 定义均不删除。

正式迁移链仍为 `0000–0021`，数据库支持“历史完整结构”和“本步骤已退役结构”两种明确状态。
新空库仍先按历史迁移创建全部表；本步骤不会伪造 `0022` 账本记录。Test 此后运行相同 canonical
迁移不会重建已记账的旧表。共享库的旧服务退役后，应通过后续获授权的正式迁移统一收敛两种状态。

本步骤不删除账号、资金历史或 MinIO 对象。备份中的上传与分享对象引用供后续独立清理使用。
失败会回滚本次事务；成功后如需恢复旧表，应在隔离库恢复备份，再定向恢复本批对象，不能覆盖新账目。

## 第二批旧运行与 Builder

`retire-legacy-runtime.sql` 在第一批完成后删除旧 `tasks`、`capabilities`、`sessions`、`turns`、
`messages`、`artifacts`、五张旧 Builder 表和 `audit_llm_calls`，共十二张表及十二个专属函数。
它同样只允许 Test 与隔离验证库，默认预检，不进入自动迁移；使用上述相同参数和独立的新整库备份。

执行前先部署不再创建或更新旧恢复请求的 Authoring API，并确认没有旧 Runtime/Worker 连接。
所有 usage 必须终结，钱包与免费额度预留为零，pending recovery 必须终结且请求正文已经清空。
不符合条件时停止，不通过批量修改状态或余额伪造完成。第一批已删除的表也必须全部缺席。

十六张当前认证、Agent Package、充值和资金表的原记录保持不变。四张旧历史表
`usage_charges`、`billing_free_allowances`、`agent_usage_receipts`、`pending_usage_recoveries`
保留原行、原 ID 和金额，并冻结普通 INSERT、UPDATE、DELETE、TRUNCATE；管理员的 DDL 能力不在此保证内。
钱包与流水的原扣款关联、充值订单的历史 recovery 关联，以及七个金融和订单校验函数保持不变。
历史订单仍能查单并在可信通知后正常入账；恢复任务终结不等于支付订单失效。

新增的 `legacy_runtime_evidence` 只保存上述历史主体所需的原 Capability、Session、Turn 和收据指定的
响应 Message 数据库记录。每笔 charge、每份免费额度、每条 pending recovery 各对应一份证据。
使用完整 `to_jsonb(row)` 快照，保留 response 的完整 content，不以简写或摘要代替原记录。
capability 的创作者可以不同于消费用户；Session 则必须精确绑定消费用户与能力。
旧收据的 digest 原值继续保留，本步骤不补造推理结果或新的加密验收声明。

证据与历史主体双向外键关联，收据的响应 ID 改为引用证据中的同一 charge、owner、Session、Turn
和 Message。所有新外键和快照形态验证完成后，才移除指向旧运行表的八个外键。
四张历史表和证据表拒绝普通写入，旧 Worker/Runtime 的表级和列级权限全部撤销；API 保留金融约束
所需的既有只读权限，不获得证据正文的读取权限。账号与 V2 本身不作变更。

第二批完成后共有十六张当前业务表、四张只读历史表、一张内部证据表，另有 `schema_migrations`。
账本仍完整到 `0021`。第二批重复执行为无操作；第一批也允许在完整删除后重新检查，不要求已经随
第二批退出的 Builder 函数继续存在。新空库仍按历史链初始化，随后按获授权环境依次执行两批维护。
共享库旧消费者停用后，才能通过后续获授权的正式迁移统一结构。

验证应覆盖：备份恢复、保留二十张表逐行不变、七个金融函数不变、全部历史主体和响应证据覆盖、
新外键已验证、表级和列级权限收口、普通拒写、意外依赖整体回滚、两批重跑，以及实际 API 角色对
历史非空 recovery 订单的读回和模拟可信通知入账。旧审计及不再在线保留的内容仍可从受控备份恢复；
对象存储引用也应留在备份中，本 SQL 不删除桶或对象。

## 第三批丢弃旧调用历史

`retire-legacy-history.sql` 只在用户明确不再需要旧调用历史后执行，删除四张只读历史表和
`legacy_runtime_evidence`，不再为它们建立在线归档。此后只有十六张当前业务表和迁移账本。
旧调用明细不再在线可查；此前备份继续保留，本步骤不删除任何备份或对象存储内容。

它要求前两批完整完成、五表已冻结、没有旧消费者、没有未完成调用或资金预留，且钱包余额与完整
原流水净额一致。执行前重新进行私密整库备份和隔离恢复验证，参数与前两批相同；默认仅预检。
实际删除必须同时传入 `apply_retirement=true` 和 `discard_legacy_history=true`，不能把保留历史
的第二批授权自动延伸为丢弃历史。第三批独立使用同一迁移锁及单一事务，未知依赖导致整笔回滚。

保留 `wallet_ledger.usage_charge_id` 和 `recharge_orders.recovery_usage_id` 原值与索引，
只移除指向旧表的外键；这些值此后只是历史标识，不再允许新行填入非空值。原钱包余额、充值订单、
支付记录和不可变流水均不更新、不清空。历史负数流水继续参与钱包净额核算。

钱包仍在延迟约束中锁定账户并核对余额与完整流水，预留金额必须为零。API 仍只能追加充值流水，
旧 Runtime 不再有账户和流水的表级、列级权限；新的旧调用扣款及补偿流水一律拒绝。充值与唯一
入账流水的双向校验、流水不可改和历史恢复标识不可改绑仍保留；旧订单迟到付款仍可正常入账。
这里只撤销当前 Test 数据库的旧金融权限，不删除实例级角色，也不修改 V2 或共享库。

第三批可重复预检或执行；第一、二批也识别后续完整退役状态，不重建历史表。canonical 账本仍为
`0000–0021`，正常迁移重跑不会覆盖维护后的函数或重建旧表。不要在真实 Test 上运行要求完整旧结构的
`scripts/integration/db-migrate.sh`；该脚本仅用于临时完整历史 schema 的集成测试。

验收需核对十六张保留表和账本的完整原记录一致，充值与流水不可变函数未改；在隔离恢复库验证
正常充值、历史订单迟到入账及幂等仍通过，余额单改、单添流水、非零预留、新旧调用流水和新恢复绑定
均失败，再执行真实 Test 维护并重新验证服务。本步骤及前两批均不会由自动部署读取。
