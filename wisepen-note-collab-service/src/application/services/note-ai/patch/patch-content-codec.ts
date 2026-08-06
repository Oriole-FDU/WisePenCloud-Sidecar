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
 * 把 AI patch 的表格内容转换成 BlockNote NoteTableContent
 */
function decodeTableContent(value: Extract<PatchContent, { kind: 'table' }>): NoteTableContent {
  const rows: NoteTableContent['rows'] = value.rows.map((row) => ({
    cells: row.map((cell) => ({
      type: 'tableCell',
      content: decodeInlineItems(cell),
      props: {
        colspan: 1,
        rowspan: 1,
        backgroundColor: 'default',
        textColor: 'default',
        textAlignment: 'left',
      },
    })),
  }));
  const columnCount = Math.max(0, ...rows.map((row) => row.cells.length));
  return {
    type: 'tableContent',
    columnWidths: Array.from({ length: columnCount }, () => 100),
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
export function decodePatchContent(type: string, value: PatchContent): NoteBlockContent | null {
  if (INLINE_BLOCK_TYPES.has(type)) {
    if (value.kind !== 'inline') return null;
    const items = decodeInlineItems(value.items);
    if (!PLAIN_TEXT_BLOCK_TYPES.has(type)) return items;
    if (items.some((item) => item.type !== 'text' || Object.keys(item.styles).length > 0)) {
      return null;
    }
    return items;
  }
  if (type === 'table') return value.kind === 'table' ? decodeTableContent(value) : null;
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

