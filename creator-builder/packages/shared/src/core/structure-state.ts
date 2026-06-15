// structure_state（脊柱 §9）：结构化字段级真源；详定义在结构化域契约（40）。
// 断点续传精度靠它（贯穿-28）：每软字段已生成值/状态/卡住时长 + 硬字段锁定值。
import { z } from 'zod';
import { IdSchema } from './ids.js';

/** locked = 硬字段平台锁定（脊柱 §9）。 */
export const FieldStatusSchema = z.enum([
  'pending',
  'generating',
  'done',
  'stuck',
  'failed',
  'locked',
]);
export type FieldStatus = z.infer<typeof FieldStatusSchema>;

export const FieldStateSchema = z.object({
  field: z.string(),
  status: FieldStatusSchema,
  value: z.unknown().optional().describe('已生成值（已落库，断点续传回显）'),
  stuckMs: z.number().int().optional(),
});
export type FieldState = z.infer<typeof FieldStateSchema>;

export const StructureStateSchema = z.object({
  versionId: IdSchema,
  fields: z.array(FieldStateSchema).describe('软字段 + 硬字段(locked)'),
  doneCount: z.number().int(),
  totalCount: z.number().int(),
});
export type StructureState = z.infer<typeof StructureStateSchema>;
