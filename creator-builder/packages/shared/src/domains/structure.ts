// 40 · STEP③选择 + STEP④结构化域（B-24/B-25/B-26）。import 脊柱 §9，不重定义。
import { z } from 'zod';
import { IdSchema, SlugSchema } from '../core/ids.js';
import { StructureStateSchema } from '../core/structure-state.js';

// ===== manifest 软硬分层（§2）=====
export const SoftFieldKeySchema = z.enum([
  'name',
  'tagline',
  'role',
  'goal',
  'instructions',
  'skill_set',
  'starter_prompts',
]);
export type SoftFieldKey = z.infer<typeof SoftFieldKeySchema>;

export const HardFieldKeySchema = z.enum([
  'id',
  'version',
  'status',
  'inputs',
  'output',
  'boundaries',
]);
export type HardFieldKey = z.infer<typeof HardFieldKeySchema>;

/** 软字段标准序（7 个）。 */
export const SOFT_FIELD_KEYS: SoftFieldKey[] = SoftFieldKeySchema.options;
/** 硬字段标准序（6 类，平台锁定）。 */
export const HARD_FIELD_KEYS: HardFieldKey[] = HardFieldKeySchema.options;

// ===== 硬字段内部结构 =====
export const InputFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['string', 'text', 'enum', 'number']),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  derivedFrom: z.literal('instructions'),
});
export type InputField = z.infer<typeof InputFieldSchema>;

export const InputSchemaSchema = z.object({ fields: z.array(InputFieldSchema) });
export type InputSchema = z.infer<typeof InputSchemaSchema>;

export const OutputTypeSchema = z.enum(['text', 'structured', 'score', 'checklist']);
export type OutputType = z.infer<typeof OutputTypeSchema>;

export const OutputSpecSchema = z.object({ type: OutputTypeSchema });
export type OutputSpec = z.infer<typeof OutputSpecSchema>;

export const BoundariesSchema = z.object({
  riskLevel: z.enum(['low', 'medium', 'high']),
  redLines: z.array(z.string()),
});
export type Boundaries = z.infer<typeof BoundariesSchema>;

// ===== manifest（扁平存）=====
export const ManifestSchema = z.object({
  id: z.string(),
  version: z.string(),
  status: z.literal('draft'),
  inputs: InputSchemaSchema,
  output: OutputSpecSchema,
  boundaries: BoundariesSchema,
  name: z.string(),
  tagline: z.string(),
  role: z.string(),
  goal: z.string(),
  instructions: z.string(),
  skill_set: z.array(z.string()),
  starter_prompts: z.array(z.string()),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export const ManifestViewSchema = z.object({
  versionId: IdSchema,
  capabilityId: IdSchema,
  slug: SlugSchema,
  manifest: ManifestSchema,
  locked: z.array(HardFieldKeySchema),
  structureState: StructureStateSchema,
});
export type ManifestView = z.infer<typeof ManifestViewSchema>;

// ===== STEP③ 选择草稿（端点 G，drafts.selection 权威形态）=====
export const SelectionDraftSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('single'), candidateId: IdSchema }),
  z.object({ mode: z.literal('all'), candidateIds: z.array(IdSchema) }),
]);
export type SelectionDraft = z.infer<typeof SelectionDraftSchema>;

export const PatchSelectionBodySchema = z.object({ selection: SelectionDraftSchema });
export type PatchSelectionBody = z.infer<typeof PatchSelectionBodySchema>;

// ===== 端点 I/O =====
/**
 * **恰好三选一**：sourceCandidateId / capabilityId / fromVersionId（Codex#7，§2.4）。
 * 三个 source 字段必须**有且仅有一个**存在——零个或多于一个都拒（不仅是「fromVersionId 不与前两者并存」，
 * 也禁 `{sourceCandidateId, capabilityId}` 这种两者并存）。三分支语义：
 * ① `sourceCandidateId` 从候选新建首版；② `capabilityId` published 后建新版本；
 * ③ `fromVersionId` 被拒重发派生新 draft（从本人 review_rejected 版复制软字段）。
 */
export const CreateCapabilityBodySchema = z
  .object({
    sourceCandidateId: IdSchema.optional(),
    capabilityId: IdSchema.optional(),
    fromVersionId: IdSchema.optional(),
    draftId: IdSchema.optional(),
  })
  .refine(
    (b) =>
      [b.sourceCandidateId, b.capabilityId, b.fromVersionId].filter((v) => v !== undefined)
        .length === 1,
    {
      message: 'sourceCandidateId / capabilityId / fromVersionId 必须恰好三选一（有且仅有一个）',
    },
  );
export type CreateCapabilityBody = z.infer<typeof CreateCapabilityBodySchema>;

export const CreateCapabilityResultSchema = z.object({
  capabilityId: IdSchema,
  versionId: IdSchema,
  slug: SlugSchema,
  version: z.string(),
  manifest: ManifestSchema,
  structureState: StructureStateSchema,
});
export type CreateCapabilityResult = z.infer<typeof CreateCapabilityResultSchema>;

export const StartStructureBodySchema = z.object({
  fields: z.array(SoftFieldKeySchema).optional(),
});
export type StartStructureBody = z.infer<typeof StartStructureBodySchema>;

export const StartStructureResultSchema = z.object({
  jobId: IdSchema,
  versionId: IdSchema,
  eventsUrl: z.string(),
  structureState: StructureStateSchema,
});
export type StartStructureResult = z.infer<typeof StartStructureResultSchema>;

export const PatchManifestBodySchema = z.object({
  name: z.string().optional(),
  tagline: z.string().optional(),
  role: z.string().optional(),
  goal: z.string().optional(),
  instructions: z.string().optional(),
  skill_set: z.array(z.string()).optional(),
  starter_prompts: z.array(z.string()).optional(),
});
export type PatchManifestBody = z.infer<typeof PatchManifestBodySchema>;

export const RegenerateFieldBodySchema = z.object({
  reason: z.enum(['stuck', 'manual']).optional(),
});
export type RegenerateFieldBody = z.infer<typeof RegenerateFieldBodySchema>;

export const RegenerateFieldResultSchema = z.object({
  jobId: IdSchema,
  field: SoftFieldKeySchema,
  eventsUrl: z.string(),
});
export type RegenerateFieldResult = z.infer<typeof RegenerateFieldResultSchema>;

// ===== SSE 字段流 payload（本域具体化脊柱 §5.3；字段级 field 一律 SoftFieldKey）=====
export const FieldStartPayloadSchema = z.object({
  field: SoftFieldKeySchema,
  index: z.number().int(),
  total: z.number().int(),
});
export type FieldStartPayload = z.infer<typeof FieldStartPayloadSchema>;

export const FieldDeltaPayloadSchema = z.object({
  field: SoftFieldKeySchema,
  deltaText: z.string(),
  itemIndex: z.number().int().optional(),
});
export type FieldDeltaPayload = z.infer<typeof FieldDeltaPayloadSchema>;

export const FieldDonePayloadSchema = z.object({
  field: SoftFieldKeySchema,
  value: z.union([z.string(), z.array(z.string())]),
});
export type FieldDonePayload = z.infer<typeof FieldDonePayloadSchema>;

export const FieldItemAppendedPayloadSchema = z.object({
  field: SoftFieldKeySchema,
  itemIndex: z.number().int(),
  value: z.string(),
});
export type FieldItemAppendedPayload = z.infer<typeof FieldItemAppendedPayloadSchema>;

/** 本域收紧脊柱 FieldStuckPayload.field 为 SoftFieldKey（硬字段永不发 field_stuck）。 */
export const StructureFieldStuckPayloadSchema = z.object({
  field: SoftFieldKeySchema,
  elapsedMs: z.number().int(),
  options: z.array(z.enum(['continue', 'regen', 'wait'])),
});
export type StructureFieldStuckPayload = z.infer<typeof StructureFieldStuckPayloadSchema>;

/** 字段级失败：error 帧内层 error.details 形态（硬字段不报字段级生成错误）。 */
export const StructureFieldFailedDetailsSchema = z.object({
  field: SoftFieldKeySchema,
  attempts: z.number().int(),
});
export type StructureFieldFailedDetails = z.infer<typeof StructureFieldFailedDetailsSchema>;
