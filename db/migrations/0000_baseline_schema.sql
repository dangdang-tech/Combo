-- 0000 · 基线 schema（2026-07-04 合并自原 0000-0018 共 19 个迁移文件）。
--   内容与生产库 pg_dump --schema-only 逐项对齐（空库重放后 diff 为零），是全部 29 张业务表的
--   完整现状（含函数/索引/触发器/外键）；组织方式为按业务域手写分节，列注释搬自原手写迁移。
--   合并原因（Daniel 决策）：迁移历史只增不减会让 db/ 越堆越大，历史推理成本高于价值；
--     表结构的演进背景查 git 历史或飞书文档「Agora 数据库活跃表说明」。
--   规则：今后 schema 变更仍新增迁移文件（编号从 0001 起）；历史再度堆积时可再次合并基线。
--   基线切换时旧库的 schema_migrations 已重置为只含本文件（见 scripts/migrate.ts 头注释）。

-- ===================== 扩展与 UUID v7 生成器（脊柱 §1.3：主键用 UUID v7，时间有序）=====================
-- gen_uuid_v7()：PG 内置无 v7（PG18 才有 uuidv7()），此处提供 SQL 兜底实现，跨版本可用。

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION gen_uuid_v7() RETURNS uuid AS $$
DECLARE
  unix_ts_ms bigint;
  uuid_bytes bytea;
BEGIN
  unix_ts_ms := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  -- 16 随机字节起底，再覆盖前 48 位为毫秒时间戳，写入 version(7) 与 variant(10) 位。
  -- Codex#9：所有 set_byte 的 byte 值显式 ::int。
  -- 前 6 字节来自 bigint 位运算（结果仍是 bigint），不显式转 int 会让 set_byte(bytea,int,bigint)
  -- 找不到函数签名 → 首次默认插入即报错。逐个 ::int 收口（值已 & 255，落在 0..255，转换安全）。
  uuid_bytes := gen_random_bytes(16);
  uuid_bytes := set_byte(uuid_bytes, 0, (((unix_ts_ms >> 40) & 255))::int);
  uuid_bytes := set_byte(uuid_bytes, 1, (((unix_ts_ms >> 32) & 255))::int);
  uuid_bytes := set_byte(uuid_bytes, 2, (((unix_ts_ms >> 24) & 255))::int);
  uuid_bytes := set_byte(uuid_bytes, 3, (((unix_ts_ms >> 16) & 255))::int);
  uuid_bytes := set_byte(uuid_bytes, 4, (((unix_ts_ms >> 8) & 255))::int);
  uuid_bytes := set_byte(uuid_bytes, 5, ((unix_ts_ms & 255))::int);
  -- version = 7（高 4 位）；get_byte 返回 int，运算结果已是 int，仍显式 ::int 统一收口。
  uuid_bytes := set_byte(uuid_bytes, 6, (((get_byte(uuid_bytes, 6) & 15) | 112))::int);
  -- variant = 10xx
  uuid_bytes := set_byte(uuid_bytes, 8, (((get_byte(uuid_bytes, 8) & 63) | 128))::int);
  RETURN encode(uuid_bytes, 'hex')::uuid;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- ===================== 核心基表（脊柱 §4/§6 + 10-auth §7）：users / jobs / idempotency_keys =====================

-- users（10-auth §7，血缘根）
CREATE TABLE users (
  id             uuid        PRIMARY KEY DEFAULT gen_uuid_v7(),
  logto_user_id  text        NOT NULL,
  account        text        NOT NULL,
  email          text,
  roles          text[]      NOT NULL DEFAULT '{creator}',
  status         text        NOT NULL DEFAULT 'active',
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_status_chk CHECK (status IN ('active','disabled')),
  -- 角色集（10-auth §6.1 + 50-publish §2.6，Codex#7）：creator/consumer 双业务角色 + reviewer 评审角色。
  CONSTRAINT users_roles_chk  CHECK (roles <@ ARRAY['creator','consumer','reviewer']::text[])
);
CREATE UNIQUE INDEX uq_users_logto_user_id ON users (logto_user_id);
CREATE UNIQUE INDEX uq_users_account_lower ON users (lower(account));
CREATE UNIQUE INDEX uq_users_email_lower   ON users (lower(email)) WHERE email IS NOT NULL;

-- jobs（脊柱 §6.3，任务状态唯一真源 + fencing）。type 枚举为 0018 收窄后口径（批量发布已下线）。
CREATE TABLE jobs (
  id            uuid        PRIMARY KEY DEFAULT gen_uuid_v7(),
  type          text        NOT NULL,
  status        text        NOT NULL DEFAULT 'queued',
  owner_user_id uuid        NOT NULL REFERENCES users(id),
  subject_ref   jsonb,
  progress      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  result        jsonb,
  error         jsonb,
  attempt_no    int         NOT NULL DEFAULT 0,
  lease_owner   text,
  lease_until   timestamptz,
  fence_token   bigint      NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  CONSTRAINT jobs_status_chk CHECK (status IN ('queued','running','completed','failed','cancelled')),
  CONSTRAINT jobs_type_chk   CHECK (type IN ('import','extract','structure','evaluate','runtime_gen'))
);
CREATE INDEX idx_jobs_owner_status ON jobs (owner_user_id, status, created_at DESC);
CREATE INDEX idx_jobs_lease        ON jobs (status, lease_until) WHERE status = 'running';
CREATE INDEX idx_jobs_type_status  ON jobs (type, status);
-- 结构化 Job version 级硬锁（40 §4.C/§4.F，Codex P1-4）：部分唯一索引保证「每个 versionId 至多
--   一个未终态 structure job」；并发第二个 → 唯一冲突（23505）→ 回放运行中 job 或 423。
--   终态 job 不在索引内：版本可重新结构化。表达式建在 subject_ref ->> 'versionId'。
CREATE UNIQUE INDEX uq_structure_job_active_version
  ON jobs ((subject_ref ->> 'versionId'))
  WHERE type = 'structure' AND status IN ('queued', 'running');

-- idempotency_keys（脊柱 §4，Codex#4 租约 fence）
-- lease_token：每次取/夺租约生成新 token；完成更新必须匹配当前持租者（WHERE … AND lease_token=?），
--   防旧请求超时被 steal 后回来覆盖新请求的 response_ref（并发 steal 安全）。
CREATE TABLE idempotency_keys (
  scope         text        NOT NULL,
  key           text        NOT NULL,
  request_hash  text        NOT NULL,
  response_ref  jsonb,
  status        text        NOT NULL DEFAULT 'locked',
  lease_token   uuid        NOT NULL DEFAULT gen_uuid_v7(),  -- 持租 fence token（Codex#4）
  locked_at     timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key),
  CONSTRAINT idem_status_chk CHECK (status IN ('locked','completed','failed'))
);
CREATE INDEX idx_idem_expires ON idempotency_keys (expires_at) WHERE status = 'locked';

-- ===================== 导入域（20）：raw_snapshots / session_segments / import_pairings / import_uploads =====================

CREATE TABLE raw_snapshots (
  id                      uuid        PRIMARY KEY DEFAULT gen_uuid_v7(),
  owner_user_id           uuid        NOT NULL REFERENCES users(id),
  import_job_id           uuid        NOT NULL REFERENCES jobs(id),
  source                  text        NOT NULL,
  sources                 text[]      NOT NULL DEFAULT '{}',
  raw_s3_key              text,
  raw_purged_at           timestamptz,
  segment_count           int         NOT NULL DEFAULT 0,
  message_count           int         NOT NULL DEFAULT 0,
  project_count           int         NOT NULL DEFAULT 0,
  time_span_from          date,
  time_span_to            date,
  redaction_report        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  redaction_ruleset_ver   text        NOT NULL,
  superseded_by           uuid        REFERENCES raw_snapshots(id),
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_raw_snapshots_owner  ON raw_snapshots (owner_user_id, created_at DESC);
CREATE INDEX idx_raw_snapshots_job    ON raw_snapshots (import_job_id);
CREATE INDEX idx_raw_snapshots_orphan ON raw_snapshots (raw_purged_at) WHERE raw_purged_at IS NULL;

CREATE TABLE session_segments (
  id            uuid        PRIMARY KEY DEFAULT gen_uuid_v7(),
  snapshot_id   uuid        NOT NULL REFERENCES raw_snapshots(id) ON DELETE CASCADE,
  content_hash  text        NOT NULL,
  source        text        NOT NULL,
  title         text,
  date_label    text,
  happened_at   timestamptz,
  project       text,
  message_count int         NOT NULL DEFAULT 0,
  content       text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_id, content_hash),
  -- §11.E 血缘复合唯一键（供 30 域 fk_evidence_segment_snapshot 复合 FK）
  CONSTRAINT uq_session_segments_id_snapshot UNIQUE (id, snapshot_id)
);
CREATE INDEX idx_segments_snapshot      ON session_segments (snapshot_id, happened_at DESC);
CREATE INDEX idx_segments_snapshot_proj ON session_segments (snapshot_id, project);

-- import_pairings：助手配对导入。draft_id 列先建、FK 后置（§11.G，破环，见文末闭合节）。
CREATE TABLE import_pairings (
  id                uuid        PRIMARY KEY DEFAULT gen_uuid_v7(),
  owner_user_id     uuid        NOT NULL REFERENCES users(id),
  pairing_code_hash text        NOT NULL,
  phase             text        NOT NULL DEFAULT 'waiting',
  upload_id         text,
  job_id            uuid        REFERENCES jobs(id),
  uploaded_parts    int         NOT NULL DEFAULT 0,
  total_parts       int,
  -- 上传 manifest（B-21 多分片协议，Codex P1-8）：已落地分片登记表
  --   { "<partIndex>": { "key": "<s3Key>", "hash": "<contentSha256>" }, ... }。
  --   complete 阶段据「键数 = total_parts 且 0..total_parts-1 全到齐」判断传齐才建 job；rawS3Keys 取本表 key 集。
  landed_parts      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  draft_id          uuid,                                  -- 后置 FK fk_pairings_draft（§11.G）
  attempt_count     int         NOT NULL DEFAULT 0,
  max_attempts      int         NOT NULL DEFAULT 5,
  expires_at        timestamptz NOT NULL,
  used_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pairings_phase_chk CHECK (phase IN ('waiting','uploading','job_created','expired'))
);
CREATE UNIQUE INDEX uq_pairings_code_active ON import_pairings (pairing_code_hash)
  WHERE used_at IS NULL AND phase IN ('waiting', 'uploading');
CREATE INDEX idx_pairings_expire ON import_pairings (expires_at)
  WHERE phase NOT IN ('job_created', 'expired');

-- import_uploads：浏览器直传路径上传 manifest（20 §2.1/§2.2，Codex P1-r2）。
--   presign 持久化本次直传会话声明的 expected parts；POST /import/jobs 据本表校验
--   「所有 expected part 都已落桶」才建 job（与助手路径 landed_parts 同一完整性闸语义）。
CREATE TABLE import_uploads (
  id              uuid        PRIMARY KEY DEFAULT gen_uuid_v7(),
  owner_user_id   uuid        NOT NULL REFERENCES users(id),
  -- 本次直传会话 id（presign 生成、贯穿断点续传与 POST /import/jobs 引用）。同 owner 内唯一。
  upload_id       text        NOT NULL,
  source          text        NOT NULL,
  -- 声明的期望分片清单（presign 落）：
  --   { "<clientPartId>": { "s3Key": "<key>", "contentSha256": "<hash|null>" }, ... }。
  expected_parts  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  total_bytes     bigint      NOT NULL DEFAULT 0,
  -- 兑换标记：建 job 成功后置（一次性，重放回放幂等；防同一 uploadId 重复建 job 的第二道闸，Idempotency-Key 是第一道）。
  consumed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- 兑换回写的 job_id（Codex P1-r5）：consumed_at 与 job INSERT 同一事务同一语句写入，
  --   不变式 consumed_at IS NOT NULL ⇒ job_id IS NOT NULL；同 uploadId 重试恢复返回该 job 的 JobView。
  job_id          uuid        REFERENCES jobs(id)
);
-- 同 owner 内 upload_id 唯一（presign 重放同 uploadId 走 upsert 回放同一 manifest）。
CREATE UNIQUE INDEX uq_import_uploads_owner_upload ON import_uploads (owner_user_id, upload_id);

-- ===================== 提取域（30）：capability_candidates / candidate_evidence（§11.E 复合血缘键）=====================

CREATE TABLE capability_candidates (
  id              uuid        PRIMARY KEY DEFAULT gen_uuid_v7(),
  extract_job_id  uuid        NOT NULL REFERENCES jobs(id),
  snapshot_id     uuid        NOT NULL REFERENCES raw_snapshots(id),
  owner_user_id   uuid        NOT NULL REFERENCES users(id),
  status          text        NOT NULL DEFAULT 'generating',
  error           jsonb,
  retry_cnt       int         NOT NULL DEFAULT 0,
  slug            text        NOT NULL,
  name            text,
  intent          text,
  type            text,
  confidence      text,
  segment_count   int,
  frequency_ratio numeric(4,3),
  reusability     numeric(4,3),
  scope_coherence numeric(4,3),
  split_suggested boolean      NOT NULL DEFAULT false,
  scope           jsonb,
  reusability_breakdown jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_candidate_job_slug      UNIQUE (extract_job_id, slug),
  CONSTRAINT uq_candidates_id_snapshot  UNIQUE (id, snapshot_id),
  CONSTRAINT ck_candidate_status CHECK (status IN ('generating','ready','failed')),
  CONSTRAINT ck_candidate_type   CHECK (type IS NULL OR type IN ('core-workflow','recurring','occasional')),
  CONSTRAINT ck_candidate_conf   CHECK (confidence IS NULL OR confidence IN ('high','med','low'))
);
CREATE INDEX idx_candidates_job        ON capability_candidates (extract_job_id, created_at, id);
CREATE INDEX idx_candidates_owner      ON capability_candidates (owner_user_id, created_at DESC);
CREATE INDEX idx_candidates_job_status ON capability_candidates (extract_job_id, status);

CREATE TABLE candidate_evidence (
  id            uuid        PRIMARY KEY DEFAULT gen_uuid_v7(),
  candidate_id  uuid        NOT NULL,
  segment_id    uuid        NOT NULL,
  snapshot_id   uuid        NOT NULL REFERENCES raw_snapshots(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_evidence_candidate_segment UNIQUE (candidate_id, segment_id),
  -- §11.E 复合 FK（固定约束名）
  CONSTRAINT fk_evidence_candidate_snapshot
    FOREIGN KEY (candidate_id, snapshot_id)
    REFERENCES capability_candidates (id, snapshot_id) ON DELETE CASCADE,
  CONSTRAINT fk_evidence_segment_snapshot
    FOREIGN KEY (segment_id, snapshot_id)
    REFERENCES session_segments (id, snapshot_id)
);
CREATE INDEX idx_evidence_candidate ON candidate_evidence (candidate_id, created_at, id);
CREATE INDEX idx_evidence_segment   ON candidate_evidence (segment_id);

-- ===================== 结构化域（40）：drafts / capabilities / capability_versions =====================

-- drafts（脊柱 §8.4）：创作流程草稿。跨域落点 FK 后置（snapshot_id/version_id/capability_id，见文末闭合节）。
CREATE TABLE drafts (
  id              uuid        PRIMARY KEY DEFAULT gen_uuid_v7(),
  owner_user_id   uuid        NOT NULL REFERENCES users(id),
  status          text        NOT NULL DEFAULT 'active',
  current_step    text        NOT NULL DEFAULT 'import',
  step_progress   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  snapshot_id     uuid,                                  -- 后置 FK fk_drafts_snapshot
  extract_job_id  uuid        REFERENCES jobs(id),
  selection       jsonb,
  version_id      uuid,                                  -- 后置 FK fk_drafts_version
  title           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- 真实能力体血缘（Codex phase4c P1-5）：建版同事务回写真实 capability_id（与 version_id 同源），
  --   续传据它读 publication，拒绝态闭环可见。后置 FK fk_drafts_capability。
  capability_id   uuid,
  CONSTRAINT drafts_status_chk CHECK (status IN ('active','completed','abandoned')),
  CONSTRAINT drafts_step_chk   CHECK (current_step IN ('import','extract','select','structure','publish'))
);
CREATE INDEX idx_drafts_owner_active ON drafts (owner_user_id, status, updated_at DESC);

-- capabilities：能力体聚合根。current_version_id 复合 FK 后置（破建表循环，见文末闭合节）。
-- 注：embedding vector(1536) 为 P1（pgvector），本期不建以保证 stock PG 可跑；P1 启用 pgvector 后 ALTER ADD。
CREATE TABLE capabilities (
  id                 uuid        PRIMARY KEY DEFAULT gen_uuid_v7(),
  creator_user_id    uuid        NOT NULL REFERENCES users(id),
  slug               text        NOT NULL,
  current_version_id uuid,                                  -- 复合 FK 后置（fk_capabilities_current_version）
  tags               text[]      NOT NULL DEFAULT '{}',
  total_invocations  bigint,                                -- usage 占位（脊柱 §2.2）
  status             text        NOT NULL DEFAULT 'active',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_capabilities_slug UNIQUE (slug),
  CONSTRAINT ck_capabilities_status CHECK (status IN ('active','archived'))
);
CREATE INDEX idx_capabilities_creator ON capabilities (creator_user_id, created_at DESC);

-- capability_versions：版本快照（行不可变寻址）。cover_*/visibility 为发布时版本级冻结的对外卡数据
--   （50-step5-publish §1.2，Codex#r3 P1）：封面三来源 glyph（字形图标，无引用键）/ image（cover_asset_key）/
--   html_snapshot（cover_snapshot_ref）+ 可见性 public|unlisted；NULL = 未走过新发布门（投影兜 glyph/public）。
CREATE TABLE capability_versions (
  id                  uuid        PRIMARY KEY DEFAULT gen_uuid_v7(),
  capability_id       uuid        NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
  version             text        NOT NULL,
  status              text        NOT NULL DEFAULT 'draft',
  manifest            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  manifest_hash       text,
  structure_state     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  source_candidate_id uuid        REFERENCES capability_candidates(id),
  reject_reason       text,
  rejected_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  cover_source        text,         -- 发布时冻结的封面来源（glyph|image|html_snapshot）；NULL=未冻结(旧版兜 glyph)
  cover_asset_key     text,         -- source=image 的对象存储键（冻结）
  cover_snapshot_ref  text,         -- source=html_snapshot 的渲染快照引用（冻结）
  visibility          text,         -- 发布时冻结的可见性（public|unlisted）；NULL=未冻结(旧版兜 public)
  CONSTRAINT uq_capability_version UNIQUE (capability_id, version),
  -- §11.E：供下游复合 FK（current_version_id / publications / listings）
  CONSTRAINT uq_capability_versions_capability_id UNIQUE (capability_id, id),
  CONSTRAINT ck_capver_status CHECK (status IN ('draft','published','superseded','review_rejected')),
  CONSTRAINT ck_capver_cover_source
    CHECK (cover_source IS NULL OR cover_source IN ('glyph','image','html_snapshot')),
  CONSTRAINT ck_capver_visibility
    CHECK (visibility IS NULL OR visibility IN ('public','unlisted'))
);
CREATE INDEX idx_capver_capability       ON capability_versions (capability_id, created_at DESC);
CREATE INDEX idx_capver_status           ON capability_versions (status);
CREATE INDEX idx_capver_source_candidate ON capability_versions (source_candidate_id);

-- ===================== 发布域（50）：publications / marketplace_listings + slug 同步触发器（§11.E 复合 FK）=====================

CREATE TABLE publications (
  id                 uuid        PRIMARY KEY DEFAULT gen_uuid_v7(),
  capability_id      uuid        NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
  current_version_id uuid        NOT NULL,
  share_token        text        NOT NULL,
  visibility         text        NOT NULL DEFAULT 'public',
  review_status      text        NOT NULL DEFAULT 'alpha_pending',
  reject_reason      text,
  reviewed_at        timestamptz,
  published_at       timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (capability_id),
  UNIQUE (share_token),
  CHECK (visibility IN ('public','unlisted')),
  CHECK (review_status IN ('alpha_pending','published','review_rejected')),
  CONSTRAINT fk_publications_capability_version
    FOREIGN KEY (capability_id, current_version_id)
    REFERENCES capability_versions (capability_id, id)
);
CREATE INDEX idx_pub_review_status   ON publications (review_status);
CREATE INDEX idx_pub_current_version ON publications (current_version_id);

-- 注：marketplace_listings.slug gin_trgm_ops 索引为 P1（需 pg_trgm），本期用普通 btree 以保证 stock PG 可跑。
CREATE TABLE marketplace_listings (
  capability_id  uuid        PRIMARY KEY REFERENCES capabilities(id) ON DELETE CASCADE,
  version_id     uuid        NOT NULL,
  slug           text        NOT NULL,
  card           jsonb       NOT NULL,
  search_tsv     tsvector,
  status         text        NOT NULL DEFAULT 'alpha_pending',
  listed_at      timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('alpha_pending','published','unlisted','delisted')),
  CONSTRAINT uq_listings_slug UNIQUE (slug),
  CONSTRAINT fk_listings_capability_version
    FOREIGN KEY (capability_id, version_id)
    REFERENCES capability_versions (capability_id, id)
);
CREATE INDEX idx_listings_search ON marketplace_listings USING GIN (search_tsv);
CREATE INDEX idx_listings_slug   ON marketplace_listings (slug); -- P1 换 gin_trgm_ops（pg_trgm 模糊）
CREATE INDEX idx_listings_status ON marketplace_listings (status) WHERE status IN ('alpha_pending','published');

-- 上架行 slug 与 capabilities.slug 强一致（触发器同步，防手写漂移）。
CREATE OR REPLACE FUNCTION enforce_listing_slug() RETURNS trigger AS $$
BEGIN
  SELECT slug INTO NEW.slug FROM capabilities WHERE id = NEW.capability_id;
  IF NEW.slug IS NULL THEN
    RAISE EXCEPTION 'capability % has no slug', NEW.capability_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_listing_slug
  BEFORE INSERT OR UPDATE OF capability_id ON marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION enforce_listing_slug();

-- ===================== 社交与主页域（60）：creator_profiles / follows / likes =====================

CREATE TABLE creator_profiles (
  user_id         uuid        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  slug            text        NOT NULL UNIQUE,
  display_name    text        NOT NULL,
  avatar_url      text,
  identity_tags   text[]      NOT NULL DEFAULT '{}',
  bio             text        NOT NULL DEFAULT '',
  heatmap_enabled boolean     NOT NULL DEFAULT true,
  followers_count integer     NOT NULL DEFAULT 0 CHECK (followers_count >= 0),
  following_count integer     NOT NULL DEFAULT 0 CHECK (following_count >= 0),
  likes_count     integer     NOT NULL DEFAULT 0 CHECK (likes_count >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_creator_profiles_slug ON creator_profiles (slug);

CREATE TABLE follows (
  follower_id  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX idx_follows_followee ON follows (followee_id);
CREATE INDEX idx_follows_follower ON follows (follower_id);

CREATE TABLE likes (
  user_id        uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability_id  uuid        NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, capability_id)
);
CREATE INDEX idx_likes_capability ON likes (capability_id);
CREATE INDEX idx_likes_user       ON likes (user_id);

-- ===================== 事件与基础设施域（70）：outbox / cursors / dead / notifications / 渠道 / LLM 审计 =====================

CREATE TABLE outbox_events (
  id            uuid        PRIMARY KEY DEFAULT gen_uuid_v7(),
  seq           bigint      GENERATED ALWAYS AS IDENTITY,
  event_id      text        NOT NULL,
  topic         text        NOT NULL,
  aggregate_id  uuid        NOT NULL,
  payload       jsonb       NOT NULL,
  trace_id      text,
  xid           xid8        NOT NULL DEFAULT pg_current_xact_id(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_outbox_event_id UNIQUE (event_id)
);
CREATE INDEX idx_outbox_seq       ON outbox_events (seq);
CREATE INDEX idx_outbox_topic_seq ON outbox_events (topic, seq);
CREATE INDEX idx_outbox_xid       ON outbox_events (xid);
CREATE INDEX idx_outbox_created   ON outbox_events (created_at);

-- consumer_cursors：多 topic 版（PK = (consumer_name, topic)，70 §3.4）
CREATE TABLE consumer_cursors (
  consumer_name text        NOT NULL,
  topic         text        NOT NULL,
  last_seq      bigint      NOT NULL DEFAULT 0,
  last_event_id text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_name, topic)
);

CREATE TABLE dead_events (
  id            uuid        PRIMARY KEY DEFAULT gen_uuid_v7(),
  consumer_name text        NOT NULL,
  topic         text        NOT NULL,
  event_id      text        NOT NULL,
  outbox_seq    bigint      NOT NULL,
  payload       jsonb       NOT NULL,
  last_error    jsonb,
  attempts      int         NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  status        text        NOT NULL DEFAULT 'dead',
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  CONSTRAINT fk_dead_events_event FOREIGN KEY (event_id) REFERENCES outbox_events (event_id),
  CONSTRAINT uq_dead_event UNIQUE (consumer_name, event_id),
  CONSTRAINT ck_dead_status   CHECK (status IN ('dead', 'retrying', 'resolved')),
  CONSTRAINT ck_dead_attempts CHECK (attempts >= 0)
);
CREATE INDEX idx_dead_unresolved ON dead_events (status, next_retry_at) WHERE status <> 'resolved';
CREATE INDEX idx_dead_topic      ON dead_events (topic, status);

CREATE TABLE notifications (
  id            uuid        PRIMARY KEY DEFAULT gen_uuid_v7(),
  recipient_id  uuid        NOT NULL REFERENCES users(id),
  kind          text        NOT NULL,
  title         text        NOT NULL,
  body          text,
  link          text,
  dedupe_key    text        NOT NULL,
  read_at       timestamptz,
  trace_id      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_notif_dedupe UNIQUE (recipient_id, dedupe_key)
);
CREATE INDEX idx_notif_recipient_unread ON notifications (recipient_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX idx_notif_recipient_all    ON notifications (recipient_id, created_at DESC);

-- notification_channels：投递渠道（0018 收敛后代码只写 inapp；email/lark 无投递实现）。
CREATE TABLE notification_channels (
  id              uuid        PRIMARY KEY DEFAULT gen_uuid_v7(),
  notification_id uuid        NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel         text        NOT NULL,
  status          text        NOT NULL DEFAULT 'pending',
  attempts        int         NOT NULL DEFAULT 0,
  last_error      jsonb,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_notif_channel UNIQUE (notification_id, channel)
);
CREATE INDEX idx_notif_channel_pending ON notification_channels (status, created_at) WHERE status = 'pending';

-- B-06 · LLM 成本审计（非计费真源）
CREATE TABLE audit_llm_calls (
  id            uuid        PRIMARY KEY DEFAULT gen_uuid_v7(),
  owner_user_id uuid        REFERENCES users(id),
  anon_key      text,
  task_class    text        NOT NULL,
  job_id        uuid        REFERENCES jobs(id),
  model         text,
  prompt_tokens int         NOT NULL DEFAULT 0,
  completion_tokens int     NOT NULL DEFAULT 0,
  cost_micros   bigint      NOT NULL DEFAULT 0,
  degraded      boolean     NOT NULL DEFAULT false,
  retries       int         NOT NULL DEFAULT 0,
  trace_id      text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_llm_owner_day ON audit_llm_calls (owner_user_id, created_at);
CREATE INDEX idx_audit_llm_job       ON audit_llm_calls (job_id);

-- ===================== 试用端 runtime：rt_chat_* 六张表（类 Claude Artifacts 的对话 runtime，MVP 消费链路）=====================
-- 归属：apps/runtime 自有读写，authoring 不碰；与 authoring 只在能力包契约 + capability.published 事件相遇。
-- owner_id 为匿名 cookie 身份（MVP）。transcript：pi AgentMessage[] 原始转录（rehydrate agent）；
-- rt_chat_messages：UI 形态消息（渲染对话流）。

CREATE TABLE rt_chat_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      text NOT NULL,
  capability_id uuid NOT NULL,
  slug          text NOT NULL,
  version       text NOT NULL,
  title         text NOT NULL DEFAULT '新会话',
  instructions  text NOT NULL,                    -- 冻结的系统提示词快照（注入 pi）
  manifest_hash text NOT NULL,                    -- 开会话时冻结，载入校验
  public_view   jsonb NOT NULL,                   -- PublicCapabilityView 快照
  transcript    jsonb NOT NULL DEFAULT '[]'::jsonb, -- pi AgentMessage[] 原始转录
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- 会话模式：consume=消费已发布能力；trial=创作端试用（0016 加）。
  mode          text NOT NULL DEFAULT 'consume' CHECK (mode IN ('consume', 'trial'))
);
CREATE INDEX idx_rt_chat_sessions_owner    ON rt_chat_sessions (owner_id, updated_at DESC);
CREATE INDEX idx_rt_chat_sessions_cap      ON rt_chat_sessions (capability_id);
CREATE INDEX idx_rt_chat_sessions_owner_mode ON rt_chat_sessions (owner_id, mode, updated_at DESC);
CREATE INDEX idx_rt_chat_sessions_cap_mode   ON rt_chat_sessions (capability_id, mode, updated_at DESC);

CREATE TABLE rt_chat_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES rt_chat_sessions (id) ON DELETE CASCADE,
  seq        integer NOT NULL,
  role       text NOT NULL CHECK (role IN ('user', 'assistant')),
  text       text NOT NULL DEFAULT '',
  artifacts  jsonb NOT NULL DEFAULT '[]'::jsonb,  -- ArtifactRef[]
  created_at timestamptz NOT NULL DEFAULT now(),
  run_id     uuid,                                -- 产出本消息的 Run（软引用，无 FK；0016 加）
  steps      jsonb NOT NULL DEFAULT '[]'::jsonb,  -- 生成过程步骤（0016 加）
  CONSTRAINT uq_rt_chat_messages_seq UNIQUE (session_id, seq)
);
CREATE INDEX idx_rt_chat_messages_session ON rt_chat_messages (session_id, seq);
CREATE INDEX idx_rt_chat_messages_run     ON rt_chat_messages (run_id);

CREATE TABLE rt_chat_artifacts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid NOT NULL REFERENCES rt_chat_sessions (id) ON DELETE CASCADE,
  artifact_key   text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('html', 'markdown', 'code', 'structured')),
  title          text NOT NULL,
  latest_version integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_rt_chat_artifacts_key UNIQUE (session_id, artifact_key)
);
CREATE INDEX idx_rt_chat_artifacts_session ON rt_chat_artifacts (session_id);

CREATE TABLE rt_chat_artifact_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES rt_chat_artifacts (id) ON DELETE CASCADE,
  version     integer NOT NULL,
  kind        text NOT NULL,
  title       text NOT NULL,
  language    text,
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_rt_chat_artifact_versions UNIQUE (artifact_id, version)
);
CREATE INDEX idx_rt_chat_artifact_versions_artifact ON rt_chat_artifact_versions (artifact_id, version);

-- rt_chat_runs / rt_chat_run_events：显式 Run 资源与可恢复事件流（0016）。
CREATE TABLE rt_chat_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL REFERENCES rt_chat_sessions (id) ON DELETE CASCADE,
  owner_id     text NOT NULL,
  status       text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'interrupted', 'failed', 'completed')),
  input        jsonb NOT NULL DEFAULT '{}'::jsonb,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX idx_rt_chat_runs_session ON rt_chat_runs (session_id, created_at DESC);
CREATE INDEX idx_rt_chat_runs_owner   ON rt_chat_runs (owner_id, created_at DESC);

CREATE TABLE rt_chat_run_events (
  id         bigserial PRIMARY KEY,
  run_id     uuid NOT NULL REFERENCES rt_chat_runs (id) ON DELETE CASCADE,
  event      jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rt_chat_run_events_run_id ON rt_chat_run_events (run_id, id);

-- ===================== 跨域外键后置闭合（脊柱 §11.G）：全部基表建完后统一执行；约束名固定 =====================
-- 破「drafts ↔ 导入/结构化/发布域」建表顺序环（drafts 指向 raw_snapshots/capability_versions/capabilities，
-- import_pairings 反向指回 drafts；capabilities ↔ capability_versions 互指）。

-- drafts 落点跨域 FK + import_pairings 反向 FK
ALTER TABLE drafts
  ADD CONSTRAINT fk_drafts_snapshot   FOREIGN KEY (snapshot_id)   REFERENCES raw_snapshots(id),
  ADD CONSTRAINT fk_drafts_version    FOREIGN KEY (version_id)    REFERENCES capability_versions(id),
  ADD CONSTRAINT fk_drafts_capability FOREIGN KEY (capability_id) REFERENCES capabilities(id);

ALTER TABLE import_pairings
  ADD CONSTRAINT fk_pairings_draft FOREIGN KEY (draft_id) REFERENCES drafts(id);

-- capabilities.current_version_id 复合 FK（§11.E，破建表循环）
ALTER TABLE capabilities
  ADD CONSTRAINT fk_capabilities_current_version
  FOREIGN KEY (id, current_version_id) REFERENCES capability_versions (capability_id, id);
