-- 0018 · Agent Studio 的双循环真状态。
--
-- rt_chat_artifact_versions 仍是运行时原始产物历史；Studio Revision 只在一次
-- Design Run 成功保存后指向该回合最终 main HTML，因此不会把同一回合的中间
-- upsert、失败孤儿或普通能力产物误当成用户版本。

CREATE TABLE IF NOT EXISTS rt_studio_revisions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_session_id         uuid NOT NULL REFERENCES rt_chat_sessions (id) ON DELETE CASCADE,
  revision_no               integer NOT NULL CHECK (revision_no > 0),
  artifact_key              text NOT NULL,
  artifact_version          integer NOT NULL CHECK (artifact_version > 0),
  source_run_id             uuid REFERENCES rt_chat_runs (id) ON DELETE SET NULL,
  restored_from_revision_id uuid REFERENCES rt_studio_revisions (id) ON DELETE SET NULL,
  summary                   text NOT NULL DEFAULT '',
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_rt_studio_revision_no UNIQUE (studio_session_id, revision_no),
  CONSTRAINT uq_rt_studio_revision_artifact UNIQUE (
    studio_session_id,
    artifact_key,
    artifact_version
  ),
  CONSTRAINT uq_rt_studio_revision_run UNIQUE (source_run_id)
);

CREATE INDEX IF NOT EXISTS idx_rt_studio_revisions_session
  ON rt_studio_revisions (studio_session_id, revision_no DESC);

CREATE TABLE IF NOT EXISTS rt_studio_tests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_session_id uuid NOT NULL REFERENCES rt_chat_sessions (id) ON DELETE CASCADE,
  revision_id       uuid NOT NULL REFERENCES rt_studio_revisions (id) ON DELETE CASCADE,
  test_session_id   uuid NOT NULL REFERENCES rt_chat_sessions (id) ON DELETE CASCADE,
  run_id            uuid NOT NULL REFERENCES rt_chat_runs (id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'completed', 'failed', 'interrupted')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  CONSTRAINT uq_rt_studio_test_run UNIQUE (run_id),
  CONSTRAINT uq_rt_studio_test_session UNIQUE (test_session_id)
);

CREATE INDEX IF NOT EXISTS idx_rt_studio_tests_revision
  ON rt_studio_tests (revision_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rt_studio_tests_studio
  ON rt_studio_tests (studio_session_id, created_at DESC);

-- 已有 Design Agent 会话的成功 main HTML 回合补成 Revision 历史；每个 assistant
-- 回合只会引用该回合最后一次同 key 产物，因此正好对应一个可见版本。
WITH existing_main AS (
  SELECT m.session_id,
         m.run_id,
         (ref ->> 'version')::integer AS artifact_version,
         btrim(m.text) AS summary,
         m.seq,
         row_number() OVER (PARTITION BY m.session_id ORDER BY m.seq) AS revision_no
    FROM rt_chat_messages m
    JOIN rt_chat_runs run
      ON run.id = m.run_id
     AND run.session_id = m.session_id
     AND run.status = 'completed'
     AND run.input ->> 'intent' = 'design'
    JOIN rt_chat_sessions session
      ON session.id = m.session_id
     AND session.mode = 'trial'
     AND session.public_view ->> 'status' = 'draft'
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(m.artifacts, '[]'::jsonb)) ref
   WHERE m.role = 'assistant'
     AND m.run_id IS NOT NULL
     AND ref ->> 'artifactKey' = 'main'
     AND ref ->> 'kind' = 'html'
)
INSERT INTO rt_studio_revisions (
  studio_session_id,
  revision_no,
  artifact_key,
  artifact_version,
  source_run_id,
  summary
)
SELECT session_id,
       revision_no,
       'main',
       artifact_version,
       run_id,
       left(summary, 240)
  FROM existing_main
ON CONFLICT DO NOTHING;
