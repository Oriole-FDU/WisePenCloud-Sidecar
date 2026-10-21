import type { z } from 'zod';
import type {
  PatchBlockAttrPrimitiveSchema,
  NotePatchRequestSchema,
  NoteReadRequestSchema,
  NoteReadScopeSchema,
  PatchContentSchema,
  PatchInlineItemSchema,
  PatchInlineMarkSchema,
  PatchOperationSchema,
} from './request-schemas';

/** 读取接口请求体，用于读取笔记时描述本次要读取整篇笔记、指定块、子树或块区间 */
export type NoteReadRequest = z.infer<typeof NoteReadRequestSchema>;

/** 读取接口的范围参数 */
export type NoteReadScope = z.infer<typeof NoteReadScopeSchema>;

/** AI patch 写入接口请求体，包含 patchId 和 一组要应用到笔记上的操作 */
export type NotePatchRequest = z.infer<typeof NotePatchRequestSchema>;

/** AI patch 里允许写进块属性的最基础值类型 */
export type PatchBlockAttrPrimitive = z.infer<typeof PatchBlockAttrPrimitiveSchema>;

/** AI patch 里允许的行内样式标记 */
export type PatchInlineMark = z.infer<typeof PatchInlineMarkSchema>;

/** AI patch 里的一个行内内容片段 */
export type PatchInlineItem = z.infer<typeof PatchInlineItemSchema>;

/** AI patch 里某个块的正文内容 */
export type PatchContent = z.infer<typeof PatchContentSchema>;

/** AI patch 里的单条操作，可以替换或清空已有块的 AI 内容，也可以相对锚点或在文档根末尾插入新块 */
export type PatchOperation = z.infer<typeof PatchOperationSchema>;

/** 单条 patch 操作的业务冲突原因 */
export type NotePatchConflictReason =
  | 'block_missing'
  | 'anchor_missing'
  | 'unsupported_type'
  | 'invalid_content';

/** 单条 patch 操作的执行结果 */
export interface NotePatchOperationResult {
  opId: string;
  status: 'applied' | 'unchanged' | 'conflict';
  reason?: NotePatchConflictReason;
  blockId?: string;
}

/** AI patch 写入接口响应体，返回请求版本、应用前版本、应用后版本，以及每条操作的执行结果 */
export interface NotePatchResponse {
  resourceId: string;
  requestedVersion: string;
  currentVersion: string;
  resultVersion: string;
  modified: boolean;
  results: NotePatchOperationResult[];
}
