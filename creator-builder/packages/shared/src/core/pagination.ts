// 分页：cursor 唯一，不用 offset（脊柱 §2.3）。
import { z } from 'zod';

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export const PageOrderSchema = z.enum(['asc', 'desc']);
export type PageOrder = z.infer<typeof PageOrderSchema>;

/** 请求侧分页参数。cursor 不透明（服务端 base64 编码 {sortKey,id}）。 */
export const PageQuerySchema = z.object({
  cursor: z.string().optional().describe('不透明游标；首页不传'),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT).optional(),
  order: PageOrderSchema.optional(),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

/** 响应侧 meta.page。不返回 total（脊柱 §2.3）。 */
export const PageMetaSchema = z.object({
  nextCursor: z.string().nullable().describe('null = 到底'),
  hasMore: z.boolean(),
  limit: z.number().int(),
  order: PageOrderSchema,
});
export type PageMeta = z.infer<typeof PageMetaSchema>;
