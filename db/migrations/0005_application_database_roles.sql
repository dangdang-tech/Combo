-- 迁移所有权账号只用于建表和授权。三个业务进程使用固定、互不继承的登录角色；
-- 密码由迁移 runner 通过环境变量设置，不进入 SQL 文件或 schema_migrations。
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'combo_api') THEN
    CREATE ROLE combo_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'combo_worker') THEN
    CREATE ROLE combo_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'combo_runtime') THEN
    CREATE ROLE combo_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END
$roles$;

-- 已存在的同名角色也收紧到应用权限；迁移 runner 在全部 DDL 成功后才启用 LOGIN。
ALTER ROLE combo_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE combo_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE combo_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO combo_api, combo_worker, combo_runtime;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
  FROM PUBLIC, combo_api, combo_worker, combo_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION gen_uuid_v7()
  FROM PUBLIC, combo_api, combo_worker, combo_runtime;

-- authoring API 是第一方认证唯一写入者，同时负责任务与能力的浏览器接口。
GRANT SELECT, INSERT, UPDATE, DELETE ON
  users,
  auth_identities,
  auth_otp_challenges,
  auth_sessions,
  auth_audit_events,
  tasks,
  uploads,
  capabilities,
  audit_llm_calls
TO combo_api;

-- worker 只处理提取流水线，不读取或写入任何认证表。
GRANT SELECT, INSERT, UPDATE, DELETE ON
  tasks,
  uploads,
  capabilities,
  audit_llm_calls
TO combo_worker;

-- runtime 只读共享会话事实，并读写自己的试用业务表。
GRANT SELECT ON users, auth_sessions, capabilities TO combo_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  sessions,
  turns,
  messages,
  artifacts
TO combo_runtime;

GRANT EXECUTE ON FUNCTION gen_uuid_v7() TO combo_api, combo_worker, combo_runtime;
