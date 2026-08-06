import { Room } from './types';

export interface OplogEntry {
  userId: string;
  operationType: string;
  updateData?: string;
  contentSummary?: string;
  timestamp: number;
  mergedCount: number;
  details?: any[];
}

/** 每个房间的待发送操作日志缓冲区 */
const oplogBuffers = new Map<string, OplogEntry[]>();

function tryMergeTextDelta(existingDetails: any[], newDeltaBatch: any[]): boolean {
  if (!existingDetails || existingDetails.length === 0 || !newDeltaBatch || newDeltaBatch.length !== 1) return false;
  
  const lastBatch = existingDetails[existingDetails.length - 1];
  if (!lastBatch || lastBatch.length !== 1) return false;

  const lastChange = lastBatch[0];
  const newChange = newDeltaBatch[0];

  // 必须在同一个 Block 路径下
  if (JSON.stringify(lastChange.path) !== JSON.stringify(newChange.path)) return false;

  const lastOp = lastChange.delta;
  const newOp = newChange.delta;
  
  // 必须是标准的连续打字结构：[{retain: X}, {insert: "a"}]
  if (
    lastOp && lastOp.length === 2 && typeof lastOp[1].insert === 'string' &&
    newOp && newOp.length === 2 && typeof newOp[1].insert === 'string' &&
    lastOp[0].retain !== undefined && newOp[0].retain !== undefined
  ) {
    // 核心：如果新的起步位置（retain）刚好等于旧位置 + 旧字符串长度
    if (newOp[0].retain === lastOp[0].retain + lastOp[1].insert.length) {
      // 触发数据合并
      lastOp[1].insert += newOp[1].insert;
      return true; // 通知合并成功
    }
  }
  return false;
}


export function trackOperation(
  room: Room,
  userId: string,
  operationType: string,
  delta: any[] // Yjs 传递过来的具体修改细节
): void {
  let buffer = oplogBuffers.get(room.resourceId);
  if (!buffer) {
    buffer = [];
    oplogBuffers.set(room.resourceId, buffer);
  }

  const now = Date.now();
  // 房间级别的粒度配置（未来可从数据库加载，默认为 3000ms）
  const mergeWindow = room.oplogGranularityMs || 3000;

  if (mergeWindow > 0 && buffer.length > 0) {
    const last = buffer[buffer.length - 1];
    if (
      last.userId === userId &&
      last.operationType === operationType &&
      now - last.timestamp < mergeWindow
    ) {
      last.mergedCount += 1;
      last.timestamp = now;
      if (delta) {
        last.details = last.details || [];
        const isMerged = tryMergeTextDelta(last.details, delta);
        if (!isMerged) {
          last.details.push(delta); // 只有合并不了的才开新数组（如换行、更改颜色），
        }
      }
      return;
    }
  }

  buffer.push({
    userId,
    operationType,
    timestamp: now,
    mergedCount: 1,
    details: delta ? [delta] : [],
  });
}

/**
 * 取出并清空指定房间的操作日志缓冲区
 */
export function drainOplog(resourceId: string): OplogEntry[] {
  const buffer = oplogBuffers.get(resourceId);
  if (!buffer || buffer.length === 0) return [];
  oplogBuffers.set(resourceId, []);
  return buffer;
}

export function clearOplog(resourceId: string): void {
  oplogBuffers.delete(resourceId);
}
