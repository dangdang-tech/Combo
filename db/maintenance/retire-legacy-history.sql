\set ON_ERROR_STOP on
\if :{?apply_retirement}
\else
  \set apply_retirement false
\endif
\if :{?discard_legacy_history}
\else
  \set discard_legacy_history false
\endif

-- Stage 3 discards old call history. Existing account/order/ledger rows stay exact.
-- Test only; never read by the canonical migration runner.
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
  relation_name text;
BEGIN
  IF NOT pg_try_advisory_xact_lock(11220260724) THEN
    RAISE EXCEPTION 'Database migration is running; no changes made';
  END IF;
  IF current_database() <> current_setting('combo.retirement.expected_database')
     OR (current_database() <> 'combo_dev'
         AND current_database() !~ '^combo_retirement_test_[a-z0-9_]+$') THEN
    RAISE EXCEPTION 'History retirement is restricted to the verified Test database';
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
    'uploads','oauth_clients','oauth_authorization_requests','oauth_authorization_codes','oauth_access_tokens','oauth_refresh_tokens','project_agent_shares','project_history_agent_drafts','project_history_agent_confirmations','project_history_agent_shares','agent_projects','agent_revisions','agent_tests','agent_releases','agent_test_reviews','tasks','capabilities','sessions','turns','messages','artifacts','audit_llm_calls'
  ]) AS target(name) WHERE to_regclass('public.'||name) IS NOT NULL) THEN
    RAISE EXCEPTION 'Complete entrypoint and runtime retirement before discarding history';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY[
    'users','auth_identities','auth_otp_challenges','auth_sessions','auth_audit_events','agent_draft_revisions','agent_packages','agent_package_releases','agent_package_publisher_claims','agent_package_release_revocations','agent_package_transfers','billing_accounts','recharge_orders','payment_attempts','payment_callback_events','wallet_ledger','schema_migrations'
  ]) AS target(name) WHERE to_regclass('public.'||name) IS NULL) THEN
    RAISE EXCEPTION 'A retained current table is missing';
  END IF;
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
  IF EXISTS (SELECT 1 FROM billing_accounts b
             WHERE reserved_cents<>0 OR balance_cents::numeric<>(
               SELECT coalesce(sum(l.amount_cents),0::numeric)
               FROM wallet_ledger l WHERE l.owner_user_id=b.owner_user_id)) THEN
    RAISE EXCEPTION 'Account reservations or account/ledger mismatch prevents retirement';
  END IF;
  SELECT count(*) INTO remaining FROM unnest(ARRAY[
    'usage_charges','billing_free_allowances','agent_usage_receipts','pending_usage_recoveries','legacy_runtime_evidence'
  ]) AS target(name) WHERE to_regclass('public.'||name) IS NOT NULL;
  IF remaining=0 THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid='public.billing_accounts'::regclass
                     AND conname='ck_billing_account_no_retired_reservations'
                     AND contype='c' AND convalidated
                     AND pg_get_constraintdef(oid)='CHECK ((reserved_cents = 0))')
       OR EXISTS (SELECT 1 FROM pg_proc
                  WHERE pronamespace='public'::regnamespace
                    AND (proname IN ('enforce_usage_debit_equation','enforce_free_allowance_equation',
                                     'reject_legacy_runtime_history_write')
                         OR prosrc ~ '\m(usage_charges|billing_free_allowances|agent_usage_receipts|pending_usage_recoveries|legacy_runtime_evidence)\M'))
       OR (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace
           AND proname IN ('enforce_wallet_account_ledger_equation','enforce_wallet_ledger_writer',
                           'guard_recharge_order_recovery_binding'))<>3 THEN
      RAISE EXCEPTION 'Incomplete history retirement';
    END IF;
    FOREACH relation_name IN ARRAY ARRAY['billing_accounts','wallet_ledger'] LOOP
      IF has_table_privilege('combo_runtime','public.'||relation_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         OR has_any_column_privilege('combo_runtime','public.'||relation_name,'SELECT,INSERT,UPDATE,REFERENCES') THEN
        RAISE EXCEPTION 'Retired Runtime still has wallet privileges';
      END IF;
    END LOOP;
    RETURN;
  END IF;
  IF remaining<>5 OR to_regprocedure('public.reject_legacy_runtime_history_write()') IS NULL
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.billing_accounts'::regclass
                AND conname='ck_billing_account_no_retired_reservations') THEN
    RAISE EXCEPTION 'Unexpected partial history retirement';
  END IF;
  IF (SELECT count(*) FROM pg_trigger
      WHERE tgname='trg_legacy_runtime_read_only' AND tgenabled='O' AND tgtype=62
        AND tgfoid='public.reject_legacy_runtime_history_write()'::regprocedure
        AND tgrelid IN ('usage_charges'::regclass,'billing_free_allowances'::regclass,
                       'agent_usage_receipts'::regclass,'pending_usage_recoveries'::regclass,
                       'legacy_runtime_evidence'::regclass))<>5 THEN
    RAISE EXCEPTION 'Legacy history is not fully frozen';
  END IF;
  IF EXISTS (SELECT 1 FROM usage_charges WHERE status='reserved')
     OR EXISTS (SELECT 1 FROM billing_free_allowances WHERE free_reserved_count<>0)
     OR EXISTS (SELECT 1 FROM pending_usage_recoveries
                WHERE recovery_status='active' OR request_text IS NOT NULL) THEN
    RAISE EXCEPTION 'Unfinished call history prevents retirement';
  END IF;
END;
$$;

SELECT to_regclass('public.usage_charges') IS NOT NULL AS retirement_needed
\gset
\if :apply_retirement
\if :discard_legacy_history
\else
DO $$ BEGIN RAISE EXCEPTION 'Explicit discard_legacy_history=true is required'; END; $$;
\endif
\if :retirement_needed
LOCK TABLE usage_charges, billing_free_allowances, agent_usage_receipts,
  pending_usage_recoveries, legacy_runtime_evidence,
  billing_accounts, wallet_ledger, recharge_orders IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM usage_charges WHERE status='reserved')
     OR EXISTS (SELECT 1 FROM billing_accounts WHERE reserved_cents<>0)
     OR EXISTS (SELECT 1 FROM billing_free_allowances WHERE free_reserved_count<>0)
     OR EXISTS (SELECT 1 FROM pending_usage_recoveries
                WHERE recovery_status='active' OR request_text IS NOT NULL) THEN
    RAISE EXCEPTION 'Unfinished call history or wallet reservations changed';
  END IF;
END;
$$;

-- Historical IDs and all existing rows remain untouched; only these two FKs leave.
ALTER TABLE wallet_ledger DROP CONSTRAINT fk_wallet_ledger_usage_owner;
ALTER TABLE recharge_orders DROP CONSTRAINT fk_recharge_order_pending_usage_recovery;
ALTER TABLE billing_accounts ADD CONSTRAINT ck_billing_account_no_retired_reservations
  CHECK (reserved_cents = 0);

-- Preserve the existing DEFERRABLE triggers and account lock/whole-ledger equation.
CREATE OR REPLACE FUNCTION public.enforce_wallet_account_ledger_equation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE
  affected_owner uuid;
  account_balance numeric;
  account_reserved numeric;
  ledger_total numeric;
BEGIN
  IF TG_OP='DELETE' THEN affected_owner:=OLD.owner_user_id;
  ELSE affected_owner:=NEW.owner_user_id;
  END IF;
  SELECT balance_cents::numeric,reserved_cents::numeric INTO account_balance,account_reserved
    FROM public.billing_accounts WHERE owner_user_id=affected_owner FOR UPDATE;
  IF account_balance IS NULL THEN
    RAISE EXCEPTION 'billing account disappeared for owner %',affected_owner USING ERRCODE='23514';
  END IF;
  SELECT coalesce(sum(amount_cents),0::numeric) INTO ledger_total
    FROM public.wallet_ledger WHERE owner_user_id=affected_owner;
  IF account_reserved<>0 OR account_balance<>ledger_total THEN
    RAISE EXCEPTION 'wallet account and ledger totals diverged for owner %',affected_owner
      USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_wallet_ledger_writer()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  -- Also blocks usage_compensation; immutable historical rows remain valid.
  IF NEW.usage_charge_id IS NOT NULL OR NEW.entry_type IN ('usage_debit','usage_compensation') THEN
    RAISE EXCEPTION 'Retired usage ledger entries cannot be appended' USING ERRCODE='55000';
  END IF;
  IF current_user='combo_runtime' THEN
    RAISE EXCEPTION 'Retired Runtime cannot append wallet ledger entries' USING ERRCODE='42501';
  END IF;
  IF current_user='combo_api' THEN
    IF NEW.entry_type<>'recharge_credit' THEN
      RAISE EXCEPTION 'combo_api cannot append % wallet ledger entries',NEW.entry_type
        USING ERRCODE='42501';
    END IF;
    PERFORM 1 FROM public.recharge_orders WHERE id=NEW.recharge_order_id FOR UPDATE;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_recharge_order_recovery_binding()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.recovery_usage_id IS NOT NULL THEN
      RAISE EXCEPTION 'Retired recovery bindings cannot be created' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (OLD.recovery_usage_id IS NOT NULL OR NEW.recovery_usage_id IS NOT NULL)
     AND ROW(OLD.owner_user_id,OLD.client_idempotency_key,OLD.recovery_usage_id)
       IS DISTINCT FROM ROW(NEW.owner_user_id,NEW.client_idempotency_key,NEW.recovery_usage_id) THEN
    RAISE EXCEPTION 'recharge order recovery binding is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;

-- Only retired Runtime grants are removed; current API and owner grants stay intact.
REVOKE ALL PRIVILEGES ON billing_accounts,wallet_ledger FROM combo_runtime;
DO $$
DECLARE
  relation_name text;
  column_names text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['billing_accounts','wallet_ledger'] LOOP
    SELECT string_agg(quote_ident(attname),',' ORDER BY attnum) INTO column_names
      FROM pg_attribute WHERE attrelid=to_regclass('public.'||relation_name)
        AND attnum>0 AND NOT attisdropped;
    EXECUTE format('REVOKE SELECT (%s),INSERT (%s),UPDATE (%s),REFERENCES (%s) ON public.%I FROM combo_runtime',
                   column_names,column_names,column_names,column_names,relation_name);
  END LOOP;
END;
$$;

DROP TRIGGER trg_wallet_ledger_usage_equation ON wallet_ledger;
ALTER TABLE usage_charges DROP CONSTRAINT fk_usage_charge_retired_evidence;
ALTER TABLE billing_free_allowances DROP CONSTRAINT fk_free_allowance_retired_evidence;
ALTER TABLE pending_usage_recoveries
  DROP CONSTRAINT fk_pending_recovery_retired_evidence,
  DROP CONSTRAINT fk_pending_recovery_retired_turn;
ALTER TABLE agent_usage_receipts
  DROP CONSTRAINT fk_receipt_retired_evidence,
  DROP CONSTRAINT fk_receipt_retired_response;

-- RESTRICT is intentional: an unknown incoming dependency rolls back all changes.
DROP TABLE legacy_runtime_evidence;
DROP TABLE agent_usage_receipts;
DROP TABLE pending_usage_recoveries;
DROP TABLE billing_free_allowances;
DROP TABLE usage_charges;
DROP FUNCTION public.enforce_usage_debit_equation();
DROP FUNCTION public.enforce_free_allowance_equation();
DROP FUNCTION public.reject_legacy_runtime_history_write();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace
             AND prosrc ~ '\m(usage_charges|billing_free_allowances|agent_usage_receipts|pending_usage_recoveries|legacy_runtime_evidence)\M') THEN
    RAISE EXCEPTION 'A database function still references retired history';
  END IF;
END;
$$;
\endif
COMMIT;
\echo 'Legacy call history discarded; current accounts, orders and ledger rows preserved.'
\else
ROLLBACK;
\echo 'History retirement preflight passed; no changes made.'
\endif
\echo 'Source:' :source_sha 'Backup SHA-256:' :backup_sha256 'Database:' :expected_database
