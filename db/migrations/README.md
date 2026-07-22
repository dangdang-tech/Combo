# 数据库迁移

本目录按文件名字典序保存 PostgreSQL 迁移。已应用的迁移不可修改，新增结构必须通过新的迁移文件演进。

`0000_baseline_schema.sql` 建立当前基线。`0001_expired_upload_reconciliation.sql` 增加上传超时查询索引，`0002_drop_stream_events.sql` 删除已经迁到 Redis 的事件表，`0003_turns.sql` 增加自治轮次与轮内消息顺序。`0004_first_party_email_auth.sql` 仅允许空用户库切换到第一方邮件验证码认证，并创建身份、验证码挑战、会话与低敏审计表。`0005_application_database_roles.sql` 创建无登录的 API、worker 与 runtime 角色，撤销默认权限，并按服务职责授予最小表权限。
