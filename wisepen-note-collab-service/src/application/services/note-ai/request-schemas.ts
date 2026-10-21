import { z } from 'zod';


/**
 * “必须是非空字符串”的字段 schema
 */
const nonEmptyString = (field: string) =>
  z.string().refine((value) => value.trim().length > 0, `${field} 必须是非空字符串`);

const INLINE_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'quote',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
  'toggleListItem',
  'codeBlock',
  'highlightBlock',
  'mermaid',
]);

/**
 * 读取接口的范围选择
 * 
 * whole_note 表示读取整篇笔记
 * blocks 表示读取指定的多个块
 * subtree 表示读取某个块以及它的全部子块
 * block_range 表示按文档阅读顺序读取两个块之间的闭区间
 * 
 * 除 whole_note 外，其余范围使用的都是笔记中真实的块 ID （可从一次读取结果中获得）
 */
export const NoteReadScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('whole_note') }).passthrough(),
  z.object({
    kind: z.literal('blocks'),
    blockIds: z.array(nonEmptyString('scope.blockIds')).min(1, 'scope.blockIds 必须是非空数组'),
  }).passthrough(),
  z.object({
    kind: z.literal('subtree'),
    blockId: nonEmptyString('scope.blockId'),
  }).passthrough(),
  z.object({
    kind: z.literal('block_range'),
    startBlockId: nonEmptyString('scope.startBlockId'),
    endBlockId: nonEmptyString('scope.endBlockId'),
  }).passthrough(),
]);

/**
 * 读取接口请求体
 * 
 * scope 不传时默认读取整篇笔记
 * includeAiContent 是否读取并返回 AI 建议层（AI 生成但尚未真正合入正文的内容）
 */
export const NoteReadRequestSchema = z.object({
  scope: NoteReadScopeSchema.optional(),
  includeAiContent: z.boolean().optional(),
}).passthrough();

/**
 * AI patch 里允许写进块属性的最基础值类型
 * 只允许字符串、数字、布尔值，不允许对象、数组和 null
 */
export const PatchBlockAttrPrimitiveSchema = z.union([z.string(), z.number(), z.boolean()]);

/**
 * AI patch 里允许的行内样式标记
 * 这些标记会作用在文本片段上，比如加粗（bold）、斜体（italic）、下划线（underline）等
 */
export const PatchInlineMarkSchema = z.enum(['bold', 'italic', 'underline', 'strike', 'code']);

/**
 * AI patch 里的一个行内内容片段
 * 可以是普通文本、链接，或者行内公式
 */
export const PatchInlineItemSchema = z.discriminatedUnion('type', [
  z.object({ // 普通文本
    type: z.literal('text'),
    text: z.string(),
    marks: z.array(PatchInlineMarkSchema).optional(),
    textColor: z.string().optional(),
    backgroundColor: z.string().optional(),
  }).passthrough(),
  z.object({ // 链接
    type: z.literal('link'),
    text: z.string(),
    href: nonEmptyString('href'),
    marks: z.array(PatchInlineMarkSchema).optional(),
  }).passthrough(),
  z.object({ // 行内公式
    type: z.literal('inlineMath'),
    expression: z.string(),
  }).passthrough(),
]);

/**
 * AI patch 里某个块的行内内容，装载一组行内片段
 */
const PatchInlineContentSchema = z.object({
  kind: z.literal('inline'),
  items: z.array(PatchInlineItemSchema),
}).passthrough();

/**
 * AI patch 里的表格块内容
 *
 * rows 是三层数组：row -> cell -> inline items
 * 这里额外校验行不能为空、各行列数一致、表头行列数不能越界
 */
const PatchTableContentSchema = z.object({
  kind: z.literal('table'),
  headerRows: z.number().int().min(0),
  headerCols: z.number().int().min(0),
  rows: z.array(z.array(z.array(PatchInlineItemSchema))),
}).passthrough().superRefine((value, ctx) => {
  let expectedColumnCount: number | undefined;
  value.rows.forEach((row, index) => {
    if (row.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['rows', index],
        message: `rows[${index}] 不能为空`,
      });
      return;
    }
    expectedColumnCount ??= row.length;
    if (row.length !== expectedColumnCount) {
      ctx.addIssue({
        code: 'custom',
        path: ['rows', index],
        message: `rows[${index}] 列数不一致`,
      });
    }
  });
  const columnCount = Math.max(0, ...value.rows.map((row) => row.length));
  if (value.headerRows > value.rows.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['headerRows'],
      message: 'headerRows 不能超过表格行数',
    });
  }
  if (value.headerCols > columnCount) {
    ctx.addIssue({
      code: 'custom',
      path: ['headerCols'],
      message: 'headerCols 不能超过表格列数',
    });
  }
});

/**
 * AI patch 里某个块可以写入的内容
 * inline 用于普通文本类块，table 用于表格块
 */
export const PatchContentSchema = z.discriminatedUnion('kind', [
  PatchInlineContentSchema,
  PatchTableContentSchema,
]);

/**
 * AI patch 里要插入的新块
 */
const InsertBlockCandidateSchema = z.object({
  type: nonEmptyString('block.type'),
  attrs: z.record(z.string(), PatchBlockAttrPrimitiveSchema).optional(),
  content: PatchContentSchema,
}).passthrough().superRefine((value, ctx) => {
  const attrs = value.attrs ?? {};
  const allowed = new Set<string>();
  if (value.type === 'heading') {
    allowed.add('level');
    allowed.add('isToggleable');
  }
  if (value.type === 'checkListItem') allowed.add('checked');
  if (value.type === 'numberedListItem') allowed.add('start');
  if (value.type === 'codeBlock') allowed.add('language');
  if (INLINE_BLOCK_TYPES.has(value.type) && value.type !== 'highlightBlock') {
    allowed.add('backgroundColor');
    allowed.add('textColor');
    if (value.type !== 'quote') allowed.add('textAlignment');
  }
  if (value.type === 'table') allowed.add('textColor');

  Object.keys(attrs).forEach((key) => {
    if (!allowed.has(key)) {
      ctx.addIssue({
        code: 'custom',
        path: ['attrs', key],
        message: `${key} 不支持用于 ${value.type}`,
      });
    }
  });
  if (attrs.level !== undefined &&
      (!Number.isInteger(attrs.level) || Number(attrs.level) < 1 || Number(attrs.level) > 6)) {
    ctx.addIssue({
      code: 'custom',
      path: ['attrs', 'level'],
      message: 'level 必须是 1 到 6 的整数',
    });
  }
  if (attrs.isToggleable !== undefined && typeof attrs.isToggleable !== 'boolean') {
    ctx.addIssue({
      code: 'custom',
      path: ['attrs', 'isToggleable'],
      message: 'isToggleable 必须是布尔值',
    });
  }
  if (attrs.checked !== undefined && typeof attrs.checked !== 'boolean') {
    ctx.addIssue({
      code: 'custom',
      path: ['attrs', 'checked'],
      message: 'checked 必须是布尔值',
    });
  }
  if (attrs.start !== undefined &&
      (!Number.isInteger(attrs.start) || Number(attrs.start) < 1)) {
    ctx.addIssue({
      code: 'custom',
      path: ['attrs', 'start'],
      message: 'start 必须是正整数',
    });
  }
  if (attrs.language !== undefined && typeof attrs.language !== 'string') {
    ctx.addIssue({
      code: 'custom',
      path: ['attrs', 'language'],
      message: 'language 必须是字符串',
    });
  }
  for (const key of ['backgroundColor', 'textColor'] as const) {
    if (attrs[key] !== undefined && typeof attrs[key] !== 'string') {
      ctx.addIssue({
        code: 'custom',
        path: ['attrs', key],
        message: `${key} 必须是字符串`,
      });
    }
  }
  if (attrs.textAlignment !== undefined &&
      !['left', 'center', 'right', 'justify'].includes(String(attrs.textAlignment))) {
    ctx.addIssue({
      code: 'custom',
      path: ['attrs', 'textAlignment'],
      message: 'textAlignment 必须是 left、center、right 或 justify',
    });
  }
});

export const PatchOperationSchema = z.discriminatedUnion('kind', [
  z.object({
    opId: nonEmptyString('opId'),
    kind: z.literal('replaceContent'),
    blockId: nonEmptyString('blockId'),
    content: PatchContentSchema,
  }).passthrough(),
  z.object({
    opId: nonEmptyString('opId'),
    kind: z.literal('deleteBlock'),
    blockId: nonEmptyString('blockId'),
  }).passthrough(),
  z.object({
    opId: nonEmptyString('opId'),
    kind: z.literal('insertBlock'),
    anchorBlockId: nonEmptyString('anchorBlockId'),
    position: z.enum(['before', 'after']),
    block: InsertBlockCandidateSchema,
  }).passthrough(),
  z.object({
    opId: nonEmptyString('opId'),
    kind: z.literal('appendRootBlock'),
    block: InsertBlockCandidateSchema,
  }).passthrough(),
]);

export const NotePatchRequestSchema = z.object({
  patchId: nonEmptyString('patchId'),
  version: nonEmptyString('version').refine((value) => value.startsWith('yjs-v1:'), `version 格式无效`),
  operations: z.array(PatchOperationSchema).min(1, 'operations 数量必须在 1 到 200 之间').max(200, 'operations 数量必须在 1 到 200 之间'),
}).passthrough().superRefine((value, ctx) => {
  const opIds = new Set(value.operations.map((operation) => operation.opId));
  if (opIds.size !== value.operations.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['operations'],
      message: '同一 patch 内 opId 不能重复',
    });
  }
});
