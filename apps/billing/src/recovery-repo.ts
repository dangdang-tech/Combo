import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type {
  PayType,
  PaymentSubmission,
  PaymentQueryResult,
  PaymentFailureReason,
} from './channel/index.js';
import { withTransaction, type Queryable } from './repo.js';
import { ChannelConflictError } from './channel-service.js';

export const RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_PAYMENT_ATTEMPTS = 3;
export interface RecoveryPayment {
  id: string;
  user_id: string;
  amount: string;
  state: 'required' | 'waiting' | 'completed';
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
  channel_transaction_id: string | null;
}
export interface ChannelAttempt {
  id: string;
  payment_id: string;
  user_id: string;
  amount: string;
  attempt_no: number;
  gateway_environment: 'test' | 'production';
  institution_no: string;
  merchant_no: string;
  pay_trace_no: string;
  pay_time: string;
  pay_type: PayType;
  state:
    | 'submitting'
    | 'pending'
    | 'unknown'
    | 'closing'
    | 'closed'
    | 'succeeded'
    | 'manual_review';
  platform_trade_no: string | null;
  qr_content: string | null;
  action_expires_at: Date | null;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
  close_verified: boolean;
  closed_query_verified: boolean;
}
export interface RecoveryJob {
  id: string;
  payment_id: string;
  user_id: string;
  source_attempt_id: string;
  result_attempt_id: string | null;
  phase: 'requested' | 'closing' | 'confirming' | 'creating' | 'done' | 'manual_review';
  close_trace_no: string;
  close_time: string;
  lease_owner: string;
  lease_version: string;
}
export interface ChannelScope {
  environment: 'test' | 'production';
  institutionNo: string;
  merchantNo: string;
}

async function lockedPayment(tx: Queryable, id: string, userId: string) {
  // The same lock also serializes legacy channel creation against adoption.
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))', [
    `v2-channel:${id}`,
  ]);
  return (
    await tx.query<RecoveryPayment>(
      "SELECT * FROM v2_payment_requests WHERE id=$1 AND user_id=$2 AND state<>'required' FOR UPDATE",
      [id, userId],
    )
  ).rows[0];
}
async function latest(tx: Queryable, id: string): Promise<ChannelAttempt | undefined> {
  return (
    await tx.query<ChannelAttempt>(
      'SELECT * FROM v2_payment_channel_attempts WHERE payment_id=$1 ORDER BY attempt_no DESC LIMIT 1',
      [id],
    )
  ).rows[0];
}
async function unresolvedFunds(tx: Queryable, id: string) {
  return !!(
    await tx.query(
      "SELECT 1 FROM v2_payment_channel_receipts WHERE payment_id=$1 AND disposition<>'applied' LIMIT 1",
      [id],
    )
  ).rowCount;
}
async function adopt(tx: Queryable, id: string): Promise<ChannelAttempt | undefined> {
  const old = await latest(tx, id);
  if (old) return old;
  // Copy the immutable original identity, including expired actions, without reviving a v1 action.
  await tx.query(
    `INSERT INTO v2_payment_channel_attempts
    (id,payment_id,user_id,amount,attempt_no,gateway_environment,institution_no,merchant_no,pay_trace_no,pay_time,pay_type,state,platform_trade_no,qr_content,action_expires_at,expires_at,created_at)
    SELECT o.payment_id,o.payment_id,o.user_id,o.amount,1,o.gateway_environment,o.institution_no,o.merchant_no,o.pay_trace_no,o.pay_time,o.pay_type,
      CASE WHEN p.state='completed' THEN 'succeeded' WHEN o.submission_state='failed' THEN 'closed' ELSE o.submission_state END,
      o.platform_trade_no,o.qr_content,o.action_expires_at,o.expires_at,o.created_at
    FROM v2_payment_channel_orders o JOIN v2_payment_requests p ON p.id=o.payment_id WHERE o.payment_id=$1
    ON CONFLICT DO NOTHING`,
    [id],
  );
  return latest(tx, id);
}
async function insertAttempt(
  tx: Queryable,
  p: RecoveryPayment,
  scope: ChannelScope,
  payType: PayType,
  number: number,
) {
  const id = randomUUID();
  return (
    await tx.query<ChannelAttempt>(
      `INSERT INTO v2_payment_channel_attempts
    (id,payment_id,user_id,amount,attempt_no,gateway_environment,institution_no,merchant_no,pay_trace_no,pay_time,pay_type,state,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,to_char(statement_timestamp() AT TIME ZONE 'Asia/Shanghai','YYYYMMDDHH24MISS'),$10,'submitting',
      LEAST(statement_timestamp()+interval '15 minutes',$11::timestamptz+interval '24 hours')) RETURNING *`,
      [
        id,
        p.id,
        p.user_id,
        p.amount,
        number,
        scope.environment,
        scope.institutionNo,
        scope.merchantNo,
        `cbr${id.replaceAll('-', '')}`,
        payType,
        p.created_at,
      ],
    )
  ).rows[0]!;
}

export function createPgRecoveryStore(pool: Pool) {
  return {
    async snapshot(id: string, userId: string) {
      return withTransaction(pool, async (tx) => {
        const payment = await lockedPayment(tx, id, userId);
        if (!payment) return null;
        let attempt = await adopt(tx, id);
        if (payment.state === 'completed' && payment.channel_transaction_id) {
          const winner = (
            await tx.query<ChannelAttempt>(
              'SELECT a.* FROM v2_payment_channel_attempts a JOIN v2_payment_channel_receipts r ON r.attempt_id=a.id WHERE r.payment_id=$1 AND r.channel_transaction_id=$2',
              [id, payment.channel_transaction_id],
            )
          ).rows[0];
          if (winner) attempt = winner;
          else {
            const candidates = (
              await tx.query<ChannelAttempt>(
                'SELECT * FROM v2_payment_channel_attempts WHERE payment_id=$1',
                [id],
              )
            ).rows;
            const original = candidates.find(
              (a) =>
                a.platform_trade_no &&
                createHash('sha256')
                  .update(
                    JSON.stringify([
                      a.gateway_environment,
                      a.institution_no,
                      a.merchant_no,
                      a.platform_trade_no,
                    ]),
                  )
                  .digest('hex') === payment.channel_transaction_id,
            );
            if (!original) throw new ChannelConflictError();
            attempt = original;
          }
        }
        const needsReview = await unresolvedFunds(tx, id);
        return { payment, attempt, needsReview };
      });
    },
    async first(id: string, userId: string) {
      return (
        await pool.query<ChannelAttempt>(
          'SELECT * FROM v2_payment_channel_attempts WHERE payment_id=$1 AND user_id=$2 ORDER BY attempt_no LIMIT 1',
          [id, userId],
        )
      ).rows[0];
    },
    async attempt(id: string) {
      return (
        await pool.query<ChannelAttempt>('SELECT * FROM v2_payment_channel_attempts WHERE id=$1', [
          id,
        ])
      ).rows[0];
    },
    async initial(id: string, userId: string, scope: ChannelScope, payType: PayType) {
      return withTransaction(pool, async (tx) => {
        const p = await lockedPayment(tx, id, userId);
        if (!p) return null;
        const old = await adopt(tx, id);
        if (old) {
          if (old.pay_type !== payType) throw new ChannelConflictError();
          return { attempt: old, dispatch: false };
        }
        if (p.state === 'completed' || Date.now() >= p.created_at.getTime() + RECOVERY_WINDOW_MS)
          throw new ChannelConflictError();
        return { attempt: await insertAttempt(tx, p, scope, payType, 1), dispatch: true };
      });
    },
    async recordSubmission(a: ChannelAttempt, result: PaymentSubmission) {
      const qr =
        result.status === 'pending' && result.action?.kind === 'code_url'
          ? result.action
          : undefined;
      const saved = await pool.query(
        `UPDATE v2_payment_channel_attempts SET state=$2,platform_trade_no=COALESCE(platform_trade_no,$3),
        qr_content=CASE WHEN $5::timestamptz>statement_timestamp() THEN $4 ELSE NULL END,
        action_expires_at=CASE WHEN $5::timestamptz>statement_timestamp() THEN LEAST($5,expires_at) ELSE NULL END,updated_at=clock_timestamp()
        WHERE id=$1 AND (state='submitting' OR
          (state IN ('pending','unknown') AND $2='pending' AND $4::text IS NOT NULL AND $5::timestamptz>statement_timestamp()))
        AND (platform_trade_no IS NULL OR $3::text IS NULL OR platform_trade_no=$3::text)`,
        [
          a.id,
          result.status === 'failed' ? 'closed' : result.status,
          result.platformTradeNo ?? null,
          qr?.value ?? null,
          qr?.expiresAt ?? null,
        ],
      );
      return saved.rowCount === 1;
    },
    async recordQuery(a: ChannelAttempt, result: PaymentQueryResult) {
      const update = await pool.query(
        `UPDATE v2_payment_channel_attempts SET
        platform_trade_no=COALESCE(platform_trade_no,$2::text),
        state=CASE WHEN state='succeeded' THEN state WHEN $3='succeeded' THEN 'succeeded'
          WHEN state IN ('closing','manual_review') OR (state='closed' AND close_verified) THEN state WHEN $3='failed' THEN 'closed' ELSE $3 END,
        updated_at=clock_timestamp() WHERE id=$1 AND (platform_trade_no IS NULL OR $2::text IS NULL OR platform_trade_no=$2::text)`,
        [a.id, result.platformTradeNo ?? null, result.status],
      );
      if (!update.rowCount) throw new ChannelConflictError();
    },
    async request(id: string, userId: string, expected: string, key: string) {
      return withTransaction(pool, async (tx) => {
        const p = await lockedPayment(tx, id, userId);
        if (!p) return null;
        const previous = (
          await tx.query<RecoveryJob>(
            'SELECT * FROM v2_payment_recovery_jobs WHERE user_id=$1 AND payment_id=$2 AND recovery_key=$3',
            [userId, id, key],
          )
        ).rows[0];
        if (previous) {
          if (previous.source_attempt_id !== expected) throw new ChannelConflictError();
          return previous;
        }
        const a = await adopt(tx, id);
        if (
          !a ||
          a.id !== expected ||
          p.state === 'completed' ||
          (await unresolvedFunds(tx, id)) ||
          a.attempt_no >= MAX_PAYMENT_ATTEMPTS ||
          p.created_at.getTime() + RECOVERY_WINDOW_MS <= Date.now() ||
          !['pending', 'unknown', 'closed'].includes(a.state) ||
          (a.state === 'pending' &&
            a.qr_content &&
            a.action_expires_at &&
            a.action_expires_at.getTime() > Date.now())
        )
          throw new ChannelConflictError();
        const active = (
          await tx.query('SELECT id FROM v2_payment_recovery_jobs WHERE source_attempt_id=$1', [
            a.id,
          ])
        ).rows[0];
        if (active) throw new ChannelConflictError();
        const job = (
          await tx.query<RecoveryJob>(
            `INSERT INTO v2_payment_recovery_jobs
          (id,payment_id,user_id,recovery_key,source_attempt_id,phase,close_trace_no,close_time)
          VALUES($1,$2,$3,$4,$5,'requested',$6,to_char(statement_timestamp() AT TIME ZONE 'Asia/Shanghai','YYYYMMDDHH24MISS')) RETURNING *`,
            [randomUUID(), id, userId, key, a.id, `close-${randomUUID()}`],
          )
        ).rows[0]!;
        await tx.query(
          "UPDATE v2_payment_channel_attempts SET state='closing',updated_at=clock_timestamp() WHERE id=$1",
          [a.id],
        );
        return job;
      });
    },
    async lease(jobId?: string) {
      const owner = randomUUID();
      return withTransaction(pool, async (tx) => {
        const job = (
          await tx.query<RecoveryJob>(
            `SELECT * FROM v2_payment_recovery_jobs WHERE phase NOT IN ('done','manual_review')
          AND ($1::uuid IS NULL OR id=$1::uuid) AND (lease_until IS NULL OR lease_until<statement_timestamp()) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
            [jobId ?? null],
          )
        ).rows[0];
        if (!job) return null;
        return (
          await tx.query<RecoveryJob>(
            `UPDATE v2_payment_recovery_jobs SET lease_owner=$2,lease_until=statement_timestamp()+interval '2 minutes',
          lease_version=lease_version+1 WHERE id=$1 RETURNING *`,
            [job.id, owner],
          )
        ).rows[0]!;
      });
    },
    async phase(job: RecoveryJob, phase: RecoveryJob['phase']) {
      const r = await pool.query(
        `UPDATE v2_payment_recovery_jobs SET phase=$4,updated_at=clock_timestamp()
        WHERE id=$1 AND lease_owner=$2 AND lease_version=$3 AND lease_until>statement_timestamp()`,
        [job.id, job.lease_owner, job.lease_version, phase],
      );
      if (!r.rowCount) throw new ChannelConflictError();
      job.phase = phase;
    },
    async verifiedClose(job: RecoveryJob, eventId: string) {
      return withTransaction(pool, async (tx) => {
        const r = await tx.query(
          `UPDATE v2_payment_recovery_jobs SET phase='confirming',updated_at=clock_timestamp()
          WHERE id=$1 AND lease_owner=$2 AND lease_version=$3 AND lease_until>statement_timestamp() AND phase='closing'
          AND EXISTS(SELECT 1 FROM v2_payment_recovery_events e WHERE e.id=$4 AND e.attempt_id=source_attempt_id AND e.phase='close' AND e.outcome='succeeded')
          RETURNING source_attempt_id`,
          [job.id, job.lease_owner, job.lease_version, eventId],
        );
        if (!r.rowCount) throw new ChannelConflictError();
        await tx.query(
          'UPDATE v2_payment_channel_attempts SET close_verified=true,close_event_id=$2,updated_at=clock_timestamp() WHERE id=$1',
          [job.source_attempt_id, eventId],
        );
        job.phase = 'confirming';
      });
    },
    async verifiedFailure(job: RecoveryJob, eventId: string, trade: string) {
      const r = await pool.query(
        `UPDATE v2_payment_channel_attempts a SET closed_query_verified=true,closed_query_event_id=$2,updated_at=clock_timestamp()
        FROM v2_payment_recovery_jobs j,v2_payment_recovery_events e
        WHERE a.id=$1 AND a.close_verified AND a.platform_trade_no=$3 AND j.id=$4 AND j.source_attempt_id=a.id
          AND j.phase='confirming' AND j.lease_owner=$5 AND j.lease_version=$6 AND j.lease_until>statement_timestamp()
          AND e.id=$2 AND e.attempt_id=a.id AND e.phase='query' AND e.outcome='failed' AND e.created_at>=j.updated_at`,
        [job.source_attempt_id, eventId, trade, job.id, job.lease_owner, job.lease_version],
      );
      if (!r.rowCount) throw new ChannelConflictError();
    },
    async next(job: RecoveryJob, scope: ChannelScope) {
      return withTransaction(pool, async (tx) => {
        const p = await lockedPayment(tx, job.payment_id, job.user_id);
        const current = (
          await tx.query<RecoveryJob>(
            `SELECT * FROM v2_payment_recovery_jobs WHERE id=$1 AND lease_owner=$2 AND lease_version=$3
          AND lease_until>statement_timestamp() FOR UPDATE`,
            [job.id, job.lease_owner, job.lease_version],
          )
        ).rows[0];
        if (!p || !current) throw new ChannelConflictError();
        if (current.result_attempt_id)
          return {
            attempt: (
              await tx.query<ChannelAttempt>(
                'SELECT * FROM v2_payment_channel_attempts WHERE id=$1',
                [current.result_attempt_id],
              )
            ).rows[0]!,
            dispatch: false,
          };
        const old = (
          await tx.query<ChannelAttempt>(
            'SELECT * FROM v2_payment_channel_attempts WHERE id=$1 FOR UPDATE',
            [job.source_attempt_id],
          )
        ).rows[0]!;
        if (
          p.state === 'completed' ||
          old.state === 'succeeded' ||
          (await unresolvedFunds(tx, p.id))
        )
          return null;
        if (
          !old.close_verified ||
          !old.closed_query_verified ||
          current.phase !== 'confirming' ||
          old.attempt_no >= MAX_PAYMENT_ATTEMPTS ||
          p.created_at.getTime() + RECOVERY_WINDOW_MS <= Date.now()
        )
          throw new ChannelConflictError();
        await tx.query(
          "UPDATE v2_payment_channel_attempts SET state='closed',qr_content=NULL,action_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1",
          [old.id],
        );
        const attempt = await insertAttempt(tx, p, scope, old.pay_type, old.attempt_no + 1);
        await tx.query(
          "UPDATE v2_payment_recovery_jobs SET phase='creating',result_attempt_id=$2,updated_at=clock_timestamp() WHERE id=$1",
          [job.id, attempt.id],
        );
        job.phase = 'creating';
        job.result_attempt_id = attempt.id;
        return { attempt, dispatch: true };
      });
    },
    async manual(job: RecoveryJob) {
      await this.phase(job, 'manual_review');
      await pool.query(
        "UPDATE v2_payment_channel_attempts SET state='manual_review',updated_at=clock_timestamp() WHERE id=$1 AND state<>'succeeded'",
        [job.result_attempt_id ?? job.source_attempt_id],
      );
    },
    async retryQuery(job: RecoveryJob) {
      const r = await pool.query<{ query_failures: number }>(
        `UPDATE v2_payment_recovery_jobs SET query_failures=LEAST(query_failures+1,15)
        WHERE id=$1 AND lease_owner=$2 AND lease_version=$3 AND lease_until>statement_timestamp() RETURNING query_failures`,
        [job.id, job.lease_owner, job.lease_version],
      );
      if (!r.rowCount) throw new ChannelConflictError();
      if (r.rows[0]!.query_failures >= 15) return this.manual(job);
      await pool.query(
        `UPDATE v2_payment_recovery_jobs SET lease_until=statement_timestamp()+interval '5 seconds'
        WHERE id=$1 AND lease_owner=$2 AND lease_version=$3`,
        [job.id, job.lease_owner, job.lease_version],
      );
    },
    async queries(limit: number) {
      return withTransaction(pool, async (tx) => {
        const rows = (
          await tx.query<ChannelAttempt>(
            `SELECT * FROM v2_payment_channel_attempts
          WHERE state IN ('submitting','pending','unknown','closing','manual_review') AND created_at>statement_timestamp()-interval '24 hours'
          AND query_count<120 AND next_query_at<=statement_timestamp() ORDER BY next_query_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
            [limit],
          )
        ).rows;
        for (const a of rows)
          await tx.query(
            "UPDATE v2_payment_channel_attempts SET query_count=query_count+1,next_query_at=statement_timestamp()+interval '30 seconds' WHERE id=$1",
            [a.id],
          );
        return rows;
      });
    },
    async find(scope: ChannelScope, trace: string, time: string) {
      return (
        await pool.query<ChannelAttempt>(
          `SELECT * FROM v2_payment_channel_attempts WHERE gateway_environment=$1 AND institution_no=$2 AND merchant_no=$3 AND pay_trace_no=$4 AND pay_time=$5`,
          [scope.environment, scope.institutionNo, scope.merchantNo, trace, time],
        )
      ).rows[0];
    },
    async receipt(a: ChannelAttempt, trade: string) {
      if (a.platform_trade_no && a.platform_trade_no !== trade) throw new ChannelConflictError();
      const transaction = createHash('sha256')
        .update(JSON.stringify([a.gateway_environment, a.institution_no, a.merchant_no, trade]))
        .digest('hex');
      await pool.query(
        `INSERT INTO v2_payment_channel_receipts(channel_transaction_id,attempt_id,payment_id,amount) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [transaction, a.id, a.payment_id, a.amount],
      );
      const row = (
        await pool.query<{ attempt_id: string; payment_id: string; amount: string }>(
          'SELECT attempt_id,payment_id,amount FROM v2_payment_channel_receipts WHERE channel_transaction_id=$1',
          [transaction],
        )
      ).rows[0]!;
      if (row.attempt_id !== a.id || row.payment_id !== a.payment_id || row.amount !== a.amount)
        throw new ChannelConflictError();
      return transaction;
    },
    async disposition(transaction: string, status: 'applied' | 'review_required') {
      await withTransaction(pool, async (tx) => {
        const updated = await tx.query(
          "UPDATE v2_payment_channel_receipts SET disposition=$2 WHERE channel_transaction_id=$1 AND disposition='pending' RETURNING payment_id,amount",
          [transaction, status],
        );
        if (status === 'review_required' && updated.rowCount)
          await tx.query(
            `INSERT INTO v2_payment_exception_entries(channel_transaction_id,account,user_id,amount)
          SELECT r.channel_transaction_id,a.account,p.user_id,CASE WHEN a.account='channel_clearing' THEN r.amount ELSE -r.amount END
          FROM v2_payment_channel_receipts r JOIN v2_payment_requests p ON p.id=r.payment_id CROSS JOIN (VALUES('channel_clearing'),('customer_pending')) a(account)
          WHERE r.channel_transaction_id=$1`,
            [transaction],
          );
      });
    },
    async pendingReceipts() {
      return (
        await pool.query<{ channel_transaction_id: string; attempt_id: string }>(
          "SELECT channel_transaction_id,attempt_id FROM v2_payment_channel_receipts WHERE disposition='pending' LIMIT 20",
        )
      ).rows;
    },
    async event(
      attemptId: string,
      phase: 'prepay' | 'persist_prepay' | 'query' | 'close' | 'credit' | 'recovery',
      outcome:
        | 'started'
        | 'pending'
        | 'unknown'
        | 'failed'
        | 'succeeded'
        | 'stored'
        | 'manual_review',
      reason?: PaymentFailureReason,
    ) {
      const id = randomUUID();
      await pool.query(
        'INSERT INTO v2_payment_recovery_events(id,attempt_id,phase,outcome,reason) VALUES($1,$2,$3,$4,$5)',
        [id, attemptId, phase, outcome, reason ?? null],
      );
      return id;
    },
  };
}
export type RecoveryStore = ReturnType<typeof createPgRecoveryStore>;
