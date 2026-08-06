import * as Y from 'yjs';
import {
  NoteBlock,
  NoteInline,
  NoteInlineLink,
  NoteInlineText,
  NoteTableCell,
  NoteTableContent,
} from '../note-types';
import { asFiniteNumber, asString, isRecord } from '../utils';

const DOCUMENT_STORE = 'document-store';
const AI_CONTENT_STORE = 'ai-content-store';

type XmlParent = Y.XmlFragment | Y.XmlElement;

/**
 * 读取 BlockNote/Yjs 属性值中的真实业务值
 *
 * BlockNote 某些属性会被包装成 { stringValue } 这样的结构；AI 读取时不需要保留这种序列化细节，因此这里统一剥掉一层包装
 * 无法识别的对象保持原样，避免误删未知属性
 */
function readAttributeValue(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if ('stringValue' in value) return value.stringValue;
  return value;
}

/**
 * 读取一个 Y.XmlElement 的全部属性并做轻量归一化
 *
 * 返回值用于 NoteBlock.props 或 table cell props，目标是给 AI 一个稳定 JSON 结构而不是直接暴露 Yjs 内部属性对象
 */
function readAttributes(element: Y.XmlElement): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(element.getAttributes()).map(([key, value]) => [
      key,
      readAttributeValue(value),
    ]),
  );
}

/**
 * 从 Y.XmlText delta attributes 中提取文本样式
 *
 * link 属性会被单独转换成 NoteInlineLink，因此这里跳过 link；false/null 属性视为未启用
 * 其他非字符串真值统一记为 true，以兼容 bold/italic 等布尔 mark
 */
function readTextStyles(attributes: Record<string, unknown>): Record<string, boolean | string> {
  const result: Record<string, boolean | string> = {};
  for (const [key, rawValue] of Object.entries(attributes)) {
    if (key === 'link') continue;
    const value = readAttributeValue(rawValue);
    if (value === false || value == null) continue;
    result[key] = typeof value === 'string' ? value : true;
  }
  return result;
}

/**
 * 从 link 属性中读取 href
 *
 * 不同版本或编辑器桥接层可能把链接保存为字符串或 { href } 对象；这里同时兼容两种形态
 */
function readLinkHref(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return undefined;
  return typeof value.href === 'string' ? value.href : undefined;
}

/**
 * 把 Y.XmlText 的 Delta 片段转换成 NoteInline
 *
 * Y.XmlText.toDelta() 会把连续文本和样式拆成片段；每个片段会变成 text inline，带 link的片段再包成 link inline
 * 空字符串片段会被跳过，减少 AI XML 中无意义节点
 */
function readXmlText(text: Y.XmlText): NoteInline[] {
  const result: NoteInline[] = [];
  for (const part of text.toDelta()) {
    if (typeof part.insert !== 'string' || part.insert.length === 0) continue;
    const attributes = isRecord(part.attributes) ? part.attributes : {};
    const nativeText: NoteInlineText = {
      type: 'text',
      text: part.insert,
      styles: readTextStyles(attributes),
    };
    const href = readLinkHref(attributes.link);
    if (href) {
      const link: NoteInlineLink = { type: 'link', href, content: [nativeText] };
      result.push(link);
    } else {
      result.push(nativeText);
    }
  }
  return result;
}

/**
 * 读取内联 XML 元素
 *
 * inlineMath 是明确支持的特殊节点；其他内联元素按容器处理，继续递归读取其中的 Y.XmlText/Y.XmlElement
 */
function readInlineElement(element: Y.XmlElement): NoteInline[] {
  if (element.nodeName === 'inlineMath') {
    return [
      {
        type: 'inlineMath',
        props: { expression: asString(element.getAttribute('expression')) },
      },
    ];
  }

  const result: NoteInline[] = [];
  for (const child of element.toArray()) {
    if (child instanceof Y.XmlText) result.push(...readXmlText(child));
    if (child instanceof Y.XmlElement) result.push(...readInlineElement(child));
  }
  return result;
}

/**
 * 读取块元素内的普通内联内容
 *
 * 把直接和间接子节点里的文本、链接、inlineMath 展平成 NoteInline 数组
 */
function readPatchBlockContent(element: Y.XmlElement): NoteInline[] {
  const result: NoteInline[] = [];
  for (const child of element.toArray()) {
    if (child instanceof Y.XmlText) result.push(...readXmlText(child));
    if (child instanceof Y.XmlElement) result.push(...readInlineElement(child));
  }
  return result;
}

/**
 * 读取指定名称的直接子元素
 */
function directElements(element: Y.XmlElement, names: readonly string[]): Y.XmlElement[] {
  return element
    .toArray()
    .filter(
      (child): child is Y.XmlElement =>
        child instanceof Y.XmlElement && names.includes(child.nodeName),
    );
}

/**
 * 把 BlockNote 的 table XML 结构转换成 NoteTableContent
 *
 * 读取 tableRow 下的 tableCell/tableHeader，保留单元格文本和基础布局属性，并根据连续 header 行/列推导 headerRows/headerCols
 * 列宽从第一行读取，缺失时回退 100
 */
function readTableContent(element: Y.XmlElement): NoteTableContent {
  const rowElements = directElements(element, ['tableRow']);
  const firstRowCells = rowElements[0]
    ? directElements(rowElements[0], ['tableCell', 'tableHeader'])
    : [];

  const rows = rowElements.map((rowElement) => ({
    cells: directElements(rowElement, ['tableCell', 'tableHeader']).map((cellElement) => {
      const attributes = readAttributes(cellElement);
      const cell: NoteTableCell = {
        type: 'tableCell',
        content: readPatchBlockContent(cellElement),
        props: {
          colspan: asFiniteNumber(attributes.colspan, 1),
          rowspan: asFiniteNumber(attributes.rowspan, 1),
          backgroundColor: asString(attributes.backgroundColor, 'default'),
          textColor: asString(attributes.textColor, 'default'),
          textAlignment: asString(attributes.textAlignment, 'left'),
        },
      };
      return cell;
    }),
  }));

  let headerRows = 0;
  for (const rowElement of rowElements) {
    const cells = directElements(rowElement, ['tableCell', 'tableHeader']);
    if (cells.length === 0 || cells.some((cell) => cell.nodeName !== 'tableHeader')) break;
    headerRows += 1;
  }

  let headerCols = 0;
  const columnCount = Math.max(0, ...rows.map((row) => row.cells.length));
  for (let column = 0; column < columnCount; column += 1) {
    const columnCells = rowElements.map((row) =>
      directElements(row, ['tableCell', 'tableHeader'])[column],
    );
    if (columnCells.some((cell) => !cell || cell.nodeName !== 'tableHeader')) break;
    headerCols += 1;
  }

  return {
    type: 'tableContent',
    columnWidths: firstRowCells.map((cell) =>
      asFiniteNumber(cell.getAttribute('colwidth'), 100),
    ),
    headerRows,
    headerCols,
    rows,
  };
}

/**
 * 找到 blockContainer 中承载子块的 blockGroup
 */
function findChildGroup(container: Y.XmlElement): Y.XmlElement | undefined {
  return container
    .toArray()
    .find(
      (child): child is Y.XmlElement =>
        child instanceof Y.XmlElement && child.nodeName === 'blockGroup',
    );
}

/**
 * 找到 blockContainer 中真正的块元素
 */
function findBlockElement(container: Y.XmlElement): Y.XmlElement | undefined {
  return container
    .toArray()
    .find(
      (child): child is Y.XmlElement =>
        child instanceof Y.XmlElement && child.nodeName !== 'blockGroup',
    );
}

/**
 * 读取一个 blockContainer 并转换为 NoteBlock
 *
 * 该函数负责把 BlockNote 的容器节点、实际块节点、子块 group 和 ai-content-store 组合成对 AI 更友好的 NoteBlock
 * 无效容器返回 undefined
 */
function readBlockContainer(
  container: Y.XmlElement,
  aiContentStore: Y.Map<unknown>,
  includeAiContent: boolean,
): NoteBlock | undefined {
  const blockElement = findBlockElement(container);
  const id = container.getAttribute('id');
  if (!blockElement || typeof id !== 'string' || id.length === 0) return undefined;

  const childGroup = findChildGroup(container);
  const block: NoteBlock = {
    id,
    type: blockElement.nodeName,
    props: readAttributes(blockElement),
    content:
      blockElement.nodeName === 'table'
        ? readTableContent(blockElement)
        : blockElement.nodeName === 'math'
          ? asString(blockElement.getAttribute('expression'))
          : readPatchBlockContent(blockElement),
    children: childGroup
      ? readBlockGroup(childGroup, aiContentStore, includeAiContent)
      : [],
  };
  if (includeAiContent && aiContentStore.has(id)) {
    block.aiContent = aiContentStore.get(id);
  }
  return block;
}

/**
 * 读取一个 blockGroup 或文档根 fragment 中的全部块
 *
 * 文档根和嵌套 blockGroup 都实现 toArray，因此统一用 XmlParent 处理
 */
function readBlockGroup(
  group: XmlParent,
  aiContentStore: Y.Map<unknown>,
  includeAiContent: boolean,
): NoteBlock[] {
  const result: NoteBlock[] = [];
  for (const child of group.toArray()) {
    if (!(child instanceof Y.XmlElement)) continue;
    if (child.nodeName === 'blockContainer') {
      const block = readBlockContainer(child, aiContentStore, includeAiContent);
      if (block) result.push(block);
      continue;
    }
    if (child.nodeName === 'blockGroup') {
      result.push(...readBlockGroup(child, aiContentStore, includeAiContent));
    }
  }
  return result;
}

/**
 * 从 Y.Doc 中读取完整 BlockNote 文档树
 */
export function readNoteBlocks(doc: Y.Doc, includeAiContent = true): NoteBlock[] {
  const fragment = doc.getXmlFragment(DOCUMENT_STORE);
  const aiContentStore = doc.getMap<unknown>(AI_CONTENT_STORE);
  return readBlockGroup(fragment, aiContentStore, includeAiContent);
}
