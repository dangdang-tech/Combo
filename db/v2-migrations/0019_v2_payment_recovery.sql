-- Explicitly versioned checkout recovery; original payment/call/token facts stay immutable.
CREATE TABLE v2_payment_channel_attempts (
  id uuid PRIMARY KEY,
  payment_id uuid NOT NULL,
  user_id uuid NOT NULL,
  amount bigint NOT NULL,
  attempt_no integer NOT NULL CHECK (attempt_no BETWEEN 1 AND 3),
  gateway_environment text NOT NULL CHECK (gateway_environment IN ('test','production')),
  institution_no text NOT NULL,
  merchant_no text NOT NULL,
  pay_trace_no text NOT NULL CHECK (pay_trace_no ~ '^cb[pr][0-9a-f]{32}$'),
  pay_time text NOT NULL CHECK (pay_time ~ '^[0-9]{14}$'),
  pay_type text NOT NULL CHECK (pay_type IN ('wechat','alipay')),
  state text NOT NULL CHECK (state IN ('submitting','pending','unknown','closing','closed','succeeded','manual_review')),
  platform_trade_no text,
  qr_content text CHECK (char_length(qr_content) BETWEEN 1 AND 2048 AND qr_content !~ '[[:cntrl:]]'),
  action_expires_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  close_verified boolean NOT NULL DEFAULT false,
  closed_query_verified boolean NOT NULL DEFAULT false,
  close_event_id uuid,
  closed_query_event_id uuid,
  query_count integer NOT NULL DEFAULT 0 CHECK(query_count BETWEEN 0 AND 120),
  next_query_at timestamptz NOT NULL DEFAULT (clock_timestamp()+interval '15 seconds'),
  FOREIGN KEY (payment_id,user_id,amount) REFERENCES v2_payment_requests(id,user_id,amount),
  UNIQUE(payment_id,attempt_no),
  UNIQUE(id,payment_id,user_id),
  UNIQUE(id,payment_id,amount),
  UNIQUE(gateway_environment,institution_no,merchant_no,pay_trace_no),
  UNIQUE(gateway_environment,institution_no,merchant_no,platform_trade_no),
  CHECK ((qr_content IS NULL)=(action_expires_at IS NULL)),
  CHECK(close_verified=(close_event_id IS NOT NULL)),
  CHECK(closed_query_verified=(closed_query_event_id IS NOT NULL)),
  CHECK (action_expires_at IS NULL OR action_expires_at<=expires_at),
  CHECK (expires_at>created_at)
);
CREATE UNIQUE INDEX uq_v2_channel_active_attempt ON v2_payment_channel_attempts(payment_id)
  WHERE state NOT IN ('closed','succeeded');

CREATE TABLE v2_payment_recovery_jobs (
  id uuid PRIMARY KEY,
  payment_id uuid NOT NULL,
  user_id uuid NOT NULL,
  recovery_key text NOT NULL CHECK (char_length(recovery_key) BETWEEN 8 AND 128),
  source_attempt_id uuid NOT NULL UNIQUE,
  result_attempt_id uuid,
  phase text NOT NULL CHECK (phase IN ('requested','closing','confirming','creating','done','manual_review')),
  close_trace_no text NOT NULL UNIQUE,
  close_time text NOT NULL CHECK (close_time ~ '^[0-9]{14}$'),
  lease_owner uuid,
  lease_until timestamptz,
  lease_version bigint NOT NULL DEFAULT 0,
  query_failures integer NOT NULL DEFAULT 0 CHECK(query_failures BETWEEN 0 AND 15),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(source_attempt_id,payment_id,user_id) REFERENCES v2_payment_channel_attempts(id,payment_id,user_id),
  FOREIGN KEY(result_attempt_id,payment_id,user_id) REFERENCES v2_payment_channel_attempts(id,payment_id,user_id),
  UNIQUE(user_id,payment_id,recovery_key)
);

-- Every verified incoming channel transaction remains a fact, including exceptional double payment.
CREATE TABLE v2_payment_channel_receipts (
  channel_transaction_id text PRIMARY KEY CHECK (channel_transaction_id ~ '^[0-9a-f]{64}$'),
  attempt_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  amount bigint NOT NULL CHECK (amount>0),
  disposition text NOT NULL DEFAULT 'pending' CHECK(disposition IN ('pending','applied','review_required')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(attempt_id,payment_id,amount) REFERENCES v2_payment_channel_attempts(id,payment_id,amount)
);
CREATE TABLE v2_payment_exception_entries (
  channel_transaction_id text NOT NULL REFERENCES v2_payment_channel_receipts(channel_transaction_id),
  account text NOT NULL CHECK(account IN ('channel_clearing','customer_pending')),
  user_id uuid NOT NULL REFERENCES v2_users(id),
  amount bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(channel_transaction_id,account),
  CHECK ((account='channel_clearing' AND amount>0) OR (account='customer_pending' AND amount<0))
);
CREATE TABLE v2_payment_recovery_events (
  id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL REFERENCES v2_payment_channel_attempts(id),
  phase text NOT NULL CHECK(phase IN ('prepay','persist_prepay','query','close','credit','recovery')),
  outcome text NOT NULL CHECK(outcome IN ('started','pending','unknown','failed','succeeded','stored','manual_review')),
  reason text CHECK(reason IN ('transport_error','timeout','http_error','invalid_json','invalid_signature','missing_qr','response_validation','storage_error')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE v2_payment_channel_attempts ADD FOREIGN KEY(close_event_id) REFERENCES v2_payment_recovery_events(id);
ALTER TABLE v2_payment_channel_attempts ADD FOREIGN KEY(closed_query_event_id) REFERENCES v2_payment_recovery_events(id);

CREATE FUNCTION enforce_v2_recovery_identity() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'recovery facts cannot be deleted' USING ERRCODE='55000'; END IF;
  IF TG_TABLE_NAME='v2_payment_channel_attempts' THEN
    IF ROW(NEW.id,NEW.payment_id,NEW.user_id,NEW.amount,NEW.attempt_no,NEW.gateway_environment,NEW.institution_no,NEW.merchant_no,NEW.pay_trace_no,NEW.pay_time,NEW.pay_type,NEW.expires_at,NEW.created_at)
       IS DISTINCT FROM ROW(OLD.id,OLD.payment_id,OLD.user_id,OLD.amount,OLD.attempt_no,OLD.gateway_environment,OLD.institution_no,OLD.merchant_no,OLD.pay_trace_no,OLD.pay_time,OLD.pay_type,OLD.expires_at,OLD.created_at)
       OR (OLD.platform_trade_no IS NOT NULL AND NEW.platform_trade_no IS DISTINCT FROM OLD.platform_trade_no)
       OR (OLD.state='succeeded' AND NEW.state<>'succeeded')
       OR (OLD.close_verified AND NOT NEW.close_verified)
       OR (OLD.closed_query_verified AND NOT NEW.closed_query_verified) THEN
      RAISE EXCEPTION 'channel attempt identity is immutable' USING ERRCODE='55000';
    END IF;
  ELSIF TG_TABLE_NAME='v2_payment_recovery_jobs' THEN
    IF ROW(NEW.id,NEW.payment_id,NEW.user_id,NEW.recovery_key,NEW.source_attempt_id,NEW.close_trace_no,NEW.close_time,NEW.created_at)
       IS DISTINCT FROM ROW(OLD.id,OLD.payment_id,OLD.user_id,OLD.recovery_key,OLD.source_attempt_id,OLD.close_trace_no,OLD.close_time,OLD.created_at)
       OR (OLD.result_attempt_id IS NOT NULL AND NEW.result_attempt_id IS DISTINCT FROM OLD.result_attempt_id)
       OR NEW.lease_version<OLD.lease_version THEN
      RAISE EXCEPTION 'recovery identity is immutable' USING ERRCODE='55000';
    END IF;
  ELSE
    IF ROW(NEW.channel_transaction_id,NEW.attempt_id,NEW.payment_id,NEW.amount,NEW.created_at)
       IS DISTINCT FROM ROW(OLD.channel_transaction_id,OLD.attempt_id,OLD.payment_id,OLD.amount,OLD.created_at)
       OR (OLD.disposition<>'pending' AND NEW.disposition<>OLD.disposition) THEN
      RAISE EXCEPTION 'channel receipt is immutable' USING ERRCODE='55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path=pg_catalog,public;
CREATE TRIGGER trg_v2_channel_attempt_identity BEFORE UPDATE OR DELETE ON v2_payment_channel_attempts FOR EACH ROW EXECUTE FUNCTION enforce_v2_recovery_identity();
CREATE TRIGGER trg_v2_recovery_job_identity BEFORE UPDATE OR DELETE ON v2_payment_recovery_jobs FOR EACH ROW EXECUTE FUNCTION enforce_v2_recovery_identity();
CREATE TRIGGER trg_v2_channel_receipt_identity BEFORE UPDATE OR DELETE ON v2_payment_channel_receipts FOR EACH ROW EXECUTE FUNCTION enforce_v2_recovery_identity();
CREATE TRIGGER trg_v2_recovery_events_immutable BEFORE UPDATE OR DELETE ON v2_payment_recovery_events FOR EACH ROW EXECUTE FUNCTION reject_v2_append_only_mutation();
CREATE TRIGGER trg_v2_exception_entries_immutable BEFORE UPDATE OR DELETE ON v2_payment_exception_entries FOR EACH ROW EXECUTE FUNCTION reject_v2_append_only_mutation();

CREATE FUNCTION check_v2_exception_entries() RETURNS trigger AS $$
DECLARE transaction_ref text; receipt v2_payment_channel_receipts%ROWTYPE; owner_id uuid; entries bigint; balance numeric;
BEGIN
  transaction_ref=NEW.channel_transaction_id;
  SELECT * INTO receipt FROM v2_payment_channel_receipts WHERE channel_transaction_id=transaction_ref;
  SELECT user_id INTO owner_id FROM v2_payment_requests WHERE id=receipt.payment_id;
  SELECT count(*),sum(amount) INTO entries,balance FROM v2_payment_exception_entries WHERE channel_transaction_id=transaction_ref;
  IF receipt.disposition='review_required' THEN
    IF entries<>2 OR balance<>0 OR EXISTS(SELECT 1 FROM v2_payment_exception_entries WHERE channel_transaction_id=transaction_ref AND (user_id<>owner_id OR abs(amount::numeric)<>receipt.amount)) THEN
      RAISE EXCEPTION 'exception money requires balanced customer liability' USING ERRCODE='23514';
    END IF;
  ELSIF entries<>0 THEN RAISE EXCEPTION 'only review receipts have exception entries' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path=pg_catalog,public;
CREATE CONSTRAINT TRIGGER trg_v2_receipt_exception_accounting AFTER INSERT OR UPDATE ON v2_payment_channel_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_v2_exception_entries();
CREATE CONSTRAINT TRIGGER trg_v2_exception_accounting AFTER INSERT ON v2_payment_exception_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_v2_exception_entries();

REVOKE ALL ON v2_payment_channel_attempts,v2_payment_recovery_jobs,v2_payment_channel_receipts,v2_payment_recovery_events FROM PUBLIC,combo_api,combo_runtime,combo_worker,combo_authz,combo_billing;
REVOKE ALL ON v2_payment_exception_entries FROM PUBLIC,combo_api,combo_runtime,combo_worker,combo_authz,combo_billing;
GRANT SELECT,INSERT ON v2_payment_exception_entries TO combo_billing;
GRANT SELECT,INSERT ON v2_payment_channel_attempts,v2_payment_recovery_jobs,v2_payment_channel_receipts,v2_payment_recovery_events TO combo_billing;
GRANT UPDATE(state,platform_trade_no,qr_content,action_expires_at,updated_at,close_verified,closed_query_verified,close_event_id,closed_query_event_id,query_count,next_query_at) ON v2_payment_channel_attempts TO combo_billing;
GRANT UPDATE(phase,result_attempt_id,lease_owner,lease_until,lease_version,query_failures,updated_at) ON v2_payment_recovery_jobs TO combo_billing;
GRANT UPDATE(disposition) ON v2_payment_channel_receipts TO combo_billing;
REVOKE ALL ON FUNCTION enforce_v2_recovery_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION check_v2_exception_entries() FROM PUBLIC;
