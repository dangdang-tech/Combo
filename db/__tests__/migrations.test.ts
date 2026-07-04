import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

function files(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}
function allSql(): string {
  return files()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf-8'))
    .join('\n');
}

// 2026-07-04 基线合并：原 0000-0018 已合并为 0000_baseline_schema.sql（由生产库 pg_dump 生成并经
// 空库重放 diff 验证）。本套测试改为守护基线完整性；此后新增迁移按编号追加，本文件按需补断言。

const ACTIVE_TABLES = [
  // 核心基表
  'users',
  'jobs',
  'idempotency_keys',
  // 导入域
  'raw_snapshots',
  'session_segments',
  'import_pairings',
  'import_uploads',
  // 提取域
  'capability_candidates',
  'candidate_evidence',
  // 结构化域
  'drafts',
  'capabilities',
  'capability_versions',
  // 发布域
  'publications',
  'marketplace_listings',
  // 社交/主页域（功能已上线、未被触发）
  'creator_profiles',
  'follows',
  'likes',
  // 事件与基础设施域
  'outbox_events',
  'consumer_cursors',
  'dead_events',
  'notifications',
  'notification_channels',
  'audit_llm_calls',
  // 试用端 runtime
  'rt_chat_sessions',
  'rt_chat_messages',
  'rt_chat_artifacts',
  'rt_chat_artifact_versions',
  'rt_chat_runs',
  'rt_chat_run_events',
];

// 已删除的表（0017 冻结预留 / 0018 定价与批量发布）绝不允许回潮进 schema。
const DROPPED_TABLES = [
  'artifacts',
  'usage_events',
  'runtime_sessions',
  'daily_capability_stats',
  'daily_creator_consumers',
  'daily_creator_llm_stats',
  'experience_pack_item_sources',
  'experience_pack_items',
  'experience_packs',
  'eval_reports',
  'creator_capability_cooccur',
  'capability_tiers',
  'publish_batches',
  'publish_batch_items',
];

describe('migrations', () => {
  it('are ordered by numeric prefix, baseline first', () => {
    const list = files();
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0]).toBe('0000_baseline_schema.sql');
    const prefixes = list.map((f) => f.slice(0, 4));
    expect(prefixes).toEqual([...prefixes].sort());
  });

  it(`baseline defines all ${ACTIVE_TABLES.length} active tables`, () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '0000_baseline_schema.sql'), 'utf-8');
    for (const t of ACTIVE_TABLES) {
      expect(sql, `missing table ${t}`).toContain(`CREATE TABLE public.${t} (`);
    }
    // 全量对齐：基线里的 CREATE TABLE 数量与活跃表清单一致（多一张都算漂移）。
    expect(sql.match(/CREATE TABLE /g)?.length).toBe(ACTIVE_TABLES.length);
  });

  it('dropped tables never come back', () => {
    const sql = allSql();
    for (const t of DROPPED_TABLES) {
      expect(sql, `dropped table ${t} reappeared`).not.toContain(`CREATE TABLE public.${t} (`);
    }
    // jobs.type 枚举不再含 publish_batch。
    expect(sql).not.toMatch(/'publish_batch'/);
  });

  it('keeps §11.E lineage composite constraints (fixed names)', () => {
    const sql = allSql();
    for (const name of [
      'uq_session_segments_id_snapshot',
      'uq_candidates_id_snapshot',
      'fk_evidence_candidate_snapshot',
      'fk_evidence_segment_snapshot',
      'uq_capability_versions_capability_id',
      'fk_publications_capability_version',
      'fk_listings_capability_version',
      'fk_capabilities_current_version',
    ]) {
      expect(sql).toContain(name);
    }
  });

  it('keeps structure job version-level hard lock (partial unique index)', () => {
    const sql = allSql();
    expect(sql).toContain('uq_structure_job_active_version');
    expect(sql).toMatch(/subject_ref ->> 'versionId'/);
  });

  it('keeps version-level frozen cover + visibility on capability_versions', () => {
    const sql = allSql();
    for (const name of ['cover_source', 'cover_asset_key', 'cover_snapshot_ref']) {
      expect(sql).toContain(name);
    }
    expect(sql).toContain('ck_capver_cover_source');
    expect(sql).toContain('ck_capver_visibility');
  });

  it('provides gen_uuid_v7 helper in the baseline', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '0000_baseline_schema.sql'), 'utf-8');
    expect(sql).toContain('CREATE FUNCTION public.gen_uuid_v7()');
  });
});
