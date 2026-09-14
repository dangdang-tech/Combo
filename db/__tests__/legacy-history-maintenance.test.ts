import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../maintenance/retire-legacy-history.sql', import.meta.url),
  'utf8',
);
const stageTwo = readFileSync(
  new URL('../maintenance/retire-legacy-runtime.sql', import.meta.url),
  'utf8',
);
const withoutComments = sql.replace(/--[^\n]*/g, '');
const historyTables = [
  'legacy_runtime_evidence',
  'agent_usage_receipts',
  'pending_usage_recoveries',
  'billing_free_allowances',
  'usage_charges',
];

function functionBody(name: string): string {
  const match = sql.match(
    new RegExp('CREATE OR REPLACE FUNCTION public\\.' + name + '\\(\\)([\\s\\S]*?)\\n\\$\\$;'),
  );
  expect(match, name).not.toBeNull();
  return match![1]!;
}

describe('explicit Test-only legacy history retirement contract', () => {
  it('requires dry-run defaults and a separate explicit history-discard acknowledgement', () => {
    expect(sql).toContain('\\set apply_retirement false');
    expect(sql).toContain('\\set discard_legacy_history false');
    expect(sql).toContain('\\if :discard_legacy_history');
    expect(sql).toContain('Explicit discard_legacy_history=true is required');
    expect(sql).toContain('\\set ON_ERROR_STOP on');
    expect(sql).toContain('ROLLBACK;');
  });

  it('binds the database, source, backup and canonical migration lock without auto-migrating', () => {
    expect(sql).toContain("current_database() <> 'combo_dev'");
    expect(sql).toContain("!~ '^combo_retirement_test_[a-z0-9_]+$'");
    expect(sql).toContain('pg_try_advisory_xact_lock(11220260724)');
    expect(sql).toContain('SET LOCAL search_path = public;');
    expect(sql).toContain('SET LOCAL lock_timeout');
    expect(sql).toContain('SET LOCAL statement_timeout');
    expect(sql).toContain('combo.retirement.source_sha');
    expect(sql).toContain('combo.retirement.backup_sha256');
    expect(sql).toContain('Expected the canonical 0000-0021 migration ledger');
    expect(withoutComments).not.toMatch(
      /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:public\.)?schema_migrations\b/i,
    );
  });

  it('drops exactly the five historical tables, never current rows or opaque columns', () => {
    const dropped = [...withoutComments.matchAll(/\bDROP TABLE (?:public\.)?(\w+);/g)].map(
      (match) => match[1],
    );
    expect(dropped).toEqual(historyTables);
    expect(withoutComments).not.toMatch(/\bCASCADE\b/i);
    expect(withoutComments).not.toMatch(/\b(?:DROP|RENAME)\s+COLUMN\b/i);
    expect(withoutComments).not.toMatch(
      /\b(?:UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+(?:public\.)?(?:billing_accounts|wallet_ledger|recharge_orders)\b/i,
    );
    expect(sql).toContain('DROP CONSTRAINT fk_wallet_ledger_usage_owner');
    expect(sql).toContain('DROP CONSTRAINT fk_recharge_order_pending_usage_recovery');
  });

  it('keeps account locking and the entire ledger sum without reading old call tables', () => {
    const body = functionBody('enforce_wallet_account_ledger_equation');
    expect(body).toContain('SECURITY INVOKER');
    expect(body).toContain('FOR UPDATE');
    expect(body).toContain('coalesce(sum(amount_cents),0::numeric)');
    expect(body).toContain('account_reserved<>0 OR account_balance<>ledger_total');
    expect(body).not.toContain('usage_charges');
    expect(sql).toContain('CHECK (reserved_cents = 0)');
    expect(sql).not.toMatch(
      /DROP TRIGGER (?:trg_billing_account_ledger_equation|trg_wallet_ledger_account_equation)/,
    );
  });

  it('rejects both old usage entry types while retaining the API-only recharge writer', () => {
    const body = functionBody('enforce_wallet_ledger_writer');
    expect(body).toContain('NEW.usage_charge_id IS NOT NULL');
    expect(body).toContain("NEW.entry_type IN ('usage_debit','usage_compensation')");
    expect(body).toContain("current_user='combo_runtime'");
    expect(body).toContain('Retired Runtime cannot append wallet ledger entries');
    expect(body).toContain("NEW.entry_type<>'recharge_credit'");
    expect(body).toContain('NEW.recharge_order_id FOR UPDATE');
    expect(body).not.toContain('FROM public.usage_charges');
  });

  it('rejects new recovery bindings and preserves the existing immutable update binding', () => {
    const body = functionBody('guard_recharge_order_recovery_binding');
    expect(body).toContain("IF TG_OP='INSERT'");
    expect(body).toContain('IF NEW.recovery_usage_id IS NOT NULL');
    expect(body).toContain('Retired recovery bindings cannot be created');
    expect(body).toContain('OLD.owner_user_id,OLD.client_idempotency_key,OLD.recovery_usage_id');
    expect(body).toContain('NEW.owner_user_id,NEW.client_idempotency_key,NEW.recovery_usage_id');
    expect(body).toContain('recharge order recovery binding is immutable');
    expect(body).not.toContain('pending_usage_recoveries');
  });

  it('removes obsolete functions and Runtime column grants without weakening recharge or append-only guards', () => {
    expect(sql).toContain('DROP FUNCTION public.enforce_usage_debit_equation()');
    expect(sql).toContain('DROP FUNCTION public.enforce_free_allowance_equation()');
    expect(sql).toContain('DROP FUNCTION public.reject_legacy_runtime_history_write()');
    expect(sql).toContain(
      'REVOKE ALL PRIVILEGES ON billing_accounts,wallet_ledger FROM combo_runtime',
    );
    expect(sql).toContain('REVOKE SELECT (%s),INSERT (%s),UPDATE (%s),REFERENCES (%s)');
    expect(withoutComments).not.toMatch(
      /(?:CREATE OR REPLACE|DROP) FUNCTION public\.(?:enforce_recharge_credit_equation|reject_wallet_ledger_mutation)\(/,
    );
    expect(withoutComments).not.toMatch(/\b(?:DROP|ALTER)\s+ROLE\b/i);
  });

  it('requires enabled financial triggers and their original deferral in both final-state checks', () => {
    for (const source of [sql, stageTwo]) {
      expect(source).toContain("t.tgenabled='O' AND NOT t.tgisinternal");
      expect(source).toContain('t.tgdeferrable=expected.is_deferred');
      expect(source).toContain('t.tginitdeferred=expected.is_deferred');
      expect(source).toContain('trg_wallet_ledger_writer');
      expect(source).toContain('trg_wallet_ledger_append_only');
      expect(source).toContain('trg_wallet_ledger_no_truncate');
      expect(source).toContain('trg_wallet_ledger_account_equation');
      expect(source).toContain('trg_billing_account_ledger_equation');
      expect(source).toContain('trg_wallet_ledger_recharge_equation');
      expect(source).toContain('trg_recharge_order_credit_equation');
      expect(source).toContain('trg_recharge_order_recovery_binding_immutable');
    }
  });

  it('lets stage two recognize the later explicit discard without touching missing tables', () => {
    const terminalState = stageTwo.indexOf('-- Stage 3 may explicitly discard');
    const earlyReturn = stageTwo.indexOf('RETURN;', terminalState);
    const oldQuery = stageTwo.indexOf("SELECT 1 FROM usage_charges WHERE status='reserved'");
    expect(terminalState).toBeGreaterThan(0);
    expect(earlyReturn).toBeGreaterThan(terminalState);
    expect(earlyReturn).toBeLessThan(oldQuery);
    expect(stageTwo.slice(terminalState, earlyReturn)).toContain(
      'ck_billing_account_no_retired_reservations',
    );
    expect(stageTwo.slice(terminalState, earlyReturn)).toContain('convalidated');
  });
});
