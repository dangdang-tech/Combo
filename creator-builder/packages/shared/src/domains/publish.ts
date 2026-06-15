// 50 · STEP⑤ 发布域（B-27~B-31）。import 脊柱 §9，不重定义。
import { z } from 'zod';
import { IdSchema, SlugSchema, IsoDateTimeSchema } from '../core/ids.js';
import { JobStatusSchema } from '../core/jobs.js';
import { ErrorBodySchema } from '../core/errors.js';

// ───────── 版本 / 发布态 ─────────
export const VersionStatusSchema = z.enum(['draft', 'published', 'superseded', 'review_rejected']);
export type VersionStatus = z.infer<typeof VersionStatusSchema>;

export const VisibilitySchema = z.enum(['public', 'unlisted']);
export type Visibility = z.infer<typeof VisibilitySchema>;

export const ReviewStatusSchema = z.enum(['alpha_pending', 'published', 'review_rejected']);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export const PublicationViewSchema = z.object({
  capabilityId: IdSchema,
  currentVersionId: IdSchema.describe('当前对外滚动指向版（拒绝回退会改，§1.3）'),
  slug: SlugSchema,
  shareToken: z.string(),
  visibility: VisibilitySchema,
  reviewStatus: ReviewStatusSchema,
  rejectReason: z.string().optional().describe('最近一次被拒原因人话镜像（B-30）'),
  rejectedVersionId: IdSchema.optional(),
  rejectedAt: IsoDateTimeSchema.optional(),
  publishedAt: IsoDateTimeSchema,
  reviewedAt: IsoDateTimeSchema.optional(),
});
export type PublicationView = z.infer<typeof PublicationViewSchema>;

// ───────── 封面 / 定价 ─────────
export const CoverSourceSchema = z.enum(['glyph', 'image', 'html_snapshot']);
export type CoverSource = z.infer<typeof CoverSourceSchema>;

export const CoverInputSchema = z.object({
  source: CoverSourceSchema,
  assetKey: z.string().optional().describe('source=image'),
  snapshotRef: z.string().optional().describe('source=html_snapshot'),
});
export type CoverInput = z.infer<typeof CoverInputSchema>;

export const TierInputSchema = z.object({
  tierCode: z.string(),
  priceMicros: z.number().int().nonnegative().describe('发布时冻结'),
});
export type TierInput = z.infer<typeof TierInputSchema>;

// ───────── 发布请求 / 结果 ─────────
export const PublishVersionBodySchema = z.object({
  cover: CoverInputSchema,
  tiers: z.array(TierInputSchema).min(1),
  visibility: VisibilitySchema,
});
export type PublishVersionBody = z.infer<typeof PublishVersionBodySchema>;

// ───────── 市集卡（B-28 投影）─────────
export const MarketCardSchema = z.object({
  versionId: IdSchema,
  capabilityId: IdSchema,
  slug: SlugSchema,
  cover: z.object({ source: CoverSourceSchema, url: z.string().nullable() }),
  typeLabel: z.string(),
  name: z.string(),
  tagline: z.string(),
  summary: z.string(),
  byline: z.string().describe('署名（自动取登录账号，不可改）'),
  trustBadge: z.literal('源自一次真实会话'),
  price: z.object({ priceMicros: z.number().int().nullable(), display: z.string().nullable() }),
  trialEnabled: z.literal(false),
  installs: z.null().describe('usage 占位（meta.placeholders）'),
  rating: z.null().describe('usage 占位'),
});
export type MarketCard = z.infer<typeof MarketCardSchema>;

export const PublishResultSchema = z.object({
  versionId: IdSchema,
  capabilityId: IdSchema,
  slug: SlugSchema,
  shareToken: z.string(),
  reviewStatus: z.literal('alpha_pending'),
  visibility: VisibilitySchema,
  publishedVersionId: IdSchema,
  supersededVersionId: IdSchema.optional(),
  marketUrl: z.string(),
  card: MarketCardSchema,
});
export type PublishResult = z.infer<typeof PublishResultSchema>;

export const MarketCardPreviewBodySchema = z.object({
  cover: CoverInputSchema.optional(),
  tiers: z.array(TierInputSchema).optional(),
  visibility: VisibilitySchema.optional(),
});
export type MarketCardPreviewBody = z.infer<typeof MarketCardPreviewBodySchema>;

// ───────── 批量发布（无连坐 P0，B-29）─────────
export const BatchItemStateSchema = z.enum([
  'pending',
  'structuring',
  'publishing',
  'published',
  'failed',
]);
export type BatchItemState = z.infer<typeof BatchItemStateSchema>;

export const CreatePublishBatchItemSchema = z.object({
  candidateId: IdSchema.optional().describe('二选一：候选起（需结构化）'),
  versionId: IdSchema.optional().describe('或已有版本直接发'),
  idempotencyKey: z.string().describe('每 item 独立幂等键（scope=publish_batch.item）'),
  cover: CoverInputSchema.optional(),
  tiers: z.array(TierInputSchema).optional(),
  visibility: VisibilitySchema.optional(),
});
export type CreatePublishBatchItem = z.infer<typeof CreatePublishBatchItemSchema>;

export const CreatePublishBatchBodySchema = z.object({
  items: z.array(CreatePublishBatchItemSchema).min(1),
});
export type CreatePublishBatchBody = z.infer<typeof CreatePublishBatchBodySchema>;

export const PublishBatchItemViewSchema = z.object({
  itemId: IdSchema,
  candidateId: IdSchema.optional(),
  versionId: IdSchema.optional(),
  capabilityId: IdSchema.optional(),
  state: BatchItemStateSchema,
  missingFields: z.array(z.string()).optional().describe('「去补齐」用'),
  error: ErrorBodySchema.optional().describe('该 item 人话错误（不连坐）'),
});
export type PublishBatchItemView = z.infer<typeof PublishBatchItemViewSchema>;

export const PublishBatchViewSchema = z.object({
  batchId: IdSchema,
  jobId: IdSchema.describe('SSE: GET /jobs/{jobId}/events'),
  status: JobStatusSchema,
  total: z.number().int(),
  processedCount: z
    .number()
    .int()
    .describe('= publishedCount + failedCount（进度分子、完成判定，Codex#7）'),
  publishedCount: z.number().int(),
  failedCount: z.number().int(),
  items: z.array(PublishBatchItemViewSchema),
});
export type PublishBatchView = z.infer<typeof PublishBatchViewSchema>;

export const RetryBatchItemBodySchema = z.object({
  cover: CoverInputSchema.optional(),
  tiers: z.array(TierInputSchema).optional(),
  visibility: VisibilitySchema.optional(),
});
export type RetryBatchItemBody = z.infer<typeof RetryBatchItemBodySchema>;

// ───────── 评审（B-30，人工）─────────
export const ReviewBodySchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approve') }),
  z.object({ decision: z.literal('reject'), rejectReason: z.string().min(1) }),
]);
export type ReviewBody = z.infer<typeof ReviewBodySchema>;
