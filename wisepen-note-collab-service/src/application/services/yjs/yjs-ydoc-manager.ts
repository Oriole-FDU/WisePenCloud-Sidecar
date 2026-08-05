import * as Y from 'yjs';
import { getLatestSnapshot } from '../../../infrastructure/external-client/note-service-client';

// 从 Note 微服务加载最新快照并初始化 YDoc
export async function loadDocFromNoteService(
  resourceId: string,
): Promise<{
  yDoc: Y.Doc;
  stateVector: Uint8Array | null;
  version: number;
}> {
  const yDoc = new Y.Doc();
  // 从 Note 微服务加载最新快照
  // fullSnapshot: 最近一次的 FULL 快照 (可能为空，如果是新文档)
  // deltas: 在该 FULL 之后产生的所有 DELTA 增量数组 (一般为空，除非出现异常退出)
  const { fullSnapshot, deltas, version } = await getLatestSnapshot(resourceId);
  
  console.log(`[DocManager] Loaded snapshot for ${resourceId}: fullSnapshot=${fullSnapshot ? fullSnapshot.length : 0} bytes, deltas=${deltas ? deltas.length : 0} entries, version=${version}`);

  if (fullSnapshot && fullSnapshot.length > 0) {
    // 应用快照到 YDoc
    Y.applyUpdate(yDoc, fullSnapshot);
  }

  if (deltas && deltas.length > 0) {
    for (const delta of deltas) {
      Y.applyUpdate(yDoc, delta);
    }
  }

  return {
    yDoc,
    stateVector: Y.encodeStateVector(yDoc),
    version: Number(version) || 0,
  };
}

// 生成当前 YDoc 的完整快照
export function encodeFullSnapshot(yDoc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(yDoc);
}

// 生成相对于 prevStateVector 的增量
export function encodeDelta(yDoc: Y.Doc, prevStateVector: Uint8Array): Uint8Array {
  return Y.encodeStateAsUpdate(yDoc, prevStateVector);
}

// 获取当前 stateVector
// stateVector 是 Yjs 用来描述 某个副本目前已经同步到哪里 的向量
export function getStateVector(yDoc: Y.Doc): Uint8Array {
  return Y.encodeStateVector(yDoc);
}
