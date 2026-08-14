import {
  NoteBlock,
  NoteBlockContent,
  NoteInline,
  NoteInlineText,
  NoteTableContent,
} from '../note-types';

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function escapeMarkdownText(value: string): string {
  return normalizeText(value).replace(/([\\`*_\[\]])/g, '\\$1');
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n+/g, '<br>');
}

function isTableContent(content: NoteBlockContent): content is NoteTableContent {
  return typeof content === 'object'
    && content !== null
    && !Array.isArray(content)
    && content.type === 'tableContent';
}

function inlineText(inline: NoteInline[]): string {
  return inline.map((item) => {
    if (item.type === 'text') return item.text;
    if (item.type === 'inlineMath') return item.props.expression;
    return inlineText(item.content);
  }).join('');
}

function renderInlineText(item: NoteInlineText): string {
  let text = escapeMarkdownText(item.text);
  if (item.styles.code) text = `\`${text.replace(/`/g, '\\`')}\``;
  if (item.styles.bold) text = `**${text}**`;
  if (item.styles.italic) text = `_${text}_`;
  if (item.styles.strike || item.styles.strikethrough) text = `~~${text}~~`;
  return text;
}

function renderInline(inline: NoteInline[]): string {
  return inline.map((item) => {
    if (item.type === 'text') return renderInlineText(item);
    if (item.type === 'inlineMath') return `$${item.props.expression}$`;

    const label = renderInline(item.content);
    const href = item.href.replace(/\)/g, '%29');
    return `[${label}](${href})`;
  }).join('');
}

function renderTable(content: NoteTableContent): string {
  const rows = content.rows.map((row) =>
    row.cells.map((cell) => escapeTableCell(renderInline(cell.content).trim())),
  );
  if (rows.length === 0) return '';

  const width = Math.max(...rows.map((row) => row.length), 1);
  const normalized = rows.map((row) => [
    ...row,
    ...Array.from({ length: width - row.length }, () => ''),
  ]);
  const header = normalized[0];
  const separator = Array.from({ length: width }, () => '---');
  const body = normalized.slice(1);

  return [header, separator, ...body]
    .map((row) => `| ${row.join(' | ')} |`)
    .join('\n');
}

function getBlockText(content: NoteBlockContent): string {
  if (Array.isArray(content)) return renderInline(content);
  if (typeof content === 'string') return escapeMarkdownText(content);
  if (isTableContent(content)) return renderTable(content);
  return '';
}

function getPlainBlockText(content: NoteBlockContent): string {
  if (Array.isArray(content)) return inlineText(content);
  if (typeof content === 'string') return content;
  if (isTableContent(content)) {
    return content.rows
      .map((row) => row.cells.map((cell) => inlineText(cell.content).trim()).join('\t'))
      .join('\n');
  }
  return '';
}

function renderBlock(block: NoteBlock, depth: number): string {
  const indent = '  '.repeat(depth);
  const content = getBlockText(block.content).trim();
  let current: string;

  switch (block.type) {
    case 'heading': {
      const level = Number(block.props.level) || 1;
      current = `${'#'.repeat(Math.min(Math.max(level, 1), 6))} ${content}`;
      break;
    }
    case 'bulletListItem':
      current = `${indent}- ${content}`;
      break;
    case 'numberedListItem':
      current = `${indent}1. ${content}`;
      break;
    case 'checkListItem': {
      const checked = block.props.checked === true ? 'x' : ' ';
      current = `${indent}- [${checked}] ${content}`;
      break;
    }
    case 'quote':
      current = content
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
      break;
    case 'codeBlock': {
      const language = typeof block.props.language === 'string' ? block.props.language : '';
      current = `\`\`\`${language}\n${getPlainBlockText(block.content).trimEnd()}\n\`\`\``;
      break;
    }
    case 'math':
      current = `$$\n${getPlainBlockText(block.content).trim()}\n$$`;
      break;
    default:
      current = content;
      break;
  }

  const children = renderBlocks(block.children, depth + 1);
  return [current, children].filter(Boolean).join('\n\n');
}

function renderBlocks(blocks: NoteBlock[], depth = 0): string {
  return blocks
    .map((block) => renderBlock(block, depth))
    .filter(Boolean)
    .join('\n\n');
}

export function renderNoteMarkdown(blocks: NoteBlock[]): string {
  return renderBlocks(blocks).trim();
}
