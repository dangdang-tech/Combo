// jobs 状态机 + JobView（脊柱 §6 / §9）。PG jobs 表是状态唯一真源，BullMQ 只触发。
import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from './ids.js';
import { ErrorBodySchema } from './errors.js';
import { ProgressViewSchema } from './progress.js';

/** 任务类型。后两类（evaluate/runtime_gen）本期 schema 冻结、不注册 processor（脊柱 §6.3）。 */
export const JobTypeSchema = z.enum([
  'import',
  'extract',
  'structure',
  'publish_batch',
  'evaluate',
  'runtime_gen',
]);
export type JobType = z.infer<typeof JobTypeSchema>;

/** 本期实际注册 processor 的四类（脊柱 §6.3）。 */
export const ACTIVE_JOB_TYPES = ['import', 'extract', 'structure', 'publish_batch'] as const;

/** 任务状态机（脊柱 §6.1）。running→completed/failed/cancelled 为终态、不可逆。 */
export const JobStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

/** 终态集合（脊柱 §6.1）。 */
export const TERMINAL_JOB_STATUSES = ['completed', 'failed', 'cancelled'] as const;
export function isTerminalJobStatus(s: JobStatus): boolean {
  return (TERMINAL_JOB_STATUSES as readonly string[]).includes(s);
}

export const JobViewSchema = z.object({
  id: IdSchema,
  type: JobTypeSchema,
  status: JobStatusSchema,
  progress: ProgressViewSchema,
  result: z.unknown().optional(),
  /** 失败时人话错误（非堆栈），= ErrorEnvelope['error']。 */
  error: ErrorBodySchema.optional(),
  attemptNo: z.number().int(),
  createdAt: IsoDateTimeSchema,
  startedAt: IsoDateTimeSchema.optional(),
  finishedAt: IsoDateTimeSchema.optional(),
});
export type JobView = z.infer<typeof JobViewSchema>;
