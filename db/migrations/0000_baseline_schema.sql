-- 0000 · 基线 schema（2026-07-04 合并自原 0000-0018 共 19 个迁移文件）。
--   由生产库 pg_dump --schema-only 生成，是当时全部 29 张业务表的完整现状（含函数/索引/触发器/外键）。
--   合并原因（Daniel 决策）：迁移历史只增不减会让 db/ 越堆越大，历史推理成本高于价值；
--     表结构的演进背景查 git 历史或飞书文档「Agora 数据库活跃表说明」。
--   规则：今后 schema 变更仍新增迁移文件（编号从 0001 起）；历史再度堆积时可再次合并基线。
--   基线切换时旧库的 schema_migrations 已重置为只含本文件（见 scripts/migrate.ts 头注释）。

-- EXTENSION: pgcrypto

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- COMMENT: EXTENSION pgcrypto

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';

-- FUNCTION: enforce_listing_slug()

CREATE FUNCTION public.enforce_listing_slug() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  SELECT slug INTO NEW.slug FROM capabilities WHERE id = NEW.capability_id;
  IF NEW.slug IS NULL THEN
    RAISE EXCEPTION 'capability % has no slug', NEW.capability_id;
  END IF;
  RETURN NEW;
END;
$$;

-- FUNCTION: gen_uuid_v7()

CREATE FUNCTION public.gen_uuid_v7() RETURNS uuid
    LANGUAGE plpgsql
    AS $$
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
$$;

-- TABLE: audit_llm_calls

CREATE TABLE public.audit_llm_calls (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    owner_user_id uuid,
    anon_key text,
    task_class text NOT NULL,
    job_id uuid,
    model text,
    prompt_tokens integer DEFAULT 0 NOT NULL,
    completion_tokens integer DEFAULT 0 NOT NULL,
    cost_micros bigint DEFAULT 0 NOT NULL,
    degraded boolean DEFAULT false NOT NULL,
    retries integer DEFAULT 0 NOT NULL,
    trace_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- TABLE: candidate_evidence

CREATE TABLE public.candidate_evidence (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    candidate_id uuid NOT NULL,
    segment_id uuid NOT NULL,
    snapshot_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- TABLE: capabilities

CREATE TABLE public.capabilities (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    creator_user_id uuid NOT NULL,
    slug text NOT NULL,
    current_version_id uuid,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    total_invocations bigint,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_capabilities_status CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);

-- TABLE: capability_candidates

CREATE TABLE public.capability_candidates (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    extract_job_id uuid NOT NULL,
    snapshot_id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    status text DEFAULT 'generating'::text NOT NULL,
    error jsonb,
    retry_cnt integer DEFAULT 0 NOT NULL,
    slug text NOT NULL,
    name text,
    intent text,
    type text,
    confidence text,
    segment_count integer,
    frequency_ratio numeric(4,3),
    reusability numeric(4,3),
    scope_coherence numeric(4,3),
    split_suggested boolean DEFAULT false NOT NULL,
    scope jsonb,
    reusability_breakdown jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_candidate_conf CHECK (((confidence IS NULL) OR (confidence = ANY (ARRAY['high'::text, 'med'::text, 'low'::text])))),
    CONSTRAINT ck_candidate_status CHECK ((status = ANY (ARRAY['generating'::text, 'ready'::text, 'failed'::text]))),
    CONSTRAINT ck_candidate_type CHECK (((type IS NULL) OR (type = ANY (ARRAY['core-workflow'::text, 'recurring'::text, 'occasional'::text]))))
);

-- TABLE: capability_versions

CREATE TABLE public.capability_versions (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    capability_id uuid NOT NULL,
    version text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    manifest jsonb DEFAULT '{}'::jsonb NOT NULL,
    manifest_hash text,
    structure_state jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_candidate_id uuid,
    reject_reason text,
    rejected_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    cover_source text,
    cover_asset_key text,
    cover_snapshot_ref text,
    visibility text,
    CONSTRAINT ck_capver_cover_source CHECK (((cover_source IS NULL) OR (cover_source = ANY (ARRAY['glyph'::text, 'image'::text, 'html_snapshot'::text])))),
    CONSTRAINT ck_capver_status CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'superseded'::text, 'review_rejected'::text]))),
    CONSTRAINT ck_capver_visibility CHECK (((visibility IS NULL) OR (visibility = ANY (ARRAY['public'::text, 'unlisted'::text]))))
);

-- TABLE: consumer_cursors

CREATE TABLE public.consumer_cursors (
    consumer_name text NOT NULL,
    topic text NOT NULL,
    last_seq bigint DEFAULT 0 NOT NULL,
    last_event_id text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- TABLE: creator_profiles

CREATE TABLE public.creator_profiles (
    user_id uuid NOT NULL,
    slug text NOT NULL,
    display_name text NOT NULL,
    avatar_url text,
    identity_tags text[] DEFAULT '{}'::text[] NOT NULL,
    bio text DEFAULT ''::text NOT NULL,
    heatmap_enabled boolean DEFAULT true NOT NULL,
    followers_count integer DEFAULT 0 NOT NULL,
    following_count integer DEFAULT 0 NOT NULL,
    likes_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT creator_profiles_followers_count_check CHECK ((followers_count >= 0)),
    CONSTRAINT creator_profiles_following_count_check CHECK ((following_count >= 0)),
    CONSTRAINT creator_profiles_likes_count_check CHECK ((likes_count >= 0))
);

-- TABLE: dead_events

CREATE TABLE public.dead_events (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    consumer_name text NOT NULL,
    topic text NOT NULL,
    event_id text NOT NULL,
    outbox_seq bigint NOT NULL,
    payload jsonb NOT NULL,
    last_error jsonb,
    attempts integer DEFAULT 0 NOT NULL,
    next_retry_at timestamp with time zone,
    status text DEFAULT 'dead'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT ck_dead_attempts CHECK ((attempts >= 0)),
    CONSTRAINT ck_dead_status CHECK ((status = ANY (ARRAY['dead'::text, 'retrying'::text, 'resolved'::text])))
);

-- TABLE: drafts

CREATE TABLE public.drafts (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    owner_user_id uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    current_step text DEFAULT 'import'::text NOT NULL,
    step_progress jsonb DEFAULT '{}'::jsonb NOT NULL,
    snapshot_id uuid,
    extract_job_id uuid,
    selection jsonb,
    version_id uuid,
    title text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    capability_id uuid,
    CONSTRAINT drafts_status_chk CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'abandoned'::text]))),
    CONSTRAINT drafts_step_chk CHECK ((current_step = ANY (ARRAY['import'::text, 'extract'::text, 'select'::text, 'structure'::text, 'publish'::text])))
);

-- TABLE: follows

CREATE TABLE public.follows (
    follower_id uuid NOT NULL,
    followee_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT follows_check CHECK ((follower_id <> followee_id))
);

-- TABLE: idempotency_keys

CREATE TABLE public.idempotency_keys (
    scope text NOT NULL,
    key text NOT NULL,
    request_hash text NOT NULL,
    response_ref jsonb,
    status text DEFAULT 'locked'::text NOT NULL,
    lease_token uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    locked_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT idem_status_chk CHECK ((status = ANY (ARRAY['locked'::text, 'completed'::text, 'failed'::text])))
);

-- TABLE: import_pairings

CREATE TABLE public.import_pairings (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    owner_user_id uuid NOT NULL,
    pairing_code_hash text NOT NULL,
    phase text DEFAULT 'waiting'::text NOT NULL,
    upload_id text,
    job_id uuid,
    uploaded_parts integer DEFAULT 0 NOT NULL,
    total_parts integer,
    landed_parts jsonb DEFAULT '{}'::jsonb NOT NULL,
    draft_id uuid,
    attempt_count integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pairings_phase_chk CHECK ((phase = ANY (ARRAY['waiting'::text, 'uploading'::text, 'job_created'::text, 'expired'::text])))
);

-- TABLE: import_uploads

CREATE TABLE public.import_uploads (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    owner_user_id uuid NOT NULL,
    upload_id text NOT NULL,
    source text NOT NULL,
    expected_parts jsonb DEFAULT '{}'::jsonb NOT NULL,
    total_bytes bigint DEFAULT 0 NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    job_id uuid
);

-- TABLE: jobs

CREATE TABLE public.jobs (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    type text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    owner_user_id uuid NOT NULL,
    subject_ref jsonb,
    progress jsonb DEFAULT '{}'::jsonb NOT NULL,
    result jsonb,
    error jsonb,
    attempt_no integer DEFAULT 0 NOT NULL,
    lease_owner text,
    lease_until timestamp with time zone,
    fence_token bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT jobs_status_chk CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text]))),
    CONSTRAINT jobs_type_chk CHECK ((type = ANY (ARRAY['import'::text, 'extract'::text, 'structure'::text, 'evaluate'::text, 'runtime_gen'::text])))
);

-- TABLE: likes

CREATE TABLE public.likes (
    user_id uuid NOT NULL,
    capability_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- TABLE: marketplace_listings

CREATE TABLE public.marketplace_listings (
    capability_id uuid NOT NULL,
    version_id uuid NOT NULL,
    slug text NOT NULL,
    card jsonb NOT NULL,
    search_tsv tsvector,
    status text DEFAULT 'alpha_pending'::text NOT NULL,
    listed_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT marketplace_listings_status_check CHECK ((status = ANY (ARRAY['alpha_pending'::text, 'published'::text, 'unlisted'::text, 'delisted'::text])))
);

-- TABLE: notification_channels

CREATE TABLE public.notification_channels (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    notification_id uuid NOT NULL,
    channel text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error jsonb,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- TABLE: notifications

CREATE TABLE public.notifications (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    recipient_id uuid NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    body text,
    link text,
    dedupe_key text NOT NULL,
    read_at timestamp with time zone,
    trace_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- TABLE: outbox_events

CREATE TABLE public.outbox_events (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    seq bigint NOT NULL,
    event_id text NOT NULL,
    topic text NOT NULL,
    aggregate_id uuid NOT NULL,
    payload jsonb NOT NULL,
    trace_id text,
    xid xid8 DEFAULT pg_current_xact_id() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- SEQUENCE: outbox_events_seq_seq

ALTER TABLE public.outbox_events ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.outbox_events_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

-- TABLE: publications

CREATE TABLE public.publications (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    capability_id uuid NOT NULL,
    current_version_id uuid NOT NULL,
    share_token text NOT NULL,
    visibility text DEFAULT 'public'::text NOT NULL,
    review_status text DEFAULT 'alpha_pending'::text NOT NULL,
    reject_reason text,
    reviewed_at timestamp with time zone,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT publications_review_status_check CHECK ((review_status = ANY (ARRAY['alpha_pending'::text, 'published'::text, 'review_rejected'::text]))),
    CONSTRAINT publications_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'unlisted'::text])))
);

-- TABLE: raw_snapshots

CREATE TABLE public.raw_snapshots (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    owner_user_id uuid NOT NULL,
    import_job_id uuid NOT NULL,
    source text NOT NULL,
    sources text[] DEFAULT '{}'::text[] NOT NULL,
    raw_s3_key text,
    raw_purged_at timestamp with time zone,
    segment_count integer DEFAULT 0 NOT NULL,
    message_count integer DEFAULT 0 NOT NULL,
    project_count integer DEFAULT 0 NOT NULL,
    time_span_from date,
    time_span_to date,
    redaction_report jsonb DEFAULT '{}'::jsonb NOT NULL,
    redaction_ruleset_ver text NOT NULL,
    superseded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- TABLE: rt_chat_artifact_versions

CREATE TABLE public.rt_chat_artifact_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    artifact_id uuid NOT NULL,
    version integer NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    language text,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- TABLE: rt_chat_artifacts

CREATE TABLE public.rt_chat_artifacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    artifact_key text NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    latest_version integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rt_chat_artifacts_kind_check CHECK ((kind = ANY (ARRAY['html'::text, 'markdown'::text, 'code'::text, 'structured'::text])))
);

-- TABLE: rt_chat_messages

CREATE TABLE public.rt_chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    seq integer NOT NULL,
    role text NOT NULL,
    text text DEFAULT ''::text NOT NULL,
    artifacts jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    run_id uuid,
    steps jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT rt_chat_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])))
);

-- TABLE: rt_chat_run_events

CREATE TABLE public.rt_chat_run_events (
    id bigint NOT NULL,
    run_id uuid NOT NULL,
    event jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- SEQUENCE: rt_chat_run_events_id_seq

CREATE SEQUENCE public.rt_chat_run_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- SEQUENCE OWNED BY: rt_chat_run_events_id_seq

ALTER SEQUENCE public.rt_chat_run_events_id_seq OWNED BY public.rt_chat_run_events.id;

-- TABLE: rt_chat_runs

CREATE TABLE public.rt_chat_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    owner_id text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    input jsonb DEFAULT '{}'::jsonb NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT rt_chat_runs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'interrupted'::text, 'failed'::text, 'completed'::text])))
);

-- TABLE: rt_chat_sessions

CREATE TABLE public.rt_chat_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id text NOT NULL,
    capability_id uuid NOT NULL,
    slug text NOT NULL,
    version text NOT NULL,
    title text DEFAULT '新会话'::text NOT NULL,
    instructions text NOT NULL,
    manifest_hash text NOT NULL,
    public_view jsonb NOT NULL,
    transcript jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    mode text DEFAULT 'consume'::text NOT NULL,
    CONSTRAINT rt_chat_sessions_mode_check CHECK ((mode = ANY (ARRAY['consume'::text, 'trial'::text]))),
    CONSTRAINT rt_chat_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);

-- TABLE: session_segments

CREATE TABLE public.session_segments (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    snapshot_id uuid NOT NULL,
    content_hash text NOT NULL,
    source text NOT NULL,
    title text,
    date_label text,
    happened_at timestamp with time zone,
    project text,
    message_count integer DEFAULT 0 NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- TABLE: users

CREATE TABLE public.users (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    logto_user_id text NOT NULL,
    account text NOT NULL,
    email text,
    roles text[] DEFAULT '{creator}'::text[] NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_roles_chk CHECK ((roles <@ ARRAY['creator'::text, 'consumer'::text, 'reviewer'::text])),
    CONSTRAINT users_status_chk CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text])))
);

-- DEFAULT: rt_chat_run_events id

ALTER TABLE ONLY public.rt_chat_run_events ALTER COLUMN id SET DEFAULT nextval('public.rt_chat_run_events_id_seq'::regclass);

-- CONSTRAINT: audit_llm_calls audit_llm_calls_pkey

ALTER TABLE ONLY public.audit_llm_calls
    ADD CONSTRAINT audit_llm_calls_pkey PRIMARY KEY (id);

-- CONSTRAINT: candidate_evidence candidate_evidence_pkey

ALTER TABLE ONLY public.candidate_evidence
    ADD CONSTRAINT candidate_evidence_pkey PRIMARY KEY (id);

-- CONSTRAINT: capabilities capabilities_pkey

ALTER TABLE ONLY public.capabilities
    ADD CONSTRAINT capabilities_pkey PRIMARY KEY (id);

-- CONSTRAINT: capability_candidates capability_candidates_pkey

ALTER TABLE ONLY public.capability_candidates
    ADD CONSTRAINT capability_candidates_pkey PRIMARY KEY (id);

-- CONSTRAINT: capability_versions capability_versions_pkey

ALTER TABLE ONLY public.capability_versions
    ADD CONSTRAINT capability_versions_pkey PRIMARY KEY (id);

-- CONSTRAINT: consumer_cursors consumer_cursors_pkey

ALTER TABLE ONLY public.consumer_cursors
    ADD CONSTRAINT consumer_cursors_pkey PRIMARY KEY (consumer_name, topic);

-- CONSTRAINT: creator_profiles creator_profiles_pkey

ALTER TABLE ONLY public.creator_profiles
    ADD CONSTRAINT creator_profiles_pkey PRIMARY KEY (user_id);

-- CONSTRAINT: creator_profiles creator_profiles_slug_key

ALTER TABLE ONLY public.creator_profiles
    ADD CONSTRAINT creator_profiles_slug_key UNIQUE (slug);

-- CONSTRAINT: dead_events dead_events_pkey

ALTER TABLE ONLY public.dead_events
    ADD CONSTRAINT dead_events_pkey PRIMARY KEY (id);

-- CONSTRAINT: drafts drafts_pkey

ALTER TABLE ONLY public.drafts
    ADD CONSTRAINT drafts_pkey PRIMARY KEY (id);

-- CONSTRAINT: follows follows_pkey

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_pkey PRIMARY KEY (follower_id, followee_id);

-- CONSTRAINT: idempotency_keys idempotency_keys_pkey

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY (scope, key);

-- CONSTRAINT: import_pairings import_pairings_pkey

ALTER TABLE ONLY public.import_pairings
    ADD CONSTRAINT import_pairings_pkey PRIMARY KEY (id);

-- CONSTRAINT: import_uploads import_uploads_pkey

ALTER TABLE ONLY public.import_uploads
    ADD CONSTRAINT import_uploads_pkey PRIMARY KEY (id);

-- CONSTRAINT: jobs jobs_pkey

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);

-- CONSTRAINT: likes likes_pkey

ALTER TABLE ONLY public.likes
    ADD CONSTRAINT likes_pkey PRIMARY KEY (user_id, capability_id);

-- CONSTRAINT: marketplace_listings marketplace_listings_pkey

ALTER TABLE ONLY public.marketplace_listings
    ADD CONSTRAINT marketplace_listings_pkey PRIMARY KEY (capability_id);

-- CONSTRAINT: notification_channels notification_channels_pkey

ALTER TABLE ONLY public.notification_channels
    ADD CONSTRAINT notification_channels_pkey PRIMARY KEY (id);

-- CONSTRAINT: notifications notifications_pkey

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

-- CONSTRAINT: outbox_events outbox_events_pkey

ALTER TABLE ONLY public.outbox_events
    ADD CONSTRAINT outbox_events_pkey PRIMARY KEY (id);

-- CONSTRAINT: publications publications_capability_id_key

ALTER TABLE ONLY public.publications
    ADD CONSTRAINT publications_capability_id_key UNIQUE (capability_id);

-- CONSTRAINT: publications publications_pkey

ALTER TABLE ONLY public.publications
    ADD CONSTRAINT publications_pkey PRIMARY KEY (id);

-- CONSTRAINT: publications publications_share_token_key

ALTER TABLE ONLY public.publications
    ADD CONSTRAINT publications_share_token_key UNIQUE (share_token);

-- CONSTRAINT: raw_snapshots raw_snapshots_pkey

ALTER TABLE ONLY public.raw_snapshots
    ADD CONSTRAINT raw_snapshots_pkey PRIMARY KEY (id);

-- CONSTRAINT: rt_chat_artifact_versions rt_chat_artifact_versions_pkey

ALTER TABLE ONLY public.rt_chat_artifact_versions
    ADD CONSTRAINT rt_chat_artifact_versions_pkey PRIMARY KEY (id);

-- CONSTRAINT: rt_chat_artifacts rt_chat_artifacts_pkey

ALTER TABLE ONLY public.rt_chat_artifacts
    ADD CONSTRAINT rt_chat_artifacts_pkey PRIMARY KEY (id);

-- CONSTRAINT: rt_chat_messages rt_chat_messages_pkey

ALTER TABLE ONLY public.rt_chat_messages
    ADD CONSTRAINT rt_chat_messages_pkey PRIMARY KEY (id);

-- CONSTRAINT: rt_chat_run_events rt_chat_run_events_pkey

ALTER TABLE ONLY public.rt_chat_run_events
    ADD CONSTRAINT rt_chat_run_events_pkey PRIMARY KEY (id);

-- CONSTRAINT: rt_chat_runs rt_chat_runs_pkey

ALTER TABLE ONLY public.rt_chat_runs
    ADD CONSTRAINT rt_chat_runs_pkey PRIMARY KEY (id);

-- CONSTRAINT: rt_chat_sessions rt_chat_sessions_pkey

ALTER TABLE ONLY public.rt_chat_sessions
    ADD CONSTRAINT rt_chat_sessions_pkey PRIMARY KEY (id);

-- CONSTRAINT: session_segments session_segments_pkey

ALTER TABLE ONLY public.session_segments
    ADD CONSTRAINT session_segments_pkey PRIMARY KEY (id);

-- CONSTRAINT: session_segments session_segments_snapshot_id_content_hash_key

ALTER TABLE ONLY public.session_segments
    ADD CONSTRAINT session_segments_snapshot_id_content_hash_key UNIQUE (snapshot_id, content_hash);

-- CONSTRAINT: capability_candidates uq_candidate_job_slug

ALTER TABLE ONLY public.capability_candidates
    ADD CONSTRAINT uq_candidate_job_slug UNIQUE (extract_job_id, slug);

-- CONSTRAINT: capability_candidates uq_candidates_id_snapshot

ALTER TABLE ONLY public.capability_candidates
    ADD CONSTRAINT uq_candidates_id_snapshot UNIQUE (id, snapshot_id);

-- CONSTRAINT: capabilities uq_capabilities_slug

ALTER TABLE ONLY public.capabilities
    ADD CONSTRAINT uq_capabilities_slug UNIQUE (slug);

-- CONSTRAINT: capability_versions uq_capability_version

ALTER TABLE ONLY public.capability_versions
    ADD CONSTRAINT uq_capability_version UNIQUE (capability_id, version);

-- CONSTRAINT: capability_versions uq_capability_versions_capability_id

ALTER TABLE ONLY public.capability_versions
    ADD CONSTRAINT uq_capability_versions_capability_id UNIQUE (capability_id, id);

-- CONSTRAINT: dead_events uq_dead_event

ALTER TABLE ONLY public.dead_events
    ADD CONSTRAINT uq_dead_event UNIQUE (consumer_name, event_id);

-- CONSTRAINT: candidate_evidence uq_evidence_candidate_segment

ALTER TABLE ONLY public.candidate_evidence
    ADD CONSTRAINT uq_evidence_candidate_segment UNIQUE (candidate_id, segment_id);

-- CONSTRAINT: marketplace_listings uq_listings_slug

ALTER TABLE ONLY public.marketplace_listings
    ADD CONSTRAINT uq_listings_slug UNIQUE (slug);

-- CONSTRAINT: notification_channels uq_notif_channel

ALTER TABLE ONLY public.notification_channels
    ADD CONSTRAINT uq_notif_channel UNIQUE (notification_id, channel);

-- CONSTRAINT: notifications uq_notif_dedupe

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT uq_notif_dedupe UNIQUE (recipient_id, dedupe_key);

-- CONSTRAINT: outbox_events uq_outbox_event_id

ALTER TABLE ONLY public.outbox_events
    ADD CONSTRAINT uq_outbox_event_id UNIQUE (event_id);

-- CONSTRAINT: rt_chat_artifact_versions uq_rt_chat_artifact_versions

ALTER TABLE ONLY public.rt_chat_artifact_versions
    ADD CONSTRAINT uq_rt_chat_artifact_versions UNIQUE (artifact_id, version);

-- CONSTRAINT: rt_chat_artifacts uq_rt_chat_artifacts_key

ALTER TABLE ONLY public.rt_chat_artifacts
    ADD CONSTRAINT uq_rt_chat_artifacts_key UNIQUE (session_id, artifact_key);

-- CONSTRAINT: rt_chat_messages uq_rt_chat_messages_seq

ALTER TABLE ONLY public.rt_chat_messages
    ADD CONSTRAINT uq_rt_chat_messages_seq UNIQUE (session_id, seq);

-- CONSTRAINT: session_segments uq_session_segments_id_snapshot

ALTER TABLE ONLY public.session_segments
    ADD CONSTRAINT uq_session_segments_id_snapshot UNIQUE (id, snapshot_id);

-- CONSTRAINT: users users_pkey

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

-- INDEX: idx_audit_llm_job

CREATE INDEX idx_audit_llm_job ON public.audit_llm_calls USING btree (job_id);

-- INDEX: idx_audit_llm_owner_day

CREATE INDEX idx_audit_llm_owner_day ON public.audit_llm_calls USING btree (owner_user_id, created_at);

-- INDEX: idx_candidates_job

CREATE INDEX idx_candidates_job ON public.capability_candidates USING btree (extract_job_id, created_at, id);

-- INDEX: idx_candidates_job_status

CREATE INDEX idx_candidates_job_status ON public.capability_candidates USING btree (extract_job_id, status);

-- INDEX: idx_candidates_owner

CREATE INDEX idx_candidates_owner ON public.capability_candidates USING btree (owner_user_id, created_at DESC);

-- INDEX: idx_capabilities_creator

CREATE INDEX idx_capabilities_creator ON public.capabilities USING btree (creator_user_id, created_at DESC);

-- INDEX: idx_capver_capability

CREATE INDEX idx_capver_capability ON public.capability_versions USING btree (capability_id, created_at DESC);

-- INDEX: idx_capver_source_candidate

CREATE INDEX idx_capver_source_candidate ON public.capability_versions USING btree (source_candidate_id);

-- INDEX: idx_capver_status

CREATE INDEX idx_capver_status ON public.capability_versions USING btree (status);

-- INDEX: idx_creator_profiles_slug

CREATE INDEX idx_creator_profiles_slug ON public.creator_profiles USING btree (slug);

-- INDEX: idx_dead_topic

CREATE INDEX idx_dead_topic ON public.dead_events USING btree (topic, status);

-- INDEX: idx_dead_unresolved

CREATE INDEX idx_dead_unresolved ON public.dead_events USING btree (status, next_retry_at) WHERE (status <> 'resolved'::text);

-- INDEX: idx_drafts_owner_active

CREATE INDEX idx_drafts_owner_active ON public.drafts USING btree (owner_user_id, status, updated_at DESC);

-- INDEX: idx_evidence_candidate

CREATE INDEX idx_evidence_candidate ON public.candidate_evidence USING btree (candidate_id, created_at, id);

-- INDEX: idx_evidence_segment

CREATE INDEX idx_evidence_segment ON public.candidate_evidence USING btree (segment_id);

-- INDEX: idx_follows_followee

CREATE INDEX idx_follows_followee ON public.follows USING btree (followee_id);

-- INDEX: idx_follows_follower

CREATE INDEX idx_follows_follower ON public.follows USING btree (follower_id);

-- INDEX: idx_idem_expires

CREATE INDEX idx_idem_expires ON public.idempotency_keys USING btree (expires_at) WHERE (status = 'locked'::text);

-- INDEX: idx_jobs_lease

CREATE INDEX idx_jobs_lease ON public.jobs USING btree (status, lease_until) WHERE (status = 'running'::text);

-- INDEX: idx_jobs_owner_status

CREATE INDEX idx_jobs_owner_status ON public.jobs USING btree (owner_user_id, status, created_at DESC);

-- INDEX: idx_jobs_type_status

CREATE INDEX idx_jobs_type_status ON public.jobs USING btree (type, status);

-- INDEX: idx_likes_capability

CREATE INDEX idx_likes_capability ON public.likes USING btree (capability_id);

-- INDEX: idx_likes_user

CREATE INDEX idx_likes_user ON public.likes USING btree (user_id);

-- INDEX: idx_listings_search

CREATE INDEX idx_listings_search ON public.marketplace_listings USING gin (search_tsv);

-- INDEX: idx_listings_slug

CREATE INDEX idx_listings_slug ON public.marketplace_listings USING btree (slug);

-- INDEX: idx_listings_status

CREATE INDEX idx_listings_status ON public.marketplace_listings USING btree (status) WHERE (status = ANY (ARRAY['alpha_pending'::text, 'published'::text]));

-- INDEX: idx_notif_channel_pending

CREATE INDEX idx_notif_channel_pending ON public.notification_channels USING btree (status, created_at) WHERE (status = 'pending'::text);

-- INDEX: idx_notif_recipient_all

CREATE INDEX idx_notif_recipient_all ON public.notifications USING btree (recipient_id, created_at DESC);

-- INDEX: idx_notif_recipient_unread

CREATE INDEX idx_notif_recipient_unread ON public.notifications USING btree (recipient_id, created_at DESC) WHERE (read_at IS NULL);

-- INDEX: idx_outbox_created

CREATE INDEX idx_outbox_created ON public.outbox_events USING btree (created_at);

-- INDEX: idx_outbox_seq

CREATE INDEX idx_outbox_seq ON public.outbox_events USING btree (seq);

-- INDEX: idx_outbox_topic_seq

CREATE INDEX idx_outbox_topic_seq ON public.outbox_events USING btree (topic, seq);

-- INDEX: idx_outbox_xid

CREATE INDEX idx_outbox_xid ON public.outbox_events USING btree (xid);

-- INDEX: idx_pairings_expire

CREATE INDEX idx_pairings_expire ON public.import_pairings USING btree (expires_at) WHERE (phase <> ALL (ARRAY['job_created'::text, 'expired'::text]));

-- INDEX: idx_pub_current_version

CREATE INDEX idx_pub_current_version ON public.publications USING btree (current_version_id);

-- INDEX: idx_pub_review_status

CREATE INDEX idx_pub_review_status ON public.publications USING btree (review_status);

-- INDEX: idx_raw_snapshots_job

CREATE INDEX idx_raw_snapshots_job ON public.raw_snapshots USING btree (import_job_id);

-- INDEX: idx_raw_snapshots_orphan

CREATE INDEX idx_raw_snapshots_orphan ON public.raw_snapshots USING btree (raw_purged_at) WHERE (raw_purged_at IS NULL);

-- INDEX: idx_raw_snapshots_owner

CREATE INDEX idx_raw_snapshots_owner ON public.raw_snapshots USING btree (owner_user_id, created_at DESC);

-- INDEX: idx_rt_chat_artifact_versions_artifact

CREATE INDEX idx_rt_chat_artifact_versions_artifact ON public.rt_chat_artifact_versions USING btree (artifact_id, version);

-- INDEX: idx_rt_chat_artifacts_session

CREATE INDEX idx_rt_chat_artifacts_session ON public.rt_chat_artifacts USING btree (session_id);

-- INDEX: idx_rt_chat_messages_run

CREATE INDEX idx_rt_chat_messages_run ON public.rt_chat_messages USING btree (run_id);

-- INDEX: idx_rt_chat_messages_session

CREATE INDEX idx_rt_chat_messages_session ON public.rt_chat_messages USING btree (session_id, seq);

-- INDEX: idx_rt_chat_run_events_run_id

CREATE INDEX idx_rt_chat_run_events_run_id ON public.rt_chat_run_events USING btree (run_id, id);

-- INDEX: idx_rt_chat_runs_owner

CREATE INDEX idx_rt_chat_runs_owner ON public.rt_chat_runs USING btree (owner_id, created_at DESC);

-- INDEX: idx_rt_chat_runs_session

CREATE INDEX idx_rt_chat_runs_session ON public.rt_chat_runs USING btree (session_id, created_at DESC);

-- INDEX: idx_rt_chat_sessions_cap

CREATE INDEX idx_rt_chat_sessions_cap ON public.rt_chat_sessions USING btree (capability_id);

-- INDEX: idx_rt_chat_sessions_cap_mode

CREATE INDEX idx_rt_chat_sessions_cap_mode ON public.rt_chat_sessions USING btree (capability_id, mode, updated_at DESC);

-- INDEX: idx_rt_chat_sessions_owner

CREATE INDEX idx_rt_chat_sessions_owner ON public.rt_chat_sessions USING btree (owner_id, updated_at DESC);

-- INDEX: idx_rt_chat_sessions_owner_mode

CREATE INDEX idx_rt_chat_sessions_owner_mode ON public.rt_chat_sessions USING btree (owner_id, mode, updated_at DESC);

-- INDEX: idx_segments_snapshot

CREATE INDEX idx_segments_snapshot ON public.session_segments USING btree (snapshot_id, happened_at DESC);

-- INDEX: idx_segments_snapshot_proj

CREATE INDEX idx_segments_snapshot_proj ON public.session_segments USING btree (snapshot_id, project);

-- INDEX: uq_import_uploads_owner_upload

CREATE UNIQUE INDEX uq_import_uploads_owner_upload ON public.import_uploads USING btree (owner_user_id, upload_id);

-- INDEX: uq_pairings_code_active

CREATE UNIQUE INDEX uq_pairings_code_active ON public.import_pairings USING btree (pairing_code_hash) WHERE ((used_at IS NULL) AND (phase = ANY (ARRAY['waiting'::text, 'uploading'::text])));

-- INDEX: uq_structure_job_active_version

CREATE UNIQUE INDEX uq_structure_job_active_version ON public.jobs USING btree (((subject_ref ->> 'versionId'::text))) WHERE ((type = 'structure'::text) AND (status = ANY (ARRAY['queued'::text, 'running'::text])));

-- INDEX: uq_users_account_lower

CREATE UNIQUE INDEX uq_users_account_lower ON public.users USING btree (lower(account));

-- INDEX: uq_users_email_lower

CREATE UNIQUE INDEX uq_users_email_lower ON public.users USING btree (lower(email)) WHERE (email IS NOT NULL);

-- INDEX: uq_users_logto_user_id

CREATE UNIQUE INDEX uq_users_logto_user_id ON public.users USING btree (logto_user_id);

-- TRIGGER: marketplace_listings trg_listing_slug

CREATE TRIGGER trg_listing_slug BEFORE INSERT OR UPDATE OF capability_id ON public.marketplace_listings FOR EACH ROW EXECUTE FUNCTION public.enforce_listing_slug();

-- FK CONSTRAINT: audit_llm_calls audit_llm_calls_job_id_fkey

ALTER TABLE ONLY public.audit_llm_calls
    ADD CONSTRAINT audit_llm_calls_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id);

-- FK CONSTRAINT: audit_llm_calls audit_llm_calls_owner_user_id_fkey

ALTER TABLE ONLY public.audit_llm_calls
    ADD CONSTRAINT audit_llm_calls_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id);

-- FK CONSTRAINT: candidate_evidence candidate_evidence_snapshot_id_fkey

ALTER TABLE ONLY public.candidate_evidence
    ADD CONSTRAINT candidate_evidence_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES public.raw_snapshots(id);

-- FK CONSTRAINT: capabilities capabilities_creator_user_id_fkey

ALTER TABLE ONLY public.capabilities
    ADD CONSTRAINT capabilities_creator_user_id_fkey FOREIGN KEY (creator_user_id) REFERENCES public.users(id);

-- FK CONSTRAINT: capability_candidates capability_candidates_extract_job_id_fkey

ALTER TABLE ONLY public.capability_candidates
    ADD CONSTRAINT capability_candidates_extract_job_id_fkey FOREIGN KEY (extract_job_id) REFERENCES public.jobs(id);

-- FK CONSTRAINT: capability_candidates capability_candidates_owner_user_id_fkey

ALTER TABLE ONLY public.capability_candidates
    ADD CONSTRAINT capability_candidates_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id);

-- FK CONSTRAINT: capability_candidates capability_candidates_snapshot_id_fkey

ALTER TABLE ONLY public.capability_candidates
    ADD CONSTRAINT capability_candidates_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES public.raw_snapshots(id);

-- FK CONSTRAINT: capability_versions capability_versions_capability_id_fkey

ALTER TABLE ONLY public.capability_versions
    ADD CONSTRAINT capability_versions_capability_id_fkey FOREIGN KEY (capability_id) REFERENCES public.capabilities(id) ON DELETE CASCADE;

-- FK CONSTRAINT: capability_versions capability_versions_source_candidate_id_fkey

ALTER TABLE ONLY public.capability_versions
    ADD CONSTRAINT capability_versions_source_candidate_id_fkey FOREIGN KEY (source_candidate_id) REFERENCES public.capability_candidates(id);

-- FK CONSTRAINT: creator_profiles creator_profiles_user_id_fkey

ALTER TABLE ONLY public.creator_profiles
    ADD CONSTRAINT creator_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- FK CONSTRAINT: drafts drafts_extract_job_id_fkey

ALTER TABLE ONLY public.drafts
    ADD CONSTRAINT drafts_extract_job_id_fkey FOREIGN KEY (extract_job_id) REFERENCES public.jobs(id);

-- FK CONSTRAINT: drafts drafts_owner_user_id_fkey

ALTER TABLE ONLY public.drafts
    ADD CONSTRAINT drafts_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id);

-- FK CONSTRAINT: capabilities fk_capabilities_current_version

ALTER TABLE ONLY public.capabilities
    ADD CONSTRAINT fk_capabilities_current_version FOREIGN KEY (id, current_version_id) REFERENCES public.capability_versions(capability_id, id);

-- FK CONSTRAINT: dead_events fk_dead_events_event

ALTER TABLE ONLY public.dead_events
    ADD CONSTRAINT fk_dead_events_event FOREIGN KEY (event_id) REFERENCES public.outbox_events(event_id);

-- FK CONSTRAINT: drafts fk_drafts_capability

ALTER TABLE ONLY public.drafts
    ADD CONSTRAINT fk_drafts_capability FOREIGN KEY (capability_id) REFERENCES public.capabilities(id);

-- FK CONSTRAINT: drafts fk_drafts_snapshot

ALTER TABLE ONLY public.drafts
    ADD CONSTRAINT fk_drafts_snapshot FOREIGN KEY (snapshot_id) REFERENCES public.raw_snapshots(id);

-- FK CONSTRAINT: drafts fk_drafts_version

ALTER TABLE ONLY public.drafts
    ADD CONSTRAINT fk_drafts_version FOREIGN KEY (version_id) REFERENCES public.capability_versions(id);

-- FK CONSTRAINT: candidate_evidence fk_evidence_candidate_snapshot

ALTER TABLE ONLY public.candidate_evidence
    ADD CONSTRAINT fk_evidence_candidate_snapshot FOREIGN KEY (candidate_id, snapshot_id) REFERENCES public.capability_candidates(id, snapshot_id) ON DELETE CASCADE;

-- FK CONSTRAINT: candidate_evidence fk_evidence_segment_snapshot

ALTER TABLE ONLY public.candidate_evidence
    ADD CONSTRAINT fk_evidence_segment_snapshot FOREIGN KEY (segment_id, snapshot_id) REFERENCES public.session_segments(id, snapshot_id);

-- FK CONSTRAINT: marketplace_listings fk_listings_capability_version

ALTER TABLE ONLY public.marketplace_listings
    ADD CONSTRAINT fk_listings_capability_version FOREIGN KEY (capability_id, version_id) REFERENCES public.capability_versions(capability_id, id);

-- FK CONSTRAINT: import_pairings fk_pairings_draft

ALTER TABLE ONLY public.import_pairings
    ADD CONSTRAINT fk_pairings_draft FOREIGN KEY (draft_id) REFERENCES public.drafts(id);

-- FK CONSTRAINT: publications fk_publications_capability_version

ALTER TABLE ONLY public.publications
    ADD CONSTRAINT fk_publications_capability_version FOREIGN KEY (capability_id, current_version_id) REFERENCES public.capability_versions(capability_id, id);

-- FK CONSTRAINT: follows follows_followee_id_fkey

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_followee_id_fkey FOREIGN KEY (followee_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- FK CONSTRAINT: follows follows_follower_id_fkey

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- FK CONSTRAINT: import_pairings import_pairings_job_id_fkey

ALTER TABLE ONLY public.import_pairings
    ADD CONSTRAINT import_pairings_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id);

-- FK CONSTRAINT: import_pairings import_pairings_owner_user_id_fkey

ALTER TABLE ONLY public.import_pairings
    ADD CONSTRAINT import_pairings_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id);

-- FK CONSTRAINT: import_uploads import_uploads_job_id_fkey

ALTER TABLE ONLY public.import_uploads
    ADD CONSTRAINT import_uploads_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id);

-- FK CONSTRAINT: import_uploads import_uploads_owner_user_id_fkey

ALTER TABLE ONLY public.import_uploads
    ADD CONSTRAINT import_uploads_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id);

-- FK CONSTRAINT: jobs jobs_owner_user_id_fkey

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id);

-- FK CONSTRAINT: likes likes_capability_id_fkey

ALTER TABLE ONLY public.likes
    ADD CONSTRAINT likes_capability_id_fkey FOREIGN KEY (capability_id) REFERENCES public.capabilities(id) ON DELETE CASCADE;

-- FK CONSTRAINT: likes likes_user_id_fkey

ALTER TABLE ONLY public.likes
    ADD CONSTRAINT likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- FK CONSTRAINT: marketplace_listings marketplace_listings_capability_id_fkey

ALTER TABLE ONLY public.marketplace_listings
    ADD CONSTRAINT marketplace_listings_capability_id_fkey FOREIGN KEY (capability_id) REFERENCES public.capabilities(id) ON DELETE CASCADE;

-- FK CONSTRAINT: notification_channels notification_channels_notification_id_fkey

ALTER TABLE ONLY public.notification_channels
    ADD CONSTRAINT notification_channels_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(id) ON DELETE CASCADE;

-- FK CONSTRAINT: notifications notifications_recipient_id_fkey

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.users(id);

-- FK CONSTRAINT: publications publications_capability_id_fkey

ALTER TABLE ONLY public.publications
    ADD CONSTRAINT publications_capability_id_fkey FOREIGN KEY (capability_id) REFERENCES public.capabilities(id) ON DELETE CASCADE;

-- FK CONSTRAINT: raw_snapshots raw_snapshots_import_job_id_fkey

ALTER TABLE ONLY public.raw_snapshots
    ADD CONSTRAINT raw_snapshots_import_job_id_fkey FOREIGN KEY (import_job_id) REFERENCES public.jobs(id);

-- FK CONSTRAINT: raw_snapshots raw_snapshots_owner_user_id_fkey

ALTER TABLE ONLY public.raw_snapshots
    ADD CONSTRAINT raw_snapshots_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id);

-- FK CONSTRAINT: raw_snapshots raw_snapshots_superseded_by_fkey

ALTER TABLE ONLY public.raw_snapshots
    ADD CONSTRAINT raw_snapshots_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES public.raw_snapshots(id);

-- FK CONSTRAINT: rt_chat_artifact_versions rt_chat_artifact_versions_artifact_id_fkey

ALTER TABLE ONLY public.rt_chat_artifact_versions
    ADD CONSTRAINT rt_chat_artifact_versions_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.rt_chat_artifacts(id) ON DELETE CASCADE;

-- FK CONSTRAINT: rt_chat_artifacts rt_chat_artifacts_session_id_fkey

ALTER TABLE ONLY public.rt_chat_artifacts
    ADD CONSTRAINT rt_chat_artifacts_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.rt_chat_sessions(id) ON DELETE CASCADE;

-- FK CONSTRAINT: rt_chat_messages rt_chat_messages_session_id_fkey

ALTER TABLE ONLY public.rt_chat_messages
    ADD CONSTRAINT rt_chat_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.rt_chat_sessions(id) ON DELETE CASCADE;

-- FK CONSTRAINT: rt_chat_run_events rt_chat_run_events_run_id_fkey

ALTER TABLE ONLY public.rt_chat_run_events
    ADD CONSTRAINT rt_chat_run_events_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.rt_chat_runs(id) ON DELETE CASCADE;

-- FK CONSTRAINT: rt_chat_runs rt_chat_runs_session_id_fkey

ALTER TABLE ONLY public.rt_chat_runs
    ADD CONSTRAINT rt_chat_runs_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.rt_chat_sessions(id) ON DELETE CASCADE;

-- FK CONSTRAINT: session_segments session_segments_snapshot_id_fkey

ALTER TABLE ONLY public.session_segments
    ADD CONSTRAINT session_segments_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES public.raw_snapshots(id) ON DELETE CASCADE;

