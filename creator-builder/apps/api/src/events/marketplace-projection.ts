// B-14 · MarketplaceProjection（消费 capability.*，lifecycle，70 §1/§3；50 §5.1 投影约定）。
//   - capability.published：upsert marketplace_listings（标 alpha_pending/published、刷新 card，
//     ON CONFLICT (capability_id) DO UPDATE，event_id 幂等）。card 源自被发布版的 manifest
//     （capability_versions.manifest，权威；slug 由 trg_listing_slug 与 capabilities.slug 焊死，
//     不靠 payload，Codex#16）。投影是事务外异步、最终一致（贯穿-26）。
//   - capability.unpublished：评审拒绝且无上一版 → status→delisted 软删（保留行便于审计，50 §5.1）。
//   - lifecycle 毒丸语义在 consumer-core 处理（卡住等人工、不进死信），本处只写投影副作用。
// 副作用必须在传入的【同一事务 tx】内完成（cursor 与处理同事务，§3.3）。
import {
  CapabilityPublishedPayloadSchema,
  CapabilityUnpublishedPayloadSchema,
  type CapabilityPublishedPayload,
} from '@cb/shared';
import type { EventProcessor, FetchedEvent } from './consumer-core.js';
import type { Tx } from './db-tx.js';

/**
 * 投影写入：发布上架（幂等 upsert listing）。
 *   - card 取被发布版 manifest（INSERT…SELECT，card NOT NULL 由版本 manifest 兜底）。
 *   - slug 列由 trg_listing_slug 在 INSERT/UPDATE OF capability_id 时强制 = capabilities.slug
 *     （payload.slug 仅占位满足 NOT NULL；不依赖其值）。
 *   - status 来自 payload.reviewStatus（alpha_pending → published）。
 *   - 复合 FK (capability_id, version_id) → capability_versions(capability_id, id) 由 50 域焊死。
 *   - 找不到对应版本（被引用版不存在）→ INSERT…SELECT 0 行：抛错让 lifecycle 卡住等人工（不放错状态）。
 */
async function projectPublished(tx: Tx, p: CapabilityPublishedPayload): Promise<void> {
  const res = await tx.query(
    `INSERT INTO marketplace_listings
       (capability_id, version_id, slug, card, status, updated_at)
     SELECT v.capability_id, v.id, $3, v.manifest, $4, now()
     FROM capability_versions v
     WHERE v.capability_id = $1 AND v.id = $2
     ON CONFLICT (capability_id)
     DO UPDATE SET version_id = EXCLUDED.version_id,
                   card = EXCLUDED.card,
                   status = EXCLUDED.status,
                   updated_at = now()`,
    [p.capabilityId, p.versionId, p.slug, p.reviewStatus],
  );
  if ((res.rowCount ?? 0) === 0) {
    // 被发布版不存在（理论不可达：发布事务已写版本）。lifecycle 宁卡住等人工、不放错状态。
    throw new Error('marketplace projection: published version not found');
  }
}

/** 投影写入：下架（评审拒绝且无上一版 → status→delisted 软删，保留行便于审计，50 §5.1）。 */
async function projectUnpublished(tx: Tx, capabilityId: string): Promise<void> {
  await tx.query(
    `UPDATE marketplace_listings
     SET status = 'delisted', updated_at = now()
     WHERE capability_id = $1`,
    [capabilityId],
  );
}

/** MarketplaceProjection processor（按 topic 路由 payload schema 解析后投影）。 */
export const marketplaceProjection: EventProcessor = async (
  tx: Tx,
  evt: FetchedEvent,
): Promise<void> => {
  if (evt.topic === 'capability.published') {
    const p = CapabilityPublishedPayloadSchema.parse(evt.payload);
    await projectPublished(tx, p);
    return;
  }
  if (evt.topic === 'capability.unpublished') {
    const p = CapabilityUnpublishedPayloadSchema.parse(evt.payload);
    await projectUnpublished(tx, p.capabilityId);
    return;
  }
  // 非 capability.* 不该路由到此 processor（consumer 注册按 topic 分流）；防御性忽略。
};
