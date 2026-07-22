// 会话 / 对话消息持久化（rt_chat_sessions / rt_chat_messages）。owner-scoped 读写。
//   transcript：pi AgentMessage[] 原始转录（rehydrate agent）；rt_chat_messages：UI 形态消息（渲染对话流）。
//   两者各服务一端：saveTurn 在同事务里一并落，断线重载会话也能拿到一致结果。
import type { Pool, PoolClient } from 'pg';
import type {
  ArtifactRef,
  PublicCapabilityView,
  RuntimeMessage,
  RuntimeSessionListItem,
  RuntimeSessionMeta,
  RuntimeSessionMode,
} from '@cb/shared';

type SessionQueryClient = Pick<Pool, 'query'>;

export interface CreateSessionInput {
  ownerId: string;
  capabilityId: string;
  slug: string;
  version: string;
  title: string;
  mode?: RuntimeSessionMode;
  /** 冻结的系统提示词快照（注入 pi）。 */
  instructions: string;
  /** 冻结的内容指纹（开会话时记下）。 */
  manifestHash: string;
  publicView: PublicCapabilityView;
}

/** 会话内部行（含服务端机密 instructions / 原始 transcript），仅服务端用。 */
export interface SessionRow {
  id: string;
  ownerId: string;
  capabilityId: string;
  slug: string;
  version: string;
  mode: RuntimeSessionMode;
  title: string;
  instructions: string;
  manifestHash: string;
  publicView: PublicCapabilityView;
  /** pi AgentMessage[]（plain JSON），build-agent 据此 rehydrate。 */
  transcript: unknown[];
  createdAt: string;
  updatedAt: string;
}

interface SessionDbRow {
  id: string;
  owner_id: string;
  capability_id: string;
  slug: string;
  version: string;
  title: string;
  mode: RuntimeSessionMode;
  instructions: string;
  manifest_hash: string;
  public_view: PublicCapabilityView;
  transcript: unknown[];
  created_at: Date;
  updated_at: Date;
}

interface TrialSessionDbRow extends SessionDbRow {
  trial_verified: boolean;
}

export interface TrialSessionLookup {
  row: SessionRow;
  verified: boolean;
}

function toRow(r: SessionDbRow): SessionRow {
  return {
    id: r.id,
    ownerId: r.owner_id,
    capabilityId: r.capability_id,
    slug: r.slug,
    version: r.version,
    mode: r.mode,
    title: r.title,
    instructions: r.instructions,
    manifestHash: r.manifest_hash,
    publicView: r.public_view,
    transcript: Array.isArray(r.transcript) ? r.transcript : [],
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

function toMeta(r: SessionRow): RuntimeSessionMeta {
  return {
    id: r.id,
    capabilityId: r.capabilityId,
    slug: r.slug,
    version: r.version,
    mode: r.mode,
    title: r.title,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function createSession(
  pool: SessionQueryClient,
  input: CreateSessionInput,
): Promise<RuntimeSessionMeta> {
  const res = await pool.query<SessionDbRow>(
    `INSERT INTO rt_chat_sessions
       (owner_id, capability_id, slug, version, mode, title, instructions, manifest_hash, public_view)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     RETURNING *`,
    [
      input.ownerId,
      input.capabilityId,
      input.slug,
      input.version,
      input.mode ?? 'consume',
      input.title,
      input.instructions,
      input.manifestHash,
      JSON.stringify(input.publicView),
    ],
  );
  const row = res.rows[0];
  if (!row) throw new Error('createSession: insert returned no row');
  return toMeta(toRow(row));
}

/** 查找同 owner/capability/version/manifest 下尚未产生消息的 trial 空会话；用于刷新复用。 */
export async function findEmptyTrialSession(
  pool: Pool,
  input: { ownerId: string; capabilityId: string; version: string; manifestHash: string },
): Promise<RuntimeSessionMeta | null> {
  const res = await pool.query<SessionDbRow>(
    `SELECT *
       FROM rt_chat_sessions s
      WHERE s.owner_id = $1
        AND s.capability_id = $2
        AND s.version = $3
        AND s.manifest_hash = $4
        AND s.mode = 'trial'
        AND s.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM rt_chat_messages m WHERE m.session_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM rt_chat_runs r WHERE r.session_id = s.id)
        AND NOT EXISTS (
          SELECT 1 FROM rt_studio_tests child WHERE child.test_session_id = s.id
        )
      ORDER BY s.updated_at DESC
      LIMIT 1`,
    [input.ownerId, input.capabilityId, input.version, input.manifestHash],
  );
  const row = res.rows[0];
  return row ? toMeta(toRow(row)) : null;
}

/**
 * 恢复创作流程中某个不可变版本 manifest 对应的试用 Session。
 *
 * - owner + capability + 语义版本 + manifest hash 四重守门，避免旧版本或他人的 Session 被复用；
 * - 有 sessionId 时只核对回流的那一条；无 sessionId 时恢复最近更新的 Session，保留最新工作位置；
 * - verified 只描述选中的这条 Session，且必须同时存在 completed run 与该 run 落下的有效 assistant 输出。
 */
export async function findTrialSessionForVersion(
  pool: Pool,
  input: {
    ownerId: string;
    capabilityId: string;
    version: string;
    manifestHash: string;
    sessionId?: string;
  },
): Promise<TrialSessionLookup | null> {
  const params: unknown[] = [input.ownerId, input.capabilityId, input.version, input.manifestHash];
  let sessionFilter = '';
  if (input.sessionId) {
    params.push(input.sessionId);
    sessionFilter = `AND s.id = COALESCE(
      (
        SELECT child.studio_session_id
          FROM rt_studio_tests child
         WHERE child.test_session_id = $${params.length}
         LIMIT 1
      ),
      $${params.length}::uuid
    )`;
  }

  const res = await pool.query<TrialSessionDbRow>(
    `SELECT s.*,
            CASE
              WHEN EXISTS (
                SELECT 1
                  FROM rt_studio_revisions sr
                  JOIN rt_chat_runs sr_source
                    ON sr_source.id = sr.source_run_id
                   AND sr_source.status = 'completed'
                   AND sr_source.input ->> 'intent' = 'design'
                 WHERE sr.studio_session_id = s.id
              )
              THEN EXISTS (
                SELECT 1
                  FROM rt_studio_revisions sr
                  JOIN rt_chat_runs sr_source
                    ON sr_source.id = sr.source_run_id
                   AND sr_source.status = 'completed'
                   AND sr_source.input ->> 'intent' = 'design'
                  JOIN rt_studio_tests st
                    ON st.revision_id = sr.id
                   AND st.studio_session_id = s.id
                   AND st.status = 'completed'
                  JOIN rt_chat_runs r
                    ON r.id = st.run_id
                   AND r.session_id = st.test_session_id
                   AND r.owner_id = s.owner_id
                   AND r.status = 'completed'
                  JOIN rt_chat_messages m
                    ON m.run_id = r.id
                   AND m.session_id = st.test_session_id
                   AND m.role = 'assistant'
                 WHERE sr.studio_session_id = s.id
                   AND sr.revision_no = (
                     SELECT MAX(current.revision_no)
                       FROM rt_studio_revisions current
                       JOIN rt_chat_runs current_source
                         ON current_source.id = current.source_run_id
                        AND current_source.status = 'completed'
                        AND current_source.input ->> 'intent' = 'design'
                      WHERE current.studio_session_id = s.id
                   )
                   AND (
                     btrim(m.text) <> ''
                     OR jsonb_array_length(COALESCE(m.artifacts, '[]'::jsonb)) > 0
                   )
              )
              ELSE EXISTS (
                SELECT 1
                  FROM rt_chat_messages m
                  JOIN rt_chat_runs r
                    ON r.id = m.run_id
                   AND r.session_id = s.id
                   AND r.owner_id = s.owner_id
                 WHERE m.session_id = s.id
                   AND m.role = 'assistant'
                   AND r.status = 'completed'
                   AND COALESCE(r.input ->> 'intent', 'capability') <> 'design'
                   AND (
                     btrim(m.text) <> ''
                     OR jsonb_array_length(COALESCE(m.artifacts, '[]'::jsonb)) > 0
                   )
              )
            END AS trial_verified
       FROM rt_chat_sessions s
      WHERE s.owner_id = $1
        AND s.capability_id = $2
        AND s.version = $3
        AND s.manifest_hash = $4
        AND s.mode = 'trial'
        AND s.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM rt_studio_tests child WHERE child.test_session_id = s.id
        )
        ${sessionFilter}
      ORDER BY s.updated_at DESC, s.id DESC
      LIMIT 1`,
    params,
  );
  const row = res.rows[0];
  return row ? { row: toRow(row), verified: row.trial_verified } : null;
}

/**
 * 恢复指定冻结快照下的 Design Studio，不将普通试用会话当作 UI 工作区。
 *
 * Studio 的可持久边界是已完成 design run 生成的 Revision：
 * - owner / capability / semantic version / manifest hash 必须与当前创作版本完全一致；
 * - 没有 Revision 的普通 trial 或失败 Design 不恢复，让调用方可以创建干净工作区；
 * - Studio test 子会话始终排除。
 */
export async function findStudioTrialSessionForVersion(
  pool: SessionQueryClient,
  input: { ownerId: string; capabilityId: string; version: string; manifestHash: string },
): Promise<RuntimeSessionMeta | null> {
  const res = await pool.query<SessionDbRow>(
    `SELECT s.*
       FROM rt_chat_sessions s
      WHERE s.owner_id = $1
        AND s.capability_id = $2
        AND s.version = $3
        AND s.manifest_hash = $4
        AND s.mode = 'trial'
        AND s.status = 'active'
        AND EXISTS (
          SELECT 1
            FROM rt_studio_revisions revision
            JOIN rt_chat_runs source_run
              ON source_run.id = revision.source_run_id
             AND source_run.session_id = s.id
             AND source_run.owner_id = s.owner_id
             AND source_run.status = 'completed'
             AND source_run.input ->> 'intent' = 'design'
            JOIN rt_chat_artifacts artifact
              ON artifact.session_id = s.id
             AND artifact.artifact_key = revision.artifact_key
             AND artifact.kind = 'html'
            JOIN rt_chat_artifact_versions artifact_version
              ON artifact_version.artifact_id = artifact.id
             AND artifact_version.version = revision.artifact_version
             AND artifact_version.kind = 'html'
            JOIN rt_chat_messages assistant_message
              ON assistant_message.session_id = s.id
             AND assistant_message.run_id = source_run.id
             AND assistant_message.role = 'assistant'
             AND assistant_message.artifacts @> jsonb_build_array(
               jsonb_build_object(
                 'artifactKey', revision.artifact_key,
                 'version', revision.artifact_version,
                 'kind', 'html',
                 'title', artifact_version.title
               )
             )
           WHERE revision.studio_session_id = s.id
             AND revision.artifact_key = 'main'
        )
        AND NOT EXISTS (
          SELECT 1 FROM rt_studio_tests child WHERE child.test_session_id = s.id
        )
      ORDER BY s.updated_at DESC, s.id DESC
      LIMIT 1`,
    [input.ownerId, input.capabilityId, input.version, input.manifestHash],
  );
  const row = res.rows[0];
  return row ? toMeta(toRow(row)) : null;
}

/** owner-scoped 取会话内部行（含 instructions/transcript），不存在或非本人 → null。 */
export async function getSessionRow(
  pool: Pool,
  id: string,
  ownerId: string,
): Promise<SessionRow | null> {
  const res = await pool.query<SessionDbRow>(
    `SELECT *
       FROM rt_chat_sessions
      WHERE id = $1
        AND owner_id = $2
        AND status = 'active'
      LIMIT 1`,
    [id, ownerId],
  );
  const row = res.rows[0];
  return row ? toRow(row) : null;
}

/**
 * 只读会话的不可变访问模式，用于详情路由在 owner-scoped 查询前选择鉴权策略。
 * 不返回 owner / capability / 内容，且归档会话按不存在处理。
 */
export async function getSessionMode(pool: Pool, id: string): Promise<RuntimeSessionMode | null> {
  const res = await pool.query<{ mode: RuntimeSessionMode }>(
    `SELECT mode
       FROM rt_chat_sessions
      WHERE id = $1
        AND status = 'active'
      LIMIT 1`,
    [id],
  );
  return res.rows[0]?.mode ?? null;
}

export async function getSessionMeta(
  pool: Pool,
  id: string,
  ownerId: string,
): Promise<RuntimeSessionMeta | null> {
  const row = await getSessionRow(pool, id, ownerId);
  return row ? toMeta(row) : null;
}

export async function listSessions(
  pool: Pool,
  ownerId: string,
  opts: { capabilityId?: string; mode?: RuntimeSessionMode; slug?: string } = {},
): Promise<RuntimeSessionListItem[]> {
  const filters: string[] = [`owner_id = $1`, `status = 'active'`];
  const params: unknown[] = [ownerId];
  if (opts.capabilityId) {
    params.push(opts.capabilityId);
    filters.push(`capability_id = $${params.length}`);
  }
  if (opts.mode) {
    params.push(opts.mode);
    filters.push(`mode = $${params.length}`);
  }
  if (opts.slug) {
    params.push(opts.slug);
    filters.push(`slug = $${params.length}`);
  }
  const res = await pool.query<{
    id: string;
    slug: string;
    mode: RuntimeSessionMode;
    title: string;
    capability_name: string;
    updated_at: Date;
  }>(
    `SELECT id, slug, mode, title, COALESCE(public_view ->> 'name', '') AS capability_name, updated_at
       FROM rt_chat_sessions s
      WHERE ${filters.join(' AND ')}
        -- 只列有内容的会话：每次打开/刷新 /try/:slug 都会建一条空会话，过滤掉空壳避免侧栏堆垃圾。
        AND EXISTS (SELECT 1 FROM rt_chat_messages m WHERE m.session_id = s.id)
        AND NOT EXISTS (
          SELECT 1 FROM rt_studio_tests child WHERE child.test_session_id = s.id
        )
      ORDER BY updated_at DESC
      LIMIT 100`,
    params,
  );
  return res.rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    mode: r.mode,
    title: r.title,
    capabilityName: r.capability_name,
    updatedAt: r.updated_at.toISOString(),
  }));
}

export async function getMessages(pool: Pool, sessionId: string): Promise<RuntimeMessage[]> {
  const res = await pool.query<{
    id: string;
    run_id: string | null;
    seq: number;
    role: 'user' | 'assistant';
    text: string;
    artifacts: ArtifactRef[];
    created_at: Date;
  }>(
    `SELECT id, run_id, seq, role, text, artifacts, created_at
       FROM rt_chat_messages
      WHERE session_id = $1
      ORDER BY seq ASC`,
    [sessionId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    seq: r.seq,
    role: r.role,
    text: r.text,
    artifacts: Array.isArray(r.artifacts) ? r.artifacts : [],
    createdAt: r.created_at.toISOString(),
  }));
}

export async function getMessagesPage(
  pool: Pool,
  sessionId: string,
  opts: { cursor?: number; limit?: number },
): Promise<{ items: RuntimeMessage[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const cursor = opts.cursor ?? 0;
  const res = await pool.query<{
    id: string;
    run_id: string | null;
    seq: number;
    role: 'user' | 'assistant';
    text: string;
    artifacts: ArtifactRef[];
    created_at: Date;
  }>(
    `SELECT id, run_id, seq, role, text, artifacts, created_at
       FROM rt_chat_messages
      WHERE session_id = $1 AND seq > $2
      ORDER BY seq ASC
      LIMIT $3`,
    [sessionId, cursor, limit + 1],
  );
  const rows = res.rows.slice(0, limit);
  const items = rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    seq: r.seq,
    role: r.role,
    text: r.text,
    artifacts: Array.isArray(r.artifacts) ? r.artifacts : [],
    createdAt: r.created_at.toISOString(),
  }));
  const extra = res.rows.length > limit;
  return {
    items,
    nextCursor: extra && rows.length > 0 ? String(rows[rows.length - 1]?.seq) : null,
  };
}

/** 当前最大 seq（无消息 → 0）。run-turn 据此分配 user/assistant 两条消息序号。 */
export async function maxSeq(pool: Pool, sessionId: string): Promise<number> {
  const res = await pool.query<{ m: number | null }>(
    `SELECT MAX(seq) AS m FROM rt_chat_messages WHERE session_id = $1`,
    [sessionId],
  );
  return res.rows[0]?.m ?? 0;
}

export interface SaveTurnInput {
  sessionId: string;
  runId?: string | null;
  user: { id: string; text: string };
  assistant: { id: string; text: string; artifacts: ArtifactRef[] };
  /** 落库的完整 pi 转录（含本回合）。 */
  transcript: unknown[];
}

export interface SaveTurnResult {
  user: RuntimeMessage;
  assistant: RuntimeMessage;
}

/** 一回合落库（单事务）：写 user/assistant 两条 UI 消息 + 更新 transcript + 首条时补默认标题。 */
export async function saveTurn(pool: Pool, input: SaveTurnInput): Promise<SaveTurnResult> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    // 锁会话行，串行化本会话的并发回合 → seq 在锁内分配，杜绝 (session_id, seq) 撞车（旧实现把 maxSeq 读在事务外，
    //   两个并发回合会读到同一 base、各自 INSERT 同一 seq，后者违反唯一约束整回合回滚、用户答复被静默丢弃）。
    await client.query(`SELECT id FROM rt_chat_sessions WHERE id = $1 FOR UPDATE`, [
      input.sessionId,
    ]);
    const seqRes = await client.query<{ m: number | null }>(
      `SELECT MAX(seq) AS m FROM rt_chat_messages WHERE session_id = $1`,
      [input.sessionId],
    );
    const base = seqRes.rows[0]?.m ?? 0;
    const userSeq = base + 1;
    const assistantSeq = base + 2;

    const u = await client.query<{ created_at: Date }>(
      `INSERT INTO rt_chat_messages (id, session_id, run_id, seq, role, text, artifacts)
       VALUES ($1, $2, $3, $4, 'user', $5, '[]'::jsonb)
       RETURNING created_at`,
      [input.user.id, input.sessionId, input.runId ?? null, userSeq, input.user.text],
    );
    const a = await client.query<{ created_at: Date }>(
      `INSERT INTO rt_chat_messages (id, session_id, run_id, seq, role, text, artifacts)
       VALUES ($1, $2, $3, $4, 'assistant', $5, $6::jsonb)
       RETURNING created_at`,
      [
        input.assistant.id,
        input.sessionId,
        input.runId ?? null,
        assistantSeq,
        input.assistant.text,
        JSON.stringify(input.assistant.artifacts),
      ],
    );

    // 标题：仍是默认「新会话」时，用首条用户输入前 30 字补一个可读标题。
    const derivedTitle = input.user.text.trim().slice(0, 30) || '新会话';
    await client.query(
      `UPDATE rt_chat_sessions
          SET transcript = $1::jsonb,
              updated_at = now(),
              title = CASE WHEN title = '新会话' THEN $2 ELSE title END
        WHERE id = $3`,
      [JSON.stringify(input.transcript), derivedTitle, input.sessionId],
    );

    await client.query('COMMIT');

    const uCreated = u.rows[0]?.created_at ?? new Date();
    const aCreated = a.rows[0]?.created_at ?? new Date();
    return {
      user: {
        id: input.user.id,
        runId: input.runId ?? null,
        seq: userSeq,
        role: 'user',
        text: input.user.text,
        artifacts: [],
        createdAt: uCreated.toISOString(),
      },
      assistant: {
        id: input.assistant.id,
        runId: input.runId ?? null,
        seq: assistantSeq,
        role: 'assistant',
        text: input.assistant.text,
        artifacts: input.assistant.artifacts,
        createdAt: aCreated.toISOString(),
      },
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function updateSessionTitle(
  pool: Pool,
  id: string,
  ownerId: string,
  title: string,
): Promise<RuntimeSessionMeta | null> {
  const res = await pool.query<SessionDbRow>(
    `UPDATE rt_chat_sessions
        SET title = $3, updated_at = now()
      WHERE id = $1 AND owner_id = $2 AND status = 'active'
      RETURNING *`,
    [id, ownerId, title],
  );
  const row = res.rows[0];
  return row ? toMeta(toRow(row)) : null;
}

export async function archiveSession(pool: Pool, id: string, ownerId: string): Promise<boolean> {
  const res = await pool.query(
    `UPDATE rt_chat_sessions
        SET status = 'archived', updated_at = now()
      WHERE id = $1 AND owner_id = $2 AND status = 'active'`,
    [id, ownerId],
  );
  return (res.rowCount ?? 0) > 0;
}
