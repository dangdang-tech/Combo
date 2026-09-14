import type { Pool } from 'pg';
import { withTransaction, type Queryable } from './repo.js';
import {
  ChannelConflictError,
  type ChannelOrder,
  type ChannelOrderStore,
} from './channel-service.js';

interface Row {
  payment_id: string;
  user_id: string;
  amount: string;
  gateway_environment: ChannelOrder['environment'];
  institution_no: string;
  merchant_no: string;
  pay_trace_no: string;
  pay_time: string;
  pay_type: ChannelOrder['payType'];
  submission_state: ChannelOrder['state'];
  platform_trade_no: string | null;
  qr_content: string | null;
  action_expires_at: Date | null;
  expires_at: Date;
  completed: boolean;
}
const SELECT = `SELECT o.*, (p.state = 'completed') AS completed FROM v2_payment_channel_orders o JOIN v2_payment_requests p ON p.id=o.payment_id`;

/** Remove expired/consumed bearer-like QR content in bounded batches, without deleting order facts. */
export function clearExpiredChannelActions(pool: Pool, limit: number): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new ChannelConflictError();
  return withTransaction(pool, async (tx) => {
    const result = await tx.query(
      `WITH expired AS (
      SELECT o.payment_id FROM v2_payment_channel_orders o JOIN v2_payment_requests p ON p.id=o.payment_id
      WHERE o.qr_content IS NOT NULL AND (o.action_expires_at<=statement_timestamp() OR p.state='completed')
      LIMIT $1 FOR UPDATE OF o SKIP LOCKED
    ) UPDATE v2_payment_channel_orders o SET qr_content=NULL,action_expires_at=NULL
      FROM expired WHERE o.payment_id=expired.payment_id`,
      [limit],
    );
    return result.rowCount ?? 0;
  });
}
function order(row: Row): ChannelOrder {
  const amountCents = Number(row.amount);
  if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > 999_999_999_999_999)
    throw new ChannelConflictError();
  return {
    paymentId: row.payment_id,
    userId: row.user_id,
    amountCents,
    environment: row.gateway_environment,
    institutionNo: row.institution_no,
    merchantNo: row.merchant_no,
    payTraceNo: row.pay_trace_no,
    payTime: row.pay_time,
    payType: row.pay_type,
    state: row.submission_state,
    expiresAt: row.expires_at,
    completed: row.completed,
    ...(row.platform_trade_no ? { platformTradeNo: row.platform_trade_no } : {}),
    ...(row.qr_content ? { qrContent: row.qr_content } : {}),
    ...(row.action_expires_at ? { actionExpiresAt: row.action_expires_at } : {}),
  };
}

export function createPgChannelOrderStore(
  pool: Pool,
  options: { recovery?: boolean } = {},
): ChannelOrderStore {
  const recovered = async (tx: Queryable, paymentId: string, userId: string) => {
    if (!options.recovery) return undefined;
    return (
      await tx.query<Row>(
        `SELECT a.payment_id,a.user_id,a.amount,a.gateway_environment,a.institution_no,a.merchant_no,
      a.pay_trace_no,a.pay_time,a.pay_type,CASE WHEN a.state='closed' THEN 'failed' WHEN a.state IN ('submitting','pending') THEN a.state ELSE 'unknown' END AS submission_state,
      a.platform_trade_no,a.qr_content,a.action_expires_at,a.expires_at,(p.state='completed') AS completed
      FROM v2_payment_channel_attempts a JOIN v2_payment_requests p ON p.id=a.payment_id
      WHERE a.payment_id=$1 AND a.user_id=$2 ORDER BY a.attempt_no LIMIT 1`,
        [paymentId, userId],
      )
    ).rows[0];
  };
  return {
    prepare: (input) =>
      withTransaction(pool, async (tx) => {
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))', [
          `v2-channel:${input.paymentId}`,
        ]);
        const payment = (
          await tx.query<{
            id: string;
            user_id: string;
            amount: string;
            expires_at: Date;
            state: string;
          }>(
            `SELECT id,user_id,amount,expires_at,state FROM v2_payment_requests WHERE id=$1 AND user_id=$2 FOR UPDATE`,
            [input.paymentId, input.userId],
          )
        ).rows[0];
        if (!payment || payment.state === 'required') return null;
        const adopted = await recovered(tx, payment.id, input.userId);
        if (adopted) return { order: order(adopted), shouldSubmit: false };
        const current = (await tx.query<Row>(`${SELECT} WHERE o.payment_id=$1`, [payment.id]))
          .rows[0];
        if (current) return { order: order(current), shouldSubmit: false };
        const inserted = await tx.query(
          `INSERT INTO v2_payment_channel_orders
        (payment_id,user_id,amount,gateway_environment,institution_no,merchant_no,pay_trace_no,pay_time,pay_type,expires_at)
        SELECT id,user_id,amount,$3,$4,$5,'cbp'||replace(id::text,'-',''),to_char(statement_timestamp() AT TIME ZONE 'Asia/Shanghai','YYYYMMDDHH24MISS'),$6,expires_at
        FROM v2_payment_requests WHERE id=$1 AND user_id=$2 AND state='waiting' AND expires_at>statement_timestamp() RETURNING payment_id`,
          [
            input.paymentId,
            input.userId,
            input.environment,
            input.institutionNo,
            input.merchantNo,
            input.payType,
          ],
        );
        if (!inserted.rowCount) return null;
        return {
          order: order(
            (await tx.query<Row>(`${SELECT} WHERE o.payment_id=$1`, [payment.id])).rows[0]!,
          ),
          shouldSubmit: true,
        };
      }),
    async get(paymentId, userId) {
      const row = (
        await pool.query<Row>(`${SELECT} WHERE o.payment_id=$1 AND o.user_id=$2`, [
          paymentId,
          userId,
        ])
      ).rows[0];
      const fallback = (await recovered(pool, paymentId, userId)) ?? row;
      return fallback ? order(fallback) : null;
    },
    async findNotification(n) {
      const row = (
        await pool.query<Row>(
          `${SELECT} WHERE o.gateway_environment=$1 AND o.institution_no=$2 AND o.merchant_no=$3 AND o.pay_trace_no=$4 AND o.pay_time=$5`,
          [n.gatewayEnvironment, n.institutionNo, n.merchantNo, n.payTraceNo, n.payTime],
        )
      ).rows[0];
      return row ? order(row) : null;
    },
    recordSubmission: (original, result) =>
      withTransaction(pool, async (tx) => {
        if (options.recovery)
          await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))', [
            `v2-channel:${original.paymentId}`,
          ]);
        const row = (
          await tx.query<Row>(`${SELECT} WHERE o.payment_id=$1 FOR UPDATE OF o`, [
            original.paymentId,
          ])
        ).rows[0];
        if (!row) throw new ChannelConflictError();
        if (
          row.platform_trade_no &&
          result.platformTradeNo &&
          row.platform_trade_no !== result.platformTradeNo
        )
          throw new ChannelConflictError();
        const qr =
          result.status === 'pending' && result.action?.kind === 'code_url'
            ? result.action.value
            : null;
        const actionExpires =
          qr && result.action
            ? new Date(Math.min(result.action.expiresAt.getTime(), row.expires_at.getTime()))
            : null;
        // The authoritative accounting state wins over any late prepay response.
        if (row.completed || row.submission_state === 'failed') return;
        if (
          row.submission_state !== 'submitting' &&
          (!qr || !actionExpires || actionExpires.getTime() <= Date.now())
        )
          return;
        await tx.query(
          `UPDATE v2_payment_channel_orders SET submission_state=$2, platform_trade_no=COALESCE(platform_trade_no,$3),
        qr_content=CASE WHEN $5::timestamptz>statement_timestamp() THEN $4 ELSE NULL END,
        action_expires_at=CASE WHEN $5::timestamptz>statement_timestamp() THEN $5 ELSE NULL END WHERE payment_id=$1`,
          [original.paymentId, result.status, result.platformTradeNo ?? null, qr, actionExpires],
        );
        if (options.recovery)
          await tx.query(
            `UPDATE v2_payment_channel_attempts SET
          state=$2,platform_trade_no=COALESCE(platform_trade_no,$3),
          qr_content=CASE WHEN $5::timestamptz>statement_timestamp() THEN $4 ELSE NULL END,
          action_expires_at=CASE WHEN $5::timestamptz>statement_timestamp() THEN $5 ELSE NULL END,
          updated_at=clock_timestamp() WHERE id=$1 AND attempt_no=1
          AND (state='submitting' OR (state IN ('pending','unknown') AND $2='pending' AND $4::text IS NOT NULL AND $5::timestamptz>statement_timestamp()))
          AND (platform_trade_no IS NULL OR $3::text IS NULL OR platform_trade_no=$3::text)`,
            [
              original.paymentId,
              result.status === 'failed' ? 'closed' : result.status,
              result.platformTradeNo ?? null,
              qr,
              actionExpires,
            ],
          );
      }),
    recordResult: (original, result, event, source) =>
      withTransaction(pool, async (tx) => {
        if (options.recovery)
          await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))', [
            `v2-channel:${original.paymentId}`,
          ]);
        const row = (
          await tx.query<Row>(`${SELECT} WHERE o.payment_id=$1 FOR UPDATE OF o`, [
            original.paymentId,
          ])
        ).rows[0];
        if (
          !row ||
          (row.platform_trade_no &&
            result.platformTradeNo &&
            row.platform_trade_no !== result.platformTradeNo)
        )
          return false;
        if (result.status === 'succeeded' && !result.platformTradeNo) return false;
        await tx.query(
          `UPDATE v2_payment_channel_orders SET platform_trade_no=COALESCE(platform_trade_no,$2),
        submission_state=CASE WHEN $3='succeeded' THEN submission_state ELSE $3 END,
        query_lease_owner=CASE WHEN $4='query' THEN NULL ELSE query_lease_owner END,
        query_lease_until=CASE WHEN $4='query' THEN NULL ELSE query_lease_until END,
        next_query_at=CASE WHEN $4='query' THEN statement_timestamp()+interval '30 seconds' ELSE next_query_at END
        WHERE payment_id=$1`,
          [original.paymentId, result.platformTradeNo ?? null, result.status, source],
        );
        await tx.query(
          `INSERT INTO v2_payment_channel_events(event_fingerprint,payment_id,source,outcome) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [event, original.paymentId, source, result.status],
        );
        if (options.recovery)
          await tx.query(
            `UPDATE v2_payment_channel_attempts SET platform_trade_no=COALESCE(platform_trade_no,$2::text),
          state=CASE WHEN state='succeeded' OR (state='closed' AND close_verified AND $3<>'succeeded') THEN state
            WHEN $3='succeeded' THEN 'succeeded' WHEN state IN ('closing','manual_review') THEN state WHEN $3='failed' THEN 'closed' ELSE $3 END,
          updated_at=clock_timestamp() WHERE id=$1 AND attempt_no=1 AND (platform_trade_no IS NULL OR $2::text IS NULL OR platform_trade_no=$2::text)`,
            [original.paymentId, result.platformTradeNo ?? null, result.status],
          );
        const existing = (
          await tx.query<{ payment_id: string; source: string; outcome: string }>(
            `SELECT payment_id,source,outcome FROM v2_payment_channel_events WHERE event_fingerprint=$1`,
            [event],
          )
        ).rows[0];
        if (
          !existing ||
          existing.payment_id !== original.paymentId ||
          existing.source !== source ||
          existing.outcome !== result.status
        )
          throw new ChannelConflictError();
        return true;
      }),
    leaseQueries: (input) =>
      withTransaction(pool, async (tx) => {
        if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100)
          throw new ChannelConflictError();
        const rows = (
          await tx.query<Row>(
            `${SELECT} WHERE o.gateway_environment=$1 AND o.institution_no=$2 AND o.merchant_no=$3
        AND p.state<>'completed' AND o.query_attempts<120 AND o.created_at>statement_timestamp()-interval '24 hours'
        AND o.next_query_at<=statement_timestamp() AND (o.query_lease_until IS NULL OR o.query_lease_until<=statement_timestamp())
        ORDER BY o.next_query_at LIMIT $4 FOR UPDATE OF o SKIP LOCKED`,
            [input.environment, input.institutionNo, input.merchantNo, input.limit],
          )
        ).rows;
        for (const row of rows)
          await tx.query(
            `UPDATE v2_payment_channel_orders SET query_attempts=query_attempts+1,
        query_lease_owner=$2,query_lease_until=statement_timestamp()+interval '2 minutes' WHERE payment_id=$1`,
            [row.payment_id, input.owner],
          );
        return rows.map(order);
      }),
  };
}
