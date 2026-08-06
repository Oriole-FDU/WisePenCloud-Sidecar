/**
 * AI-Note 的文档模型层，即 AI 读写 Note 的中间文档结构
 */

export interface Note {
  resourceId: string;
  version: string;
  blocks: NoteBlock[];
}

export interface NoteInlineText {
  type: 'text';
  text: string;
  styles: Record<string, boolean | string>;
}

export interface NoteInlineLink {
  type: 'link';
  href: string;
  content: NoteInlineText[];
}

export interface NoteInlineMath {
  type: 'inlineMath';
  props: { expression: string };
}

export type NoteInline = NoteInlineText | NoteInlineLink | NoteInlineMath;

export interface NoteTableCell {
  type: 'tableCell';
  content: NoteInline[];
  props: {
    colspan: number;
    rowspan: number;
    backgroundColor: string;
    textColor: string;
    textAlignment: string;
  };
}

export interface NoteTableContent {
  type: 'tableContent';
  columnWidths: number[];
  headerRows: number;
  headerCols: number;
  rows: Array<{ cells: NoteTableCell[] }>;
}

export type NoteBlockContent = NoteInline[] | NoteTableContent | string | undefined;

export interface NoteBlock {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content: NoteBlockContent;
  aiContent?: unknown;
  children: NoteBlock[];
}
