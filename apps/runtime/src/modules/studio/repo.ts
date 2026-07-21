import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type {
  ArtifactRef,
  StudioRevision,
  StudioState,
  StudioTest,
  StudioTestStatus,
} from '@cb/shared';

interface RevisionDbRow {
  id: string;
  revision_no: number;
  artifact_key: string;
  artifact_version: number;
  source_run_id: string | null;
  summary: string;
  created_at: Date;
  verified: boolean;
}

interface TestDbRow {
  id: string;
  revision_id: string;
  revision_no: number;
  test_session_id: string;
  run_id: string;
  status: StudioTestStatus;
  created_at: Date;
  completed_at: Date | null;
}

function toRevision(row: RevisionDbRow): StudioRevision {
  return {
    id: row.id,
    revisionNo: row.revision_no,
    artifactKey: row.artifact_key,
    artifactVersion: row.artifact_version,
    sourceRunId: row.source_run_id,
    summary: row.summary,
    createdAt: row.created_at.toISOString(),
    verified: row.verified,
  };
}

function toTest(row: TestDbRow): StudioTest {
  return {
    id: row.id,
    revisionId: row.revision_id,
    revisionNo: row.revision_no,
    testSessionId: row.test_session_id,
    runId: row.run_id,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  };
}

/**
 * A Studio revision is finalized only after the design turn and its UI message
 * have both been saved. source_run_id makes retries idempotent.
 */
export async function finalizeStudioRevision(
  pool: Pool,
  input: {
    studioSessionId: string;
    sourceRunId: string;
    artifact: ArtifactRef;
    summary: string;
  },
): Promise<StudioRevision> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT id FROM rt_chat_sessions WHERE id = $1 FOR UPDATE`, [
      input.studioSessionId,
    ]);

    const existing = await client.query<RevisionDbRow>(
      `SELECT r.*,
              EXISTS (
                SELECT 1 FROM rt_studio_tests t
                JOIN rt_chat_runs tr
                  ON tr.id = t.run_id
                 AND tr.session_id = t.test_session_id
                 AND tr.status = 'completed'
                JOIN rt_chat_messages tm
                  ON tm.run_id = tr.id
                 AND tm.session_id = t.test_session_id
                 AND tm.role = 'assistant'
                 WHERE t.revision_id = r.id
                   AND t.status = 'completed'
                   AND (
                     btrim(tm.text) <> ''
                     OR jsonb_array_length(COALESCE(tm.artifacts, '[]'::jsonb)) > 0
                   )
              ) AS verified
         FROM rt_studio_revisions r
        WHERE r.source_run_id = $1
        LIMIT 1`,
      [input.sourceRunId],
    );
    if (existing.rows[0]) {
      await client.query('COMMIT');
      return toRevision(existing.rows[0]);
    }

    const visibleArtifact = await client.query(
      `SELECT 1
         FROM rt_chat_messages m
        WHERE m.session_id = $1
          AND m.run_id = $2
          AND m.role = 'assistant'
          AND m.artifacts @> jsonb_build_array(
            jsonb_build_object(
              'artifactKey', $3::text,
              'version', $4::integer,
              'kind', $5::text,
              'title', $6::text
            )
          )
        LIMIT 1`,
      [
        input.studioSessionId,
        input.sourceRunId,
        input.artifact.artifactKey,
        input.artifact.version,
        input.artifact.kind,
        input.artifact.title,
      ],
    );
    if (!visibleArtifact.rows[0]) {
      throw new Error('finalizeStudioRevision: design artifact is not attached to the saved turn');
    }

    const inserted = await client.query<RevisionDbRow>(
      `INSERT INTO rt_studio_revisions (
         id, studio_session_id, revision_no, artifact_key, artifact_version,
         source_run_id, summary
       )
       SELECT $1, $2, COALESCE(MAX(revision_no), 0) + 1, $3, $4, $5, $6
         FROM rt_studio_revisions
        WHERE studio_session_id = $2
       RETURNING *, false AS verified`,
      [
        randomUUID(),
        input.studioSessionId,
        input.artifact.artifactKey,
        input.artifact.version,
        input.sourceRunId,
        input.summary.trim().slice(0, 240),
      ],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error('finalizeStudioRevision: insert returned no row');
    await client.query('COMMIT');
    return toRevision(row);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function getStudioRevision(
  pool: Pool,
  studioSessionId: string,
  revisionId: string,
): Promise<StudioRevision | null> {
  const result = await pool.query<RevisionDbRow>(
    `SELECT r.*,
            EXISTS (
              SELECT 1 FROM rt_studio_tests t
              JOIN rt_chat_runs tr
                ON tr.id = t.run_id
               AND tr.session_id = t.test_session_id
               AND tr.status = 'completed'
              JOIN rt_chat_messages tm
                ON tm.run_id = tr.id
               AND tm.session_id = t.test_session_id
               AND tm.role = 'assistant'
               WHERE t.revision_id = r.id
                 AND t.status = 'completed'
                 AND (
                   btrim(tm.text) <> ''
                   OR jsonb_array_length(COALESCE(tm.artifacts, '[]'::jsonb)) > 0
                 )
            ) AS verified
       FROM rt_studio_revisions r
      JOIN rt_chat_runs source_run
        ON source_run.id = r.source_run_id
       AND source_run.status = 'completed'
       AND source_run.input ->> 'intent' = 'design'
      WHERE r.id = $1 AND r.studio_session_id = $2
      LIMIT 1`,
    [revisionId, studioSessionId],
  );
  return result.rows[0] ? toRevision(result.rows[0]) : null;
}

export async function getStudioState(pool: Pool, studioSessionId: string): Promise<StudioState> {
  const [revisionsResult, testResult, activeRunResult] = await Promise.all([
    pool.query<RevisionDbRow>(
      `SELECT r.*,
              EXISTS (
                SELECT 1 FROM rt_studio_tests t
                JOIN rt_chat_runs tr
                  ON tr.id = t.run_id
                 AND tr.session_id = t.test_session_id
                 AND tr.status = 'completed'
                JOIN rt_chat_messages tm
                  ON tm.run_id = tr.id
                 AND tm.session_id = t.test_session_id
                 AND tm.role = 'assistant'
                 WHERE t.revision_id = r.id
                   AND t.status = 'completed'
                   AND (
                     btrim(tm.text) <> ''
                     OR jsonb_array_length(COALESCE(tm.artifacts, '[]'::jsonb)) > 0
                   )
              ) AS verified
         FROM rt_studio_revisions r
        JOIN rt_chat_runs source_run
          ON source_run.id = r.source_run_id
         AND source_run.status = 'completed'
         AND source_run.input ->> 'intent' = 'design'
        WHERE r.studio_session_id = $1
        ORDER BY r.revision_no ASC`,
      [studioSessionId],
    ),
    pool.query<TestDbRow>(
      `SELECT t.*, r.revision_no
         FROM rt_studio_tests t
         JOIN rt_studio_revisions r ON r.id = t.revision_id
        WHERE t.studio_session_id = $1
        ORDER BY t.created_at DESC
        LIMIT 1`,
      [studioSessionId],
    ),
    pool.query<{ id: string }>(
      `SELECT id
         FROM rt_chat_runs
        WHERE session_id = $1
          AND status IN ('queued', 'running')
          AND input ->> 'intent' = 'design'
        ORDER BY created_at DESC
        LIMIT 1`,
      [studioSessionId],
    ),
  ]);

  const revisions = revisionsResult.rows.map(toRevision);
  return {
    sessionId: studioSessionId,
    revisions,
    currentRevision: revisions.at(-1) ?? null,
    latestTest: testResult.rows[0] ? toTest(testResult.rows[0]) : null,
    activeDesignRunId: activeRunResult.rows[0]?.id ?? null,
  };
}

export async function createStudioTestRecord(
  pool: Pool,
  input: {
    studioSessionId: string;
    revisionId: string;
    testSessionId: string;
    runId: string;
  },
): Promise<StudioTest> {
  const result = await pool.query<TestDbRow>(
    `WITH target AS (
       SELECT id, revision_no
         FROM rt_studio_revisions
        WHERE id = $5 AND studio_session_id = $2
     ), inserted AS (
       INSERT INTO rt_studio_tests (
         id, studio_session_id, revision_id, test_session_id, run_id, status
       )
       SELECT $1, $2, target.id, $3, $4, 'running'
         FROM target
       RETURNING *
     )
     SELECT inserted.*, target.revision_no
       FROM inserted
       JOIN target ON target.id = inserted.revision_id`,
    [randomUUID(), input.studioSessionId, input.testSessionId, input.runId, input.revisionId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('createStudioTestRecord: revision does not belong to Studio');
  return toTest(row);
}

export async function setStudioTestStatus(
  pool: Pool,
  runId: string,
  status: Exclude<StudioTestStatus, 'running'>,
): Promise<void> {
  await pool.query(
    `UPDATE rt_studio_tests
        SET status = $2,
            completed_at = COALESCE(completed_at, now())
      WHERE run_id = $1`,
    [runId, status],
  );
}

export async function isStudioTestSession(pool: Pool, sessionId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
       FROM rt_studio_tests
      WHERE test_session_id = $1
      LIMIT 1`,
    [sessionId],
  );
  return Boolean(result.rows[0]);
}

export async function discardStudioRevisionForRun(pool: Pool, sourceRunId: string): Promise<void> {
  await pool.query(`DELETE FROM rt_studio_revisions WHERE source_run_id = $1`, [sourceRunId]);
}
