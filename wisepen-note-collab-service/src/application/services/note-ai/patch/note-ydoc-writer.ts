import * as Y from 'yjs';

const DOCUMENT_STORE = 'document-store';
const AI_CONTENT_STORE = 'ai-content-store';

type XmlParent = Y.XmlFragment | Y.XmlElement;

export interface BlockLocation {
  container: Y.XmlElement;
  block: Y.XmlElement;
  parentGroup: XmlParent;
  index: number;
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
 * 在一个 XML group 中定位指定 blockContainer
 * 
 * 查找会递归进入 blockGroup，既能找到顶层块，也能找到嵌套子块
 */
function findLocationInGroup(group: XmlParent, blockId: string): BlockLocation | undefined {
  const children = group.toArray();
  for (let index = 0; index < children.length; index += 1) {
    const container = children[index];
    if (!(container instanceof Y.XmlElement)) continue;

    // 正常块节点应该是 blockContainer；如果遇到 blockGroup，说明进入了子块列表
    if (container.nodeName !== 'blockContainer') {
      if (container.nodeName === 'blockGroup') {
        const nested = findLocationInGroup(container, blockId);
        if (nested) return nested;
      }
      continue;
    }
    
    const block = findBlockElement(container);

    // blockId 挂在 blockContainer 上，而不是 paragraph/heading/table 业务节点上
    if (container.getAttribute('id') === blockId && block) {
      // 返回 block 本身还包括 parentGroup 和 index。因为插入新块时需要知道锚点块在父 group 的位置，才能执行同级 before/after 插入
      return { container, block, parentGroup: group, index };
    }

    const childGroup = findChildGroup(container);
    if (childGroup) {
      const nested = findLocationInGroup(childGroup, blockId);
      if (nested) return nested;
    }
  }
  return undefined;
}

/**
 * 在整篇 Y.Doc 中查找指定块的位置
 */
export function findBlockLocation(doc: Y.Doc, blockId: string): BlockLocation | undefined {
  return findLocationInGroup(doc.getXmlFragment(DOCUMENT_STORE), blockId);
}

/**
 * 给 Y.XmlElement 设置属性，跳过 undefined
 */
function setAttributes(element: Y.XmlElement, attributes: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined) continue;
    element.setAttribute(key, value as string);
  }
}

/**
 * 为新插入的空块生成 BlockNote 所需默认属性
 * 
 * AI insertBlock 只描述业务需要的类型和 attrs，但前端 BlockNote 渲染某些块时依赖默认属性存在
 * 例如 heading 需要 level，checkListItem 需要 checked 等
 */
function defaultBlockAttributes(type: string): Record<string, unknown> {
  if (type === 'table') return { textColor: 'default' };
  if (type === 'codeBlock') return { language: 'text' };
  if (type === 'highlightBlock') {
    return {
      icon: '💡',
      highlightBackgroundColor: 'default',
      highlightBorderColor: 'auto',
      highlightTextColor: 'default',
      textAlignment: 'left',
    };
  }
  if (type === 'quote') return { backgroundColor: 'default', textColor: 'default' };
  const common = {
    backgroundColor: 'default',
    textColor: 'default',
    textAlignment: 'left',
  };
  if (type === 'heading') return { ...common, level: 1, isToggleable: false };
  if (type === 'checkListItem') return { ...common, checked: false };
  return common;
}

/**
 * 创建一个最小可渲染的空表格节点
 * 
 * 表格不能像普通文本块一样只放一个 Y.XmlText，insert table 时需要构造一张 1x1 空表格
 */
function createEmptyTableElement(): Y.XmlElement {
  const table = new Y.XmlElement('table');
  setAttributes(table, defaultBlockAttributes('table'));
  const row = new Y.XmlElement('tableRow');
  const cell = new Y.XmlElement('tableCell');
  setAttributes(cell, {
    backgroundColor: 'default',
    colspan: 1,
    colwidth: [100],
    rowspan: 1,
    textAlignment: 'left',
    textColor: 'default',
  });
  const paragraph = new Y.XmlElement('tableParagraph');
  paragraph.insert(0, [new Y.XmlText()]);
  cell.insert(0, [paragraph]);
  row.insert(0, [cell]);
  table.insert(0, [row]);
  return table;
}

/**
 * 创建一个 AI 建议块使用的最小 BlockNote 结构占位
 */
function createEmptyBlock(
  blockId: string,
  type: string,
  attributes: Record<string, unknown>,
): { container: Y.XmlElement; block: Y.XmlElement } {
  // 创建 blockContainer 并设置 blockId
  const container = new Y.XmlElement('blockContainer');
  container.setAttribute('id', blockId);

  // 如果是表格，则创建一个最小可渲染的空表格节点
  const block = type === 'table' ? createEmptyTableElement() : new Y.XmlElement(type);
  // 为新插入的空块生成 BlockNote 所需默认属性
  setAttributes(block, { ...defaultBlockAttributes(type), ...attributes });

    // 非表格块至少需要一个 XmlText，BlockNote 前端才能把它当作可编辑文本块渲染
  if (type !== 'table') block.insert(0, [new Y.XmlText()]);

  container.insert(0, [block]);
  return { container, block };
}

/**
 * 在指定锚点前后插入一个 AI 建议块的结构占位
 */
export function insertEmptyBlock(
  doc: Y.Doc,
  anchor: BlockLocation,
  position: 'before' | 'after',
  blockId: string,
  type: string,
  attributes: Record<string, unknown>,
): BlockLocation {
  const { container, block } = createEmptyBlock(blockId, type, attributes);

  // Yjs insert 是按数组位置插入；before 用锚点 index，after 用锚点 index + 1
  const index = anchor.index + (position === 'after' ? 1 : 0);
  anchor.parentGroup.insert(index, [container]);
  return { container, block, parentGroup: anchor.parentGroup, index };
}

/**
 * 在文档根级块列表末尾插入一个 AI 建议块的结构占位
 *
 * 空文档没有可用锚点，新建笔记的首个 AI 建议块通过该入口写入
 */
export function appendEmptyRootBlock(
  doc: Y.Doc,
  blockId: string,
  type: string,
  attributes: Record<string, unknown>,
): BlockLocation {
  const root = doc.getXmlFragment(DOCUMENT_STORE);
  const { container, block } = createEmptyBlock(blockId, type, attributes);
  const index = root.length;
  root.insert(index, [container]);
  return { container, block, parentGroup: root, index };
}

/**
 * 获取存放 AI 内容覆盖层的 Y.Map
 */
export function getAiContentStore(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(AI_CONTENT_STORE);
}
