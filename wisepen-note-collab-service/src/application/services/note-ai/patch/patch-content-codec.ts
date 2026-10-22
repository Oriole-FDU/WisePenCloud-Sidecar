import { PatchContent, PatchInlineItem } from '../request-types';
import { NoteBlockContent, NoteInline, NoteInlineText, NoteTableContent } from '../note-types';

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
const EDITABLE_BLOCK_TYPES = new Set(
  [...INLINE_BLOCK_TYPES].filter((type) => type !== 'mermaid').concat('table'),
);
const PLAIN_TEXT_BLOCK_TYPES = new Set(['codeBlock', 'mermaid']);

/**
 * 判断块类型是否允许被 AI patch 写入
 */
export function isEditableBlockType(type: string): boolean {
  return EDITABLE_BLOCK_TYPES.has(type);
}

/**
 * 把 AI patch 的单个 inline 项转换成 BlockNote 原生 inline
 */
function patchInlineItemToNative(value: PatchInlineItem): NoteInline {
  if (value.type === 'inlineMath') {
    return { type: 'inlineMath', props: { expression: value.expression } };
  }

  const styles: Record<string, boolean | string> = {};
  value.marks?.forEach((mark) => {
    styles[mark] = true;
  });
  if (value.type === 'text') {
    if (value.textColor !== undefined) styles.textColor = value.textColor;
    if (value.backgroundColor !== undefined) styles.backgroundColor = value.backgroundColor;
    return { type: 'text', text: value.text, styles };
  }
  const text: NoteInlineText = { type: 'text', text: value.text, styles };
  return { type: 'link', href: value.href, content: [text] };
}

/**
 * 批量解码 inline items
 */
function decodeInlineItems(items: PatchInlineItem[]): NoteInline[] {
  return items.map((item) => patchInlineItemToNative(item));
}

/**
 * 判断 AI 返回的表格和原表格是否具有相同的行列结构。
 * 只有结构完全一致时才能按坐标继承 colspan/rowspan 等单元格布局
 */
function hasSameTableShape(
  value: Extract<PatchContent, { kind: 'table' }>,
  existingTable: NoteTableContent | undefined,
): existingTable is NoteTableContent {
  return existingTable !== undefined // 必须存在原表格
    && existingTable.rows.length === value.rows.length // 新旧表格行数必须相同
    && existingTable.rows.every((row, rowIndex) => row.cells.length === value.rows[rowIndex].length); // 每一行的单元格数量必须相同
}

/**
 * 把 AI patch 的表格内容转换成 BlockNote NoteTableContent。
 *
 * 替换已有表格时，列宽始终按列继承；新增列使用默认宽度。
 * 表格结构完全一致时再继承单元格布局，避免 AI 只改文字却重置原有尺寸、合并和样式。
 */
function decodeTableContent(
  value: Extract<PatchContent, { kind: 'table' }>,
  existingTable?: NoteTableContent,
): NoteTableContent {
  // 判断是否可以继承单元格布局
  const preserveCellLayout = hasSameTableShape(value, existingTable);
  const rows: NoteTableContent['rows'] = value.rows.map((row, rowIndex) => ({
    cells: row.map((cell, cellIndex) => ({
      type: 'tableCell',
      content: decodeInlineItems(cell),
      props: preserveCellLayout
        ? { ...existingTable.rows[rowIndex].cells[cellIndex].props } // 如果结构相同，就按行列坐标复制原单元格的 `props`
        : {
          colspan: 1,
          rowspan: 1,
          backgroundColor: 'default',
          textColor: 'default',
          textAlignment: 'left',
        },
    })),
  }));
  // 计算新表格列数
  const columnCount = Math.max(0, ...rows.map((row) => row.cells.length));
  // 继承原列宽
  // AI 增加列时，新列使用默认宽度 `100`
  const columnWidths = Array.from(
    { length: columnCount },
    (_, columnIndex) => existingTable?.columnWidths[columnIndex] ?? 100, // 只有原宽度不存在时才回退到 `100`
  );
  return {
    type: 'tableContent',
    columnWidths,
    headerRows: value.headerRows,
    headerCols: value.headerCols,
    rows,
  };
}

/**
 * 按目标块类型解码 AI patch 内容。
 *
 * 普通文本类块只能接收 inline 内容
 * table 只能接收 table 内容
 */
export function decodePatchContent(
  type: string,
  value: PatchContent,
  existingTable?: NoteTableContent,
): NoteBlockContent | null {
  if (INLINE_BLOCK_TYPES.has(type)) {
    if (value.kind !== 'inline') return null;
    const items = decodeInlineItems(value.items);
    if (!PLAIN_TEXT_BLOCK_TYPES.has(type)) return items;
    if (items.some((item) => item.type !== 'text' || Object.keys(item.styles).length > 0)) {
      return null;
    }
    return items;
  }
  if (type === 'table') {
    return value.kind === 'table' ? decodeTableContent(value, existingTable) : null;
  }
  return null;
}

/**
 * 为 deleteBlock 生成对应块类型的“空内容”
 */
export function emptyNoteBlockContent(type: string): NoteBlockContent | null {
  if (INLINE_BLOCK_TYPES.has(type)) return [];
  if (type === 'table') {
    return {
      type: 'tableContent',
      columnWidths: [],
      headerRows: 0,
      headerCols: 0,
      rows: [],
    };
  }
  return null;
}

