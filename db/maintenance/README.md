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
