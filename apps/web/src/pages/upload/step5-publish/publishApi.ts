// STEP⑤ 发布数据层（F-14）——接 50 域端点（单发布 + 市集卡预览）。批量发布已整体下线（2026-07-04 决策）。
//
// 端点真源（50 §2）：
//   - §2.1 `POST /versions/{versionId}/publish`（scope=publish.version）：单条发布门事务，同步返回 PublishResult。
//   - §2.2 `POST /versions/{versionId}/market-card/preview`：市集卡预览（只读、不写库、无 Idempotency-Key，§4.1 豁免）。
//   - §2.6.2 `GET /publications/{capabilityId}`：查发布态（创作者只读，拒绝提示 + 重试/编辑入口）。
//
// 合规：写命令必带 Idempotency-Key（client 注入）+ scope；预览是只读 POST（apiPostReadonly，无 scope）。
import {
  IdempotencyScope,
  type PublishResult,
  type PublishVersionBody,
  type MarketCard,
  type MarketCardPreviewBody,
  type PublicationView,
} from '@cb/shared';
import {
  apiGetEnvelope,
  apiPost,
  apiPostReadonly,
  type RequestOptions,
} from '../../../api/index.js';

/** §2.1 单发布路径。 */
export function publishPath(versionId: string): string {
  return `/versions/${encodeURIComponent(versionId)}/publish`;
}

/** §2.2 市集卡预览路径。 */
export function previewPath(versionId: string): string {
  return `/versions/${encodeURIComponent(versionId)}/market-card/preview`;
}

/**
 * §2.1 单条发布（发布门事务，同步返回；发布即「Alpha·审核中」）。
 * 写命令必带 scope=publish.version；重复点/刷新/双标签页回放首次（同 idempotencyKey，发布-20/贯穿-13/27）。
 * 失败保留已编辑封面/价格/软字段（前端态不清空）；点重试用同 key 重发原 body（§2.1 注）。
 */
export async function publishVersion(
  versionId: string,
  body: PublishVersionBody,
  idempotencyKey?: string,
  opts: RequestOptions = {},
): Promise<PublishResult> {
  return apiPost<PublishResult>(publishPath(versionId), body, {
    ...opts,
    scope: IdempotencyScope.PUBLISH_VERSION,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });
}

/**
 * §2.2 市集卡预览（只读 POST：带未持久化封面/价格预览入参，不写库、无 Idempotency-Key，§4.1 豁免）。
 * 封面/价格切换不丢由前端态承载（发布-10），本端点纯渲染投影。
 * 占位语义：卡上 installs/rating 恒为 null（发布-07），由 UI 经 UsagePlaceholder 兜底「上线后填充」文案，
 * 不依赖 meta.placeholders（apiPostReadonly 只解包 data；UsagePlaceholder 无 meta 时退化为默认占位句）。
 */
export async function previewMarketCard(
  versionId: string,
  body: MarketCardPreviewBody,
  opts: RequestOptions = {},
): Promise<MarketCard> {
  return apiPostReadonly<MarketCard>(previewPath(versionId), body, opts);
}

/**
 * §2.6.2 查发布态（创作者只读）：reviewStatus / rejectReason / rejectedVersionId（拒绝提示 + 重试/编辑入口，发布-31）。
 * reviewStatus='review_rejected' 时前端「编辑重发」指向 40 端点 A 带 fromVersionId=rejectedVersionId（派生新 draft）。
 */
export async function fetchPublication(
  capabilityId: string,
  opts: RequestOptions = {},
): Promise<PublicationView> {
  const { data } = await apiGetEnvelope<PublicationView>(
    `/publications/${encodeURIComponent(capabilityId)}`,
    opts,
  );
  return data;
}
