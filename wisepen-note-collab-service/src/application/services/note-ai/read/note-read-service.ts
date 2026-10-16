import { Room } from '../../yjs/types';
import { getReadableVersion } from '../yjs-ids';
import { Note } from '../note-types';
import { NoteReadRequest } from '../request-types';
import { readNoteBlocks } from './note-ydoc-reader';

/**
 * 从当前活跃协同房间读取一份面向 AI 的笔记快照。
 *
 * 调用方必须保证 room 已经是当前 Sidecar实例中的活跃 Yjs 房间
 * 将 BlockNote 存在 Y.XmlFragment 中的树结构转换成 NoteBlock，再根据请求 scope 裁剪出整篇、子树、离散块或扁平区间
 *
 * 快照与 scope 里的块 ID 都是笔记内真实存在的块 ID，不需要额外映射或还原
 */
export function readActiveRoom(
  room: Room,
  request: NoteReadRequest,
): Note {
  const version = getReadableVersion(room.yDoc);
  const blocks = readNoteBlocks(room.yDoc, request.includeAiContent !== false);
  return {
    resourceId: room.resourceId,
    version,
    blocks: applyScope(blocks, request.scope ?? { kind: 'whole_note' }),
  };
}

/**
 * 在 NoteBlock 树中按内部块 ID 深度查找块
 */
function findBlock(blocks: Note['blocks'], blockId: string): Note['blocks'][number] | undefined {
  for (const block of blocks) {
    if (block.id === blockId) return block;
    const nested = findBlock(block.children, blockId);
    if (nested) return nested;
  }
  return undefined;
}

/**
 * 将块树摊平成先序列表，并清空 children
 */
function flattenBlocks(blocks: Note['blocks']): Note['blocks'] {
  return blocks.flatMap((block) => [{ ...block, children: [] }, ...flattenBlocks(block.children)]);
}

/**
 * 根据读取 scope 裁剪 NoteBlock 快照
 *
 * whole_note 保留完整树；
 * subtree 保留命中的整棵子树；
 * blocks 保留命中的离散块；
 * block_range 使用扁平阅读顺序截取闭区间
 */
function applyScope(
  blocks: Note['blocks'],
  scope: NonNullable<NoteReadRequest['scope']>,
): Note['blocks'] {
  if (scope.kind === 'whole_note') return blocks;
  if (scope.kind === 'subtree') {
    const block = findBlock(blocks, scope.blockId);
    return block ? [block] : [];
  }
  if (scope.kind === 'blocks') {
    return scope.blockIds
      .map((blockId) => findBlock(blocks, blockId))
      .filter((block): block is Note['blocks'][number] => block !== undefined);
  }
  const flattened = flattenBlocks(blocks);
  const start = flattened.findIndex((block) => block.id === scope.startBlockId);
  const end = flattened.findIndex((block) => block.id === scope.endBlockId);
  return start < 0 || end < 0 || start > end ? [] : flattened.slice(start, end + 1);
}
