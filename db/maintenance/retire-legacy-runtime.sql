\set ON_ERROR_STOP on
\if :{?apply_retirement}
\else
  \set apply_retirement false
\endif

-- Explicit Test-only stage 2. Preserve historical rows and the canonical ledger.
BEGIN;
SET LOCAL search_path = public;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT set_config('combo.retirement.expected_database', :'expected_database', true),
       set_config('combo.retirement.source_sha', :'source_sha', true),
       set_config('combo.retirement.backup_sha256', :'backup_sha256', true)
\gset

DO $$
DECLARE
  remaining integer;
  dedicated_functions integer;
BEGIN
  IF NOT pg_try_advisory_xact_lock(11220260724) THEN
    RAISE EXCEPTION 'Database migration is running; no changes made';
  END IF;
  IF current_database() <> current_setting('combo.retirement.expected_database')
     OR (current_database() <> 'combo_dev'
         AND current_database() !~ '^combo_retirement_test_[a-z0-9_]+$') THEN
    RAISE EXCEPTION 'Runtime retirement is restricted to the verified Test database';
  END IF;
  IF current_setting('combo.retirement.source_sha') !~ '^[0-9a-f]{40}$'
     OR current_setting('combo.retirement.backup_sha256') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'A source commit and verified backup SHA-256 are required';
  END IF;
  IF (SELECT array_agg(filename ORDER BY filename) FROM public.schema_migrations)
     IS DISTINCT FROM ARRAY[
    '0000_baseline_schema.sql',
    '0001_expired_upload_reconciliation.sql',
    '0002_drop_stream_events.sql',
    '0003_turns.sql',
    '0004_studio_sessions.sql',
    '0005_capability_current_ui.sql',
    '0006_one_running_turn_per_session.sql',
    '0007_first_party_email_auth.sql',
    '0008_application_database_roles.sql',
    '0009_billing.sql',
    '0010_recharge_qr_channel.sql',
    '0011_recharge_qr_only.sql',
    '0012_agent_builder_v1.sql',
    '0013_external_mcp_oauth.sql',
    '0014_agent_test_reviews.sql',
    '0015_project_agent_shares.sql',
    '0016_project_history_agent_flow.sql',
    '0017_agent_package_registry.sql',
    '0018_agent_session_usage_receipts.sql',
    '0019_pending_usage_recovery.sql',
    '0020_private_agent_drafts.sql',
    '0021_agent_package_publication.sql'
  ]::text[] THEN
    RAISE EXCEPTION 'Expected the canonical 0000-0021 migration ledger';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
             AND usename IN ('combo_worker','combo_runtime') AND pid<>pg_backend_pid()) THEN
    RAISE EXCEPTION 'Legacy database consumers are still connected';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY[
    'uploads',
    'oauth_clients',
    'oauth_authorization_requests',
    'oauth_authorization_codes',
    'oauth_access_tokens',
    'oauth_refresh_tokens',
    'project_agent_shares',
    'project_history_agent_drafts',
    'project_history_agent_confirmations',
    'project_history_agent_shares'
  ]) AS target(name) WHERE to_regclass('public.'||name) IS NOT NULL) THEN
    RAISE EXCEPTION 'Complete legacy entrypoint retirement before this stage';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY[
    'public.register_oauth_client(text,bytea,text,text[],text[],text[],text)',
    'public.cleanup_expired_oauth_artifacts(integer)',
    'public.issue_project_history_agent_confirmation(uuid,text,bigint,text,text)',
    'public.cleanup_retired_project_history_confirmations(integer)',
    'public.reject_project_history_agent_immutable_mutation()',
    'public.enforce_project_history_share_insert_integrity()',
    'public.enforce_project_history_confirmation_consumption()'
  ]) AS target(signature) WHERE to_regprocedure(signature) IS NOT NULL) THEN
    RAISE EXCEPTION 'Legacy entrypoint functions have not been retired';
  END IF;
  SELECT count(*) INTO remaining FROM unnest(ARRAY[
    'agent_projects',
    'agent_revisions',
    'agent_tests',
    'agent_releases',
    'agent_test_reviews',
    'tasks',
    'capabilities',
    'sessions',
    'turns',
    'messages',
    'artifacts',
    'audit_llm_calls'
  ]) AS target(name) WHERE to_regclass('public.'||name) IS NOT NULL;
  SELECT count(*) INTO dedicated_functions FROM unnest(ARRAY[
    'public.protect_session_agent_pins()',
    'public.reject_agent_immutable_mutation()',
    'public.enforce_agent_test_transition()',
    'public.require_passed_agent_test()',
    'public.validate_agent_test_review()',
    'public.reject_agent_session_binding_mutation()',
    'public.reject_knowledge_usage_binding_mutation()',
    'public.reject_receipted_response_message_mutation()',
    'public.guard_agent_usage_receipt_write()',
    'public.enforce_knowledge_usage_receipt_equation()',
    'public.guard_pending_usage_recovery_write()',
    'public.enforce_pending_usage_recovery_terminal()'
  ]) AS target(signature) WHERE to_regprocedure(signature) IS NOT NULL;
  -- Stage 3 may explicitly discard the five frozen history tables afterwards.
  IF remaining=0 AND dedicated_functions=0
     AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY[
       'usage_charges','billing_free_allowances','agent_usage_receipts',
       'pending_usage_recoveries','legacy_runtime_evidence'
     ]) AS target(name) WHERE to_regclass('public.'||name) IS NOT NULL)
     AND to_regprocedure('public.reject_legacy_runtime_history_write()') IS NULL
     AND EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid='public.billing_accounts'::regclass
                   AND conname='ck_billing_account_no_retired_reservations'
                   AND contype='c' AND convalidated
                   AND pg_get_constraintdef(oid)='CHECK ((reserved_cents = 0))') THEN
    IF EXISTS (
      SELECT 1 FROM (VALUES
        ('billing_accounts','trg_billing_account_ledger_equation','enforce_wallet_account_ledger_equation',29,true),
        ('recharge_orders','trg_recharge_order_credit_equation','enforce_recharge_credit_equation',29,true),
        ('recharge_orders','trg_recharge_order_recovery_binding_immutable','guard_recharge_order_recovery_binding',23,false),
        ('wallet_ledger','trg_wallet_ledger_account_equation','enforce_wallet_account_ledger_equation',29,true),
        ('wallet_ledger','trg_wallet_ledger_append_only','reject_wallet_ledger_mutation',27,false),
        ('wallet_ledger','trg_wallet_ledger_no_truncate','reject_wallet_ledger_mutation',34,false),
        ('wallet_ledger','trg_wallet_ledger_recharge_equation','enforce_recharge_credit_equation',29,true),
        ('wallet_ledger','trg_wallet_ledger_writer','enforce_wallet_ledger_writer',7,false)
      ) AS expected(table_name,trigger_name,function_name,event_type,is_deferred)
      WHERE NOT EXISTS (
        SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid=to_regclass('public.'||expected.table_name)
          AND t.tgname=expected.trigger_name AND t.tgtype=expected.event_type
          AND t.tgfoid=to_regprocedure('public.'||expected.function_name||'()')
          AND t.tgenabled='O' AND NOT t.tgisinternal
          AND t.tgdeferrable=expected.is_deferred AND t.tginitdeferred=expected.is_deferred
      )
    ) THEN
      RAISE EXCEPTION 'Required current financial trigger is missing, disabled or changed';
    END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace
        AND proname IN ('enforce_wallet_account_ledger_equation','enforce_wallet_ledger_writer',
                        'guard_recharge_order_recovery_binding'))<>3
       OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace
                  AND (proname IN ('enforce_usage_debit_equation','enforce_free_allowance_equation')
                       OR prosrc ~ '\m(usage_charges|billing_free_allowances|agent_usage_receipts|pending_usage_recoveries|legacy_runtime_evidence)\M'))
       OR EXISTS (SELECT 1 FROM unnest(ARRAY['billing_accounts','wallet_ledger']) target(name)
                  WHERE has_table_privilege('combo_runtime','public.'||name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                     OR has_any_column_privilege('combo_runtime','public.'||name,'SELECT,INSERT,UPDATE,REFERENCES')) THEN
      RAISE EXCEPTION 'Incomplete history retirement';
    END IF;
    RETURN;
  END IF;
  IF NOT (
    (remaining=12 AND dedicated_functions=12
      AND to_regclass('public.legacy_runtime_evidence') IS NULL
      AND to_regprocedure('public.reject_legacy_runtime_history_write()') IS NULL)
    OR
    (remaining=0 AND dedicated_functions=0
      AND to_regclass('public.legacy_runtime_evidence') IS NOT NULL
      AND to_regprocedure('public.reject_legacy_runtime_history_write()') IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Unexpected partial runtime retirement';
  END IF;
  IF EXISTS (SELECT 1 FROM usage_charges WHERE status='reserved')
     OR EXISTS (SELECT 1 FROM billing_accounts WHERE reserved_cents<>0)
     OR EXISTS (SELECT 1 FROM billing_free_allowances WHERE free_reserved_count<>0)
     OR EXISTS (SELECT 1 FROM pending_usage_recoveries
                WHERE recovery_status='active' OR request_text IS NOT NULL) THEN
    RAISE EXCEPTION 'Unfinished usage, reserved funds, or retained request text prevents retirement';
  END IF;
  IF remaining=0 AND (
    SELECT count(*) FROM pg_trigger
    WHERE tgname='trg_legacy_runtime_read_only' AND tgenabled='O'
      AND tgfoid=to_regprocedure('public.reject_legacy_runtime_history_write()')
      AND tgrelid IN (
        'public.usage_charges'::regclass,'public.billing_free_allowances'::regclass,
        'public.agent_usage_receipts'::regclass,'public.pending_usage_recoveries'::regclass,
        to_regclass('public.legacy_runtime_evidence'))
  )<>5 THEN
    RAISE EXCEPTION 'Retired history is not fully frozen';
  END IF;
END;
$$;

SELECT to_regclass('public.tasks') IS NOT NULL AS retirement_needed
\gset
\if :apply_retirement
\if :retirement_needed
LOCK TABLE usage_charges, billing_free_allowances, agent_usage_receipts,
  pending_usage_recoveries, agent_projects, agent_revisions, agent_tests,
  agent_releases, agent_test_reviews, tasks, capabilities, sessions, turns,
  messages, artifacts, audit_llm_calls IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM usage_charges WHERE status='reserved')
     OR EXISTS (SELECT 1 FROM billing_accounts WHERE reserved_cents<>0)
     OR EXISTS (SELECT 1 FROM billing_free_allowances WHERE free_reserved_count<>0)
     OR EXISTS (SELECT 1 FROM pending_usage_recoveries
                WHERE recovery_status='active' OR request_text IS NOT NULL)
     OR EXISTS (SELECT 1 FROM turns WHERE status='running') THEN
    RAISE EXCEPTION 'Runtime history changed or is unfinished';
  END IF;
END;
$$;

CREATE TABLE legacy_runtime_evidence (
  evidence_kind text NOT NULL CHECK (evidence_kind IN ('charge','free_allowance','pending_recovery')),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  subject_id uuid NOT NULL,
  usage_charge_id uuid,
  free_capability_id uuid,
  recovery_usage_id uuid,
  capability_id uuid NOT NULL,
  session_id uuid,
  turn_id uuid,
  response_message_id uuid,
  capability_snapshot jsonb NOT NULL,
  session_snapshot jsonb,
  turn_snapshot jsonb,
  response_message_snapshot jsonb,
  source_sha text NOT NULL CHECK (source_sha ~ '^[0-9a-f]{40}$'),
  backup_sha256 text NOT NULL CHECK (backup_sha256 ~ '^[0-9a-f]{64}$'),
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (evidence_kind,owner_user_id,subject_id),
  CONSTRAINT fk_legacy_evidence_charge
    FOREIGN KEY (usage_charge_id,owner_user_id) REFERENCES usage_charges(id,owner_user_id),
  CONSTRAINT fk_legacy_evidence_free
    FOREIGN KEY (owner_user_id,free_capability_id)
    REFERENCES billing_free_allowances(owner_user_id,capability_id),
  CONSTRAINT fk_legacy_evidence_recovery
    FOREIGN KEY (owner_user_id,recovery_usage_id)
    REFERENCES pending_usage_recoveries(owner_user_id,usage_id),
  CONSTRAINT uq_legacy_evidence_charge
    UNIQUE (usage_charge_id,owner_user_id,capability_id,session_id,turn_id),
  CONSTRAINT uq_legacy_evidence_response
    UNIQUE (usage_charge_id,owner_user_id,session_id,turn_id,response_message_id),
  CONSTRAINT uq_legacy_evidence_free UNIQUE (owner_user_id,free_capability_id),
  CONSTRAINT uq_legacy_evidence_recovery
    UNIQUE (owner_user_id,recovery_usage_id,capability_id,session_id),
  CONSTRAINT uq_legacy_evidence_recovery_turn
    UNIQUE (owner_user_id,recovery_usage_id,session_id,turn_id),
  CONSTRAINT ck_legacy_evidence_kind CHECK (
    (num_nonnulls(usage_charge_id,free_capability_id,recovery_usage_id)=1
     AND subject_id=coalesce(usage_charge_id,free_capability_id,recovery_usage_id)
     AND (
       (evidence_kind='charge' AND usage_charge_id IS NOT NULL
         AND session_id IS NOT NULL AND turn_id IS NOT NULL)
       OR (evidence_kind='free_allowance' AND free_capability_id=capability_id
         AND free_capability_id IS NOT NULL AND session_id IS NULL AND turn_id IS NULL
         AND response_message_id IS NULL)
       OR (evidence_kind='pending_recovery' AND recovery_usage_id IS NOT NULL
         AND session_id IS NOT NULL AND response_message_id IS NULL)
     )) IS TRUE
  ),
  CONSTRAINT ck_legacy_evidence_capability CHECK (
    (jsonb_typeof(capability_snapshot)='object'
     AND capability_snapshot->>'id'=capability_id::text) IS TRUE
  ),
  CONSTRAINT ck_legacy_evidence_session CHECK (
    (session_id IS NULL AND session_snapshot IS NULL)
    OR (session_id IS NOT NULL AND (
      jsonb_typeof(session_snapshot)='object'
      AND session_snapshot->>'id'=session_id::text
      AND session_snapshot->>'owner_user_id'=owner_user_id::text
      AND session_snapshot->>'capability_id'=capability_id::text
    ) IS TRUE)
  ),
  CONSTRAINT ck_legacy_evidence_turn CHECK (
    (turn_id IS NULL AND turn_snapshot IS NULL)
    OR (turn_id IS NOT NULL AND (
      jsonb_typeof(turn_snapshot)='object'
      AND turn_snapshot->>'id'=turn_id::text
      AND turn_snapshot->>'session_id'=session_id::text
    ) IS TRUE)
  ),
  CONSTRAINT ck_legacy_evidence_response CHECK (
    (response_message_id IS NULL AND response_message_snapshot IS NULL)
    OR (response_message_id IS NOT NULL AND evidence_kind='charge' AND (
      jsonb_typeof(response_message_snapshot)='object'
      AND response_message_snapshot->>'id'=response_message_id::text
      AND response_message_snapshot->>'session_id'=session_id::text
      AND response_message_snapshot->>'turn_id'=turn_id::text
      AND response_message_snapshot->>'role'='assistant'
      AND response_message_snapshot->>'status'='completed'
    ) IS TRUE)
  )
);
REVOKE ALL PRIVILEGES ON legacy_runtime_evidence FROM PUBLIC,combo_api,combo_worker,combo_runtime;

-- Snapshot original rows; capability owners may differ from the consuming user.
INSERT INTO legacy_runtime_evidence (
  evidence_kind,owner_user_id,subject_id,usage_charge_id,capability_id,session_id,turn_id,
  response_message_id,capability_snapshot,session_snapshot,turn_snapshot,response_message_snapshot,
  source_sha,backup_sha256
)
SELECT 'charge',u.owner_user_id,u.id,u.id,u.capability_id,u.session_id,u.turn_id,
  r.response_message_id,to_jsonb(c),to_jsonb(s),to_jsonb(t),to_jsonb(m),
  current_setting('combo.retirement.source_sha'),current_setting('combo.retirement.backup_sha256')
FROM usage_charges u
JOIN capabilities c ON c.id=u.capability_id
JOIN sessions s ON (s.id,s.capability_id,s.owner_user_id)=(u.session_id,u.capability_id,u.owner_user_id)
JOIN turns t ON (t.id,t.session_id)=(u.turn_id,u.session_id)
LEFT JOIN agent_usage_receipts r ON (r.usage_charge_id,r.owner_user_id)=(u.id,u.owner_user_id)
LEFT JOIN messages m ON (m.id,m.session_id,m.turn_id)=(r.response_message_id,u.session_id,u.turn_id);

INSERT INTO legacy_runtime_evidence (
  evidence_kind,owner_user_id,subject_id,free_capability_id,capability_id,
  capability_snapshot,source_sha,backup_sha256
)
SELECT 'free_allowance',f.owner_user_id,f.capability_id,f.capability_id,f.capability_id,
  to_jsonb(c),current_setting('combo.retirement.source_sha'),current_setting('combo.retirement.backup_sha256')
FROM billing_free_allowances f JOIN capabilities c ON c.id=f.capability_id;

INSERT INTO legacy_runtime_evidence (
  evidence_kind,owner_user_id,subject_id,recovery_usage_id,capability_id,session_id,turn_id,
  capability_snapshot,session_snapshot,turn_snapshot,source_sha,backup_sha256
)
SELECT 'pending_recovery',p.owner_user_id,p.usage_id,p.usage_id,p.capability_id,p.session_id,
  p.terminal_turn_id,to_jsonb(c),to_jsonb(s),to_jsonb(t),
  current_setting('combo.retirement.source_sha'),current_setting('combo.retirement.backup_sha256')
FROM pending_usage_recoveries p
JOIN capabilities c ON c.id=p.capability_id
JOIN sessions s ON (s.id,s.capability_id,s.owner_user_id)=(p.session_id,p.capability_id,p.owner_user_id)
LEFT JOIN turns t ON (t.id,t.session_id)=(p.terminal_turn_id,p.session_id);

-- Bidirectional typed FKs require evidence for every retained history row.
ALTER TABLE usage_charges ADD CONSTRAINT fk_usage_charge_retired_evidence
  FOREIGN KEY (id,owner_user_id,capability_id,session_id,turn_id)
  REFERENCES legacy_runtime_evidence(usage_charge_id,owner_user_id,capability_id,session_id,turn_id);
ALTER TABLE billing_free_allowances ADD CONSTRAINT fk_free_allowance_retired_evidence
  FOREIGN KEY (owner_user_id,capability_id)
  REFERENCES legacy_runtime_evidence(owner_user_id,free_capability_id);
ALTER TABLE pending_usage_recoveries
  ADD CONSTRAINT fk_pending_recovery_retired_evidence
    FOREIGN KEY (owner_user_id,usage_id,capability_id,session_id)
    REFERENCES legacy_runtime_evidence(owner_user_id,recovery_usage_id,capability_id,session_id),
  ADD CONSTRAINT fk_pending_recovery_retired_turn
    FOREIGN KEY (owner_user_id,usage_id,session_id,terminal_turn_id)
    REFERENCES legacy_runtime_evidence(owner_user_id,recovery_usage_id,session_id,turn_id);
ALTER TABLE agent_usage_receipts
  ADD CONSTRAINT fk_receipt_retired_evidence
    FOREIGN KEY (usage_charge_id,owner_user_id,capability_id,session_id,turn_id)
    REFERENCES legacy_runtime_evidence(usage_charge_id,owner_user_id,capability_id,session_id,turn_id),
  ADD CONSTRAINT fk_receipt_retired_response
    FOREIGN KEY (usage_charge_id,owner_user_id,session_id,turn_id,response_message_id)
    REFERENCES legacy_runtime_evidence(usage_charge_id,owner_user_id,session_id,turn_id,response_message_id);

DO $$
BEGIN
  IF (SELECT count(*) FROM legacy_runtime_evidence)
     <> (SELECT (SELECT count(*) FROM usage_charges)+(SELECT count(*) FROM billing_free_allowances)
          +(SELECT count(*) FROM pending_usage_recoveries)) THEN
    RAISE EXCEPTION 'Historical evidence coverage mismatch';
  END IF;
END;
$$;

ALTER TABLE usage_charges
  DROP CONSTRAINT fk_usage_charge_session_scope,
  DROP CONSTRAINT fk_usage_charge_turn_scope;
ALTER TABLE billing_free_allowances DROP CONSTRAINT billing_free_allowances_capability_id_fkey;
ALTER TABLE agent_usage_receipts
  DROP CONSTRAINT fk_agent_usage_receipt_session_scope,
  DROP CONSTRAINT fk_agent_usage_receipt_turn_scope,
  DROP CONSTRAINT fk_agent_usage_receipt_response_scope;
ALTER TABLE pending_usage_recoveries
  DROP CONSTRAINT fk_pending_usage_recovery_session_scope,
  DROP CONSTRAINT fk_pending_usage_recovery_terminal_turn;

DROP TRIGGER trg_knowledge_usage_binding_immutable ON usage_charges;
DROP TRIGGER trg_usage_charge_knowledge_receipt_equation ON usage_charges;
DROP TRIGGER trg_usage_charge_pending_recovery_equation ON usage_charges;
DROP TRIGGER trg_agent_usage_receipts_write_guard ON agent_usage_receipts;
DROP TRIGGER trg_agent_usage_receipts_no_truncate ON agent_usage_receipts;
DROP TRIGGER trg_agent_usage_receipt_equation ON agent_usage_receipts;
DROP TRIGGER trg_pending_usage_recovery_write_guard ON pending_usage_recoveries;
DROP TRIGGER trg_pending_usage_recovery_no_truncate ON pending_usage_recoveries;
DROP TRIGGER trg_pending_usage_recovery_terminal_equation ON pending_usage_recoveries;

CREATE FUNCTION reject_legacy_runtime_history_write() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Retired runtime history is read-only' USING ERRCODE='55000';
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public;
REVOKE ALL PRIVILEGES ON FUNCTION reject_legacy_runtime_history_write()
  FROM PUBLIC,combo_api,combo_worker,combo_runtime;

DO $$
DECLARE
  relation_name text;
  column_names text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'usage_charges','billing_free_allowances','agent_usage_receipts',
    'pending_usage_recoveries','legacy_runtime_evidence'
  ] LOOP
    EXECUTE format('CREATE TRIGGER trg_legacy_runtime_read_only BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.reject_legacy_runtime_history_write()',relation_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC,combo_worker,combo_runtime',relation_name);
    EXECUTE format('REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON TABLE public.%I FROM combo_api',relation_name);
    SELECT string_agg(quote_ident(attname),',' ORDER BY attnum) INTO column_names
      FROM pg_attribute WHERE attrelid=to_regclass('public.'||relation_name)
        AND attnum>0 AND NOT attisdropped;
    EXECUTE format('REVOKE SELECT (%s),INSERT (%s),UPDATE (%s),REFERENCES (%s) ON TABLE public.%I FROM PUBLIC,combo_worker,combo_runtime',column_names,column_names,column_names,column_names,relation_name);
    EXECUTE format('REVOKE INSERT (%s),UPDATE (%s),REFERENCES (%s) ON TABLE public.%I FROM combo_api',column_names,column_names,column_names,relation_name);
  END LOOP;
END;
$$;

ALTER TABLE agent_projects
  DROP CONSTRAINT fk_agent_projects_head,
  DROP CONSTRAINT fk_agent_projects_current_release;
ALTER TABLE sessions
  DROP CONSTRAINT fk_sessions_agent_project_revision,
  DROP CONSTRAINT fk_sessions_agent_revision_capability,
  DROP CONSTRAINT fk_sessions_agent_release_revision;
ALTER TABLE capabilities DROP CONSTRAINT capabilities_ui_artifact_id_fkey;

DROP TABLE agent_releases;
DROP TABLE agent_test_reviews;
DROP TABLE agent_tests;
DROP TABLE agent_revisions;
DROP TABLE agent_projects;
DROP TABLE artifacts;
DROP TABLE messages;
DROP TABLE turns;
DROP TABLE sessions;
DROP TABLE capabilities;
DROP TABLE tasks;
DROP TABLE audit_llm_calls;

DROP FUNCTION public.protect_session_agent_pins();
DROP FUNCTION public.reject_agent_immutable_mutation();
DROP FUNCTION public.enforce_agent_test_transition();
DROP FUNCTION public.require_passed_agent_test();
DROP FUNCTION public.validate_agent_test_review();
DROP FUNCTION public.reject_agent_session_binding_mutation();
DROP FUNCTION public.reject_knowledge_usage_binding_mutation();
DROP FUNCTION public.reject_receipted_response_message_mutation();
DROP FUNCTION public.guard_agent_usage_receipt_write();
DROP FUNCTION public.enforce_knowledge_usage_receipt_equation();
DROP FUNCTION public.guard_pending_usage_recovery_write();
DROP FUNCTION public.enforce_pending_usage_recovery_terminal();
\endif
COMMIT;
\echo 'Legacy runtime retirement state verified; canonical migration ledger unchanged.'
\else
ROLLBACK;
\echo 'Runtime retirement preflight passed; no changes made.'
\endif
\echo 'Source:' :source_sha 'Backup SHA-256:' :backup_sha256 'Database:' :expected_database
