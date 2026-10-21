import { Room } from '../../yjs/types';
import {
  appendEmptyRootBlock,
  findBlockLocation,
  getAiContentStore,
  insertEmptyBlock,
} from './note-ydoc-writer';
import {
  decodePatchContent,
  emptyNoteBlockContent,
  isEditableBlockType,
} from './patch-content-codec';
import {
  NotePatchOperationResult,
  NotePatchRequest,
  NotePatchResponse,
  PatchOperation,
} from '../request-types';
import { jsonEqual } from '../utils';
import { createDeterministicBlockId, getReadableVersion } from '../yjs-ids';

/**
 * 构造单条 AI patch 操作的冲突结果
 */
function conflict(
  operation: PatchOperation,
  reason: NotePatchOperationResult['reason'],
  blockId?: string,
): NotePatchOperationResult {
  return { opId: operation.opId, status: 'conflict', reason, ...(blockId ? { blockId } : {}) };
}

/**
 * 应用 replaceContent/deleteBlock 两类“命中已有块”的操作
 */
function applyReplaceOrDelete(
  room: Room,
  operation: Extract<PatchOperation, { kind: 'replaceContent' | 'deleteBlock' }>,
): NotePatchOperationResult {
  // replace/delete 必须命中一个已经存在的真实块；找不到说明 AI 基于的快照已经不可用
  const location = findBlockLocation(room.yDoc, operation.blockId);
  if (!location) return conflict(operation, 'block_missing', operation.blockId);
  const type = location.block.nodeName;

  // 把 AI patch 的内容转换成 BlockNote/Yjs 可写入的内容
  const content =
    operation.kind === 'deleteBlock'
      ? emptyNoteBlockContent(type) // 生成一个“空内容建议”
      : decodePatchContent(type, operation.content); // 把 AI patch 的内容转换成 BlockNote/Yjs 可写入的内容，作为替换建议

  // 检查块类型和内容是否合法
  if (!isEditableBlockType(type)) {
    return conflict(operation, 'unsupported_type', operation.blockId);
  }
  if (content === null) return conflict(operation, 'invalid_content', operation.blockId);

  // 获取文档的 AI 内容存储区
  const store = getAiContentStore(room.yDoc);

  // 如果建议层里已经有完全相同的内容，说明这条操作之前已经应用过；
  // 返回 unchanged，保证同一个 patch 重试时不会产生额外写入
  if (store.has(operation.blockId) && jsonEqual(store.get(operation.blockId), content)) {
    return { opId: operation.opId, status: 'unchanged', blockId: operation.blockId };
  }

  // 把 AI 建议内容写入独立 store，让前端作为建议层展示或采纳
  store.set(operation.blockId, content);
  return { opId: operation.opId, status: 'applied', blockId: operation.blockId };
}

/**
 * 应用锚点插入或根级追加操作
 */
function applyInsert(
  room: Room,
  request: NotePatchRequest,
  operation: Extract<PatchOperation, { kind: 'insertBlock' | 'appendRootBlock' }>,
  lastAfterBlockByAnchor: Map<string, string>,
): NotePatchOperationResult {
  // 生成确定性块 ID（AI块专用，根据 resourceId + patchId + opId 生成）
  const blockId = createDeterministicBlockId(room.resourceId, request.patchId, operation.opId);
  // 检查这个块是否已经存在
  const existing = findBlockLocation(room.yDoc, blockId);
  // 把 AI patch 的内容转换成 BlockNote/Yjs 可写入的内容，作为插入建议
  const content = decodePatchContent(operation.block.type, operation.block.content);
  // 检查块类型和内容是否合法
  if (!isEditableBlockType(operation.block.type)) {
    return conflict(operation, 'unsupported_type', blockId);
  }
  if (content === null) return conflict(operation, 'invalid_content', blockId);

  // 获取文档的 AI 内容存储区
  const store = getAiContentStore(room.yDoc);

  if (existing) { // 若块已经存在
    // 如果已有块的类型和 AI 内容都和本次请求一致，说明是重复提交，返回 unchanged
    if (existing.block.nodeName === operation.block.type && jsonEqual(store.get(blockId), content)) {
      if (operation.kind === 'insertBlock' && operation.position === 'after') {
        // 记录为“原始锚点后最近插入的块”
        lastAfterBlockByAnchor.set(operation.anchorBlockId, blockId);
      }
      return { opId: operation.opId, status: 'unchanged', blockId };
    }
    // 同一个确定性块 ID 对应了不同类型或内容，说明这次请求和历史应用结果冲突
    return conflict(operation, 'invalid_content', blockId);
  }

  if (operation.kind === 'appendRootBlock') {
    appendEmptyRootBlock(
      room.yDoc,
      blockId,
      operation.block.type,
      operation.block.attrs ?? {},
    );
  } else {
    // before 直接使用原始锚点即可：连续 before 同一个块时，锚点会被前面的插入自然推后，顺序仍然正确。
    // after 不能一直使用原始锚点：数组按 index 插入时，连续 after 同一个块会反复插到 anchor.index + 1，导致顺序反转
    // 因此 after 需要改用“这个原始锚点后最近插入的块”作为实际锚点
    const effectiveAnchorId =
      operation.position === 'after'
        ? (lastAfterBlockByAnchor.get(operation.anchorBlockId) ?? operation.anchorBlockId)
        : operation.anchorBlockId;

    // 找到最终锚点块；找不到说明 AI 基于的块位置已经不可用，返回 anchor_missing 冲突
    const anchor = findBlockLocation(room.yDoc, effectiveAnchorId);
    if (!anchor) return conflict(operation, 'anchor_missing', blockId);

    // 在最终锚点前后插入一个空 BlockNote 块占位（AI 建议内容不直接进入正文，由前端关联）
    insertEmptyBlock(
      room.yDoc,
      anchor,
      operation.position,
      blockId,
      operation.block.type,
      operation.block.attrs ?? {},
    );
    // 记录本轮 patch 中，“原始锚点”后最后插入的块。
    // 后续继续 after 同一个原始锚点时，会接在这个块后面，避免顺序反转
    if (operation.position === 'after') {
      lastAfterBlockByAnchor.set(operation.anchorBlockId, blockId);
    }
  }

  // 把 AI 建议内容写入独立 store，让前端作为建议层展示或采纳
  store.set(blockId, content);
  return { opId: operation.opId, status: 'applied', blockId };
}

/**
 * 将 AI Diff 请求应用到共享 Yjs 房间，并返回逐操作结果
 */
export function applyPatchToActiveRoom(
  room: Room,
  request: NotePatchRequest,
  userId: string,
): NotePatchResponse {
  const currentVersion = getReadableVersion(room.yDoc);
  const results: NotePatchOperationResult[] = [];
  const lastAfterBlockByAnchor = new Map<string, string>();

  // 在一个 Yjs transaction 里执行所有操作
  // transaction origin 标记为 AI_DIFF，供 yjs-room-manager 的操作追踪和广播逻辑识别来源
  room.yDoc.transact(() => {
    for (const operation of request.operations) {
      if (operation.kind === 'insertBlock' || operation.kind === 'appendRootBlock') {
        // 插入块
        results.push(applyInsert(room, request, operation, lastAfterBlockByAnchor));
      } else {
        // 取代或删除块
        results.push(applyReplaceOrDelete(room, operation));
      }
    }
  }, { operationType: 'AI_DIFF', source: 'ai-note-internal', userId });

  return {
    resourceId: room.resourceId,
    requestedVersion: request.version,
    currentVersion,
    resultVersion: getReadableVersion(room.yDoc),
    modified: request.version !== currentVersion,
    results,
  };
}
