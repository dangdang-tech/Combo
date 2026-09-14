\set ON_ERROR_STOP on
\if :{?apply_retirement}
\else
  \set apply_retirement false
\endif

-- Version 1. Explicit Test maintenance, never part of the automatic migration chain.
-- Required psql variables: expected_database, source_sha, backup_sha256.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT set_config('combo.retirement.expected_database', :'expected_database', true),
       set_config('combo.retirement.source_sha', :'source_sha', true),
       set_config('combo.retirement.backup_sha256', :'backup_sha256', true)
\gset

DO $$
DECLARE
  table_count integer;
  function_count integer;
BEGIN
  IF NOT pg_try_advisory_xact_lock(11220260724) THEN
    RAISE EXCEPTION 'Database migration is running; no changes made';
  END IF;
  IF current_database() <> current_setting('combo.retirement.expected_database')
     OR (current_database() <> 'combo_dev'
         AND current_database() !~ '^combo_retirement_test_[a-z0-9_]+$') THEN
    RAISE EXCEPTION 'Legacy entrypoint retirement is restricted to the verified Test database';
  END IF;
  IF current_setting('combo.retirement.source_sha') !~ '^[0-9a-f]{40}$'
     OR current_setting('combo.retirement.backup_sha256') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'A source commit and verified backup SHA-256 are required';
  END IF;
  IF (SELECT array_agg(filename ORDER BY filename) FROM public.schema_migrations)
     IS DISTINCT FROM ARRAY[
       '0000_baseline_schema.sql', '0001_expired_upload_reconciliation.sql',
       '0002_drop_stream_events.sql', '0003_turns.sql', '0004_studio_sessions.sql',
       '0005_capability_current_ui.sql', '0006_one_running_turn_per_session.sql',
       '0007_first_party_email_auth.sql', '0008_application_database_roles.sql',
       '0009_billing.sql', '0010_recharge_qr_channel.sql', '0011_recharge_qr_only.sql',
       '0012_agent_builder_v1.sql', '0013_external_mcp_oauth.sql',
       '0014_agent_test_reviews.sql', '0015_project_agent_shares.sql',
       '0016_project_history_agent_flow.sql', '0017_agent_package_registry.sql',
       '0018_agent_session_usage_receipts.sql', '0019_pending_usage_recovery.sql',
       '0020_private_agent_drafts.sql', '0021_agent_package_publication.sql'
     ]::text[] THEN
    RAISE EXCEPTION 'Expected the canonical 0000-0021 migration ledger';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_stat_activity
    WHERE datname = current_database() AND usename IN ('combo_worker', 'combo_runtime')
      AND pid <> pg_backend_pid()
  ) THEN
    RAISE EXCEPTION 'Legacy database consumers are still connected';
  END IF;
  SELECT count(*) INTO table_count
  FROM unnest(ARRAY[
    'uploads', 'oauth_clients', 'oauth_authorization_requests', 'oauth_authorization_codes',
    'oauth_access_tokens', 'oauth_refresh_tokens', 'project_agent_shares',
    'project_history_agent_drafts', 'project_history_agent_confirmations',
    'project_history_agent_shares'
  ]) AS target(name)
  WHERE to_regclass('public.' || name) IS NOT NULL;
  SELECT count(*) INTO function_count
  FROM unnest(ARRAY[
    'public.register_oauth_client(text,bytea,text,text[],text[],text[],text)',
    'public.cleanup_expired_oauth_artifacts(integer)',
    'public.issue_project_history_agent_confirmation(uuid,text,bigint,text,text)',
    'public.cleanup_retired_project_history_confirmations(integer)',
    'public.reject_project_history_agent_immutable_mutation()',
    'public.enforce_project_history_share_insert_integrity()',
    'public.enforce_project_history_confirmation_consumption()'
  ]) AS target(signature)
  WHERE to_regprocedure(signature) IS NOT NULL;
  IF NOT ((table_count = 10 AND function_count = 7)
          OR (table_count = 0 AND function_count = 0)) THEN
    RAISE EXCEPTION 'Unexpected partial retirement: % tables and % functions', table_count, function_count;
  END IF;
  IF table_count=10 AND to_regprocedure('public.reject_agent_immutable_mutation()') IS NULL THEN
    RAISE EXCEPTION 'The retained Agent Builder immutable guard is missing';
  END IF;
END;
$$;

SELECT to_regclass('public.uploads') IS NOT NULL AS retirement_needed
\gset
\if :apply_retirement
  \if :retirement_needed
    DROP FUNCTION public.register_oauth_client(text, bytea, text, text[], text[], text[], text);
    DROP FUNCTION public.cleanup_expired_oauth_artifacts(integer);
    DROP FUNCTION public.issue_project_history_agent_confirmation(uuid, text, bigint, text, text);
    DROP FUNCTION public.cleanup_retired_project_history_confirmations(integer);
    DROP TABLE public.oauth_access_tokens;
    DROP TABLE public.oauth_refresh_tokens;
    DROP TABLE public.oauth_authorization_codes;
    DROP TABLE public.oauth_authorization_requests;
    DROP TABLE public.oauth_clients;
    DROP TABLE public.project_history_agent_confirmations;
    DROP TABLE public.project_history_agent_shares;
    DROP TABLE public.project_history_agent_drafts;
    DROP TABLE public.project_agent_shares;
    DROP TABLE public.uploads;
    DROP FUNCTION public.reject_project_history_agent_immutable_mutation();
    DROP FUNCTION public.enforce_project_history_share_insert_integrity();
    DROP FUNCTION public.enforce_project_history_confirmation_consumption();
  \endif
  COMMIT;
  \echo 'Legacy entrypoints retired; canonical migration ledger unchanged.'
\else
  ROLLBACK;
  \echo 'Preflight passed; no changes made. apply_retirement=true is required to delete.'
\endif
\echo 'Source:' :source_sha 'Backup SHA-256:' :backup_sha256 'Database:' :expected_database
