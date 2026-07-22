import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import type { Manifest } from '@cb/shared';
import type { CapabilityLoadError } from './loader.js';
import {
  getCreatorCapabilityVersionForStudioSource,
  getCreatorCapabilityVersionForTrial,
  getPublishedCapability,
} from './loader.js';
import { manifestHash } from './manifest-hash.js';

const MANIFEST: Manifest = {
  id: 'cap-1',
  version: '0.1.0',
  status: 'draft',
  inputs: {
    fields: [
      { key: 'topic', label: '主题', type: 'string', required: true, derivedFrom: 'instructions' },
    ],
  },
  output: { type: 'text' },
  boundaries: { riskLevel: 'low', redLines: ['no private data'] },
  name: '短视频脚本生成器',
  tagline: '按选题生成口播脚本',
  role: '内容策略助手',
  goal: '生成可直接试用的脚本草稿',
  instructions: '根据输入生成结构化脚本。',
  skill_set: ['拆解选题', '组织口播节奏'],
  starter_prompts: ['帮我写一条新品短视频脚本'],
};

function poolReturning(rows: unknown[]): Pool {
  return {
    query: async () => ({ rows }),
  } as unknown as Pool;
}

function poolCapturing(rows: unknown[], seen: { sql?: string; params?: unknown[] }): Pool {
  return {
    query: async (sql: string, params?: unknown[]) => {
      seen.sql = sql;
      seen.params = params;
      return { rows };
    },
  } as unknown as Pool;
}

describe('getPublishedCapability', () => {
  it('loads only the public view for a published capability', async () => {
    const loaded = await getPublishedCapability(
      poolReturning([
        {
          capability_id: 'cap-1',
          slug: 'short-video-script',
          version: '0.1.0',
          status: 'published',
          manifest: MANIFEST,
          manifest_hash: manifestHash(MANIFEST),
        },
      ]),
      'short-video-script',
    );

    expect(loaded?.view.instructions).toBe(MANIFEST.instructions);
    expect(loaded?.view.manifestHash).toBe(manifestHash(MANIFEST));
    expect(loaded?.publicView.slug).toBe('short-video-script');
    expect(loaded?.publicView.status).toBe('published');
    expect('instructions' in (loaded?.publicView as object)).toBe(false);
    expect('manifestHash' in (loaded?.publicView as object)).toBe(false);
    expect(loaded?.view.inputs.fields[0]?.derivedFrom).toBe('instructions');
    expect('derivedFrom' in (loaded?.publicView.inputs.fields[0] as object)).toBe(false);
  });

  it('guards direct public loads with the same source-signature dedupe policy used by market list', async () => {
    const seen: { sql?: string; params?: unknown[] } = {};
    await getPublishedCapability(poolCapturing([], seen), 'cap-old');

    expect(seen.params).toEqual(['cap-old']);
    expect(seen.sql).toContain('AND c.status =');
    expect(seen.sql).toContain('AND NOT EXISTS');
    expect(seen.sql).toContain('c2.creator_user_id = c.creator_user_id');
    expect(seen.sql).toContain('cc2.snapshot_id = cc.snapshot_id');
    expect(seen.sql).toContain('cc2.slug = cc.slug');
    expect(seen.sql).toContain(
      'COALESCE(ml2.updated_at, v2.updated_at) > COALESCE(ml.updated_at, v.updated_at)',
    );
  });
});

describe('getCreatorCapabilityVersionForTrial', () => {
  it('loads an owned complete draft version for creator trial', async () => {
    const loaded = await getCreatorCapabilityVersionForTrial(
      poolReturning([
        {
          capability_id: 'cap-1',
          slug: 'short-video-script',
          version: '0.1.0',
          status: 'draft',
          manifest: MANIFEST,
          manifest_hash: null,
        },
      ]),
      {
        capabilityId: 'cap-1',
        versionId: 'ver-1',
        creatorUserId: 'user-1',
      },
    );

    expect(loaded?.view.status).toBe('draft');
    expect(loaded?.view.manifestHash).toBe(manifestHash(MANIFEST));
    expect(loaded?.publicView.status).toBe('draft');
    expect(loaded?.publicView.slug).toBe('short-video-script');
  });

  it('loads an exact owned published version and preserves its frozen manifest hash', async () => {
    const frozenHash = manifestHash(MANIFEST);
    const seen: { sql?: string; params?: unknown[] } = {};
    const loaded = await getCreatorCapabilityVersionForTrial(
      poolCapturing(
        [
          {
            capability_id: 'cap-1',
            slug: 'short-video-script',
            version: '0.1.0',
            status: 'published',
            manifest: MANIFEST,
            manifest_hash: frozenHash,
          },
        ],
        seen,
      ),
      {
        capabilityId: 'cap-1',
        versionId: 'ver-1',
        creatorUserId: 'user-1',
      },
    );

    expect(seen.sql).toContain('c.id::text = $1');
    expect(seen.sql).toContain('v.id::text = $2');
    expect(seen.sql).toContain('c.creator_user_id = $3');
    expect(seen.sql).toContain(`v.status IN ('draft', 'published')`);
    expect(seen.params).toEqual(['cap-1', 'ver-1', 'user-1']);
    expect(loaded?.view.status).toBe('published');
    expect(loaded?.view.manifestHash).toBe(frozenHash);
    expect(loaded?.publicView.status).toBe('published');
  });

  it('rejects a published version whose frozen manifest hash no longer matches', async () => {
    await expect(
      getCreatorCapabilityVersionForTrial(
        poolReturning([
          {
            capability_id: 'cap-1',
            slug: 'short-video-script',
            version: '0.1.0',
            status: 'published',
            manifest: MANIFEST,
            manifest_hash: 'corrupt',
          },
        ]),
        {
          capabilityId: 'cap-1',
          versionId: 'ver-1',
          creatorUserId: 'user-1',
        },
      ),
    ).rejects.toMatchObject<Partial<CapabilityLoadError>>({ reason: 'integrity' });
  });

  it('rejects incomplete draft manifests', async () => {
    const loaded = await getCreatorCapabilityVersionForTrial(
      poolReturning([
        {
          capability_id: 'cap-1',
          slug: 'short-video-script',
          version: '0.1.0',
          status: 'draft',
          manifest: { ...MANIFEST, name: '' },
          manifest_hash: null,
        },
      ]),
      {
        capabilityId: 'cap-1',
        versionId: 'ver-1',
        creatorUserId: 'user-1',
      },
    );

    expect(loaded).toBeNull();
  });
});

describe('getCreatorCapabilityVersionForStudioSource', () => {
  it('creator 可以把精确被退回版作为修复 UI 的安全源', async () => {
    const frozenHash = manifestHash(MANIFEST);
    const seen: { sql?: string; params?: unknown[] } = {};
    const loaded = await getCreatorCapabilityVersionForStudioSource(
      poolCapturing(
        [
          {
            capability_id: 'cap-1',
            slug: 'short-video-script',
            version: '0.2.0',
            status: 'review_rejected',
            manifest: { ...MANIFEST, version: '0.2.0' },
            manifest_hash: manifestHash({ ...MANIFEST, version: '0.2.0' }),
          },
        ],
        seen,
      ),
      {
        capabilityId: 'cap-1',
        versionId: 'ver-rejected',
        creatorUserId: 'user-1',
      },
    );

    expect(seen.sql).toContain(`v.status IN ('published', 'review_rejected')`);
    expect(seen.params).toEqual(['cap-1', 'ver-rejected', 'user-1']);
    expect(loaded?.view.status).toBe('review_rejected');
    expect(loaded?.view.manifestHash).not.toBe(frozenHash);
  });

  it('拒绝被篡改的退回版 Studio 源', async () => {
    await expect(
      getCreatorCapabilityVersionForStudioSource(
        poolReturning([
          {
            capability_id: 'cap-1',
            slug: 'short-video-script',
            version: '0.2.0',
            status: 'review_rejected',
            manifest: { ...MANIFEST, version: '0.2.0' },
            manifest_hash: 'corrupt',
          },
        ]),
        {
          capabilityId: 'cap-1',
          versionId: 'ver-rejected',
          creatorUserId: 'user-1',
        },
      ),
    ).rejects.toMatchObject<Partial<CapabilityLoadError>>({ reason: 'integrity' });
  });
});
