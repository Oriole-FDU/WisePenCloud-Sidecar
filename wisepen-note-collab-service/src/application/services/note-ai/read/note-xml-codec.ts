import { Note, NoteBlock, NoteInline, NoteTableContent } from '../note-types';
import { isRecord } from '../utils';

const XML_ELEMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const PUBLIC_BLOCK_ID_PATTERN = /^p_\d{3,}$/;
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
 * 移除 XML 1.0 不允许的字符
 */
function sanitizeXml(value: string): string {
  let validXml = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    const valid =
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0d ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10000 && codePoint <= 0x10ffff);
    validXml += valid ? character : '\ufffd';
  }
  return validXml;
}

/**
 * 转义 XML 文本和属性中的特殊字符
 */
function escapeXml(value: string): string {
  return sanitizeXml(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&apos;';
    }
  });
}

/**
 * 把 NoteInline 数组压成适合 AI 阅读的纯文本
 *
 * inlineMath 用 $...$ 表示，link 用 Markdown 链接表示
 */
function inlineText(items: NoteInline[]): string {
  return items.map((item) => {
    if (item.type === 'inlineMath') return `$${item.props.expression}$`;
    if (item.type === 'link') {
      return item.content.map((part) => `[${part.text}](${item.href})`).join('');
    }
    return item.text;
  }).join('');
}

/**
 * 把表格内容压成纯文本行
 *
 * 单元格用竖线分隔，空行会被过滤
 * 这里不是完整 Markdown 表格，只是给 AI 一个低噪声的表格语义表示
 */
function tableText(content: NoteTableContent): string {
  return content.rows
    .map((row) => {
      const cells = row.cells.map((cell) => inlineText(cell.content).trim());
      return cells.some(Boolean) ? cells.join(' | ') : '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * 根据块类型提取可写入 XML 文本节点的内容
 *
 * 函数对异常内容做 try/catch 兜底，单个坏块不应导致整篇 XML 编码失败
 * 无法识别的内容返回空字符串
 */
function contentText(type: string, content: unknown): string {
  try {
    if (INLINE_BLOCK_TYPES.has(type)) {
      return Array.isArray(content) ? inlineText(content as NoteInline[]) : '';
    }
    if (type === 'table' && isRecord(content) && content.type === 'tableContent') {
      return tableText(content as unknown as NoteTableContent);
    }
    if (type === 'math' && typeof content === 'string') return content;
    return '';
  } catch {
    return '';
  }
}

/**
 * 编码单个 NoteBlock 为 XML 元素
 *
 * 块类型会作为元素名；如果类型不是合法 XML 名，则退化为 <block type="...">
 * 块 ID 必须是 publicBlockId 生成的短 ID，children 会递归编码，aiContent 会包进 <ai> 子元素
 */
function encodeBlock(
  block: NoteBlock,
  publicBlockId: (internalId: string) => string,
): string {
  const id = publicBlockId(block.id);
  if (!PUBLIC_BLOCK_ID_PATTERN.test(id)) throw new Error('INVALID_PUBLIC_BLOCK_ID');
  const validType = XML_ELEMENT_NAME_PATTERN.test(block.type);
  const elementName = validType ? block.type : 'block';
  const attributes = [
    `id="${escapeXml(id)}"`,
    ...(validType ? [] : [`type="${escapeXml(block.type)}"`]),
    ...(block.type === 'codeBlock' && typeof block.props.language === 'string'
      ? [`lang="${escapeXml(block.props.language)}"`]
      : []),
  ].join(' ');
  const content = escapeXml(contentText(block.type, block.content));
  const aiContent = block.aiContent === undefined
    ? ''
    : `<ai>${escapeXml(contentText(block.type, block.aiContent))}</ai>`;
  const children = block.children.map((child) => encodeBlock(child, publicBlockId)).join('');
  const body = content + aiContent + children;
  return body
    ? `<${elementName} ${attributes}>${body}</${elementName}>`
    : `<${elementName} ${attributes}/>`;
}

/**
 * 将一份 AI Note 快照编码成紧凑 XML 文档
 */
export function encodeNoteXml(
  snapshot: Note,
  publicBlockId: (internalId: string) => string,
): string {
  const attributes = [
    `resourceId="${escapeXml(snapshot.resourceId)}"`,
    `version="${escapeXml(snapshot.version)}"`,
  ].join(' ');
  const blocks = snapshot.blocks.map((block) => encodeBlock(block, publicBlockId)).join('');
  return `<document ${attributes}>${blocks}</document>`;
}
