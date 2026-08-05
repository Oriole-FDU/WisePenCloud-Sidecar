import * as Y from 'yjs';
import { NoteSnapshotMessage, sendOperationLogs, sendSnapshot } from '../../../infrastructure/messaging/kafka-producer';
import { Room } from './types';
import { encodeFullSnapshot, encodeDelta, getStateVector } from './yjs-ydoc-manager';
import { drainOplog, clearOplog } from './yjs-operation-logger';
import { config } from '../../../config';

// 使用对象存储定时器引用和活动状态，便于安全地清除
const schedulerState = new Map<string, { active: boolean, timer?: NodeJS.Timeout }>();

// 启动快照调度器
export function startSnapshotScheduler(
  room: Room,
): void {
  if (schedulerState.has(room.resourceId)) return;

  schedulerState.set(room.resourceId, { active: true });
  console.log(`[Scheduler] Started for room ${room.resourceId}`);

  // 启动递归调度
  scheduleNextFlush(room);
}

// 停止快照调度器
export function stopSnapshotScheduler(room: Room): void {
  const state = schedulerState.get(room.resourceId);
  if (state) {
    state.active = false;
    if (state.timer) clearTimeout(state.timer);
    schedulerState.delete(room.resourceId);
    console.log(`[Scheduler] Stopped for room ${room.resourceId}`);
  }
}

// 递归调度
// 等待本次 flush 彻底完成，再排队下一次
async function scheduleNextFlush(
  room: Room,
) {
  const state = schedulerState.get(room.resourceId);
  if (!state || !state.active) return;

  state.timer = setTimeout(async () => {
    try {
      if (room.dirty) {
        await flushRoom(room);
      }
    } catch (err) {
      console.error(`[Scheduler] Flush failed for room ${room.resourceId}`, err);
    } finally {
      // 无论成功还是失败（例如网络抖动），都要在结束后再排队下一次
      scheduleNextFlush(room);
    }
  }, config.collab.snapshotFlushIntervalMs);
}

export async function flushRoom(
  room: Room,
): Promise<void> {
  // 优先排空操作日志 (Oplog)
  // 日志是追加写入的，无论有没有快照产生，只要缓冲池有数据就发走
  const oplogEntries = drainOplog(room.resourceId);
  if (oplogEntries.length > 0) {
    await sendOperationLogs({
      resourceId: room.resourceId,
      entries: oplogEntries,
    });
  }

  if (!room.dirty) {
    return;
  }

  // 以下逻辑只有在真正有数据变动时才会执行

  const currentAuthors = Array.from(room.activeUsersInWindow);
  if (currentAuthors.length === 0) {
    currentAuthors.push('system');
  }

  // --- 增量快照 (DELTA) 逻辑 ---

  if (room.prevStateVector) {
    room.snapshotVersion += 1; // 版本号递增
    const version = room.snapshotVersion;

    // 获取当前状态向量
    const stateVector = getStateVector(room.yDoc);

    // 生成增量快照消息
    const deltaMsg: NoteSnapshotMessage = {
      resourceId: room.resourceId,
      version,
      type: 'DELTA',
      data: Buffer.from(encodeDelta(room.yDoc, room.prevStateVector)).toString('base64'),
      updatedBy: currentAuthors,
    };

    // 发送增量快照消息
    await sendSnapshot(deltaMsg);

    // 更新状态
    room.prevStateVector = stateVector;
    console.log(`[Scheduler] Flushed DELTA for room ${room.resourceId} v${version}`);
  } else {
    // 首次创建，初始化一个基准状态向量
    room.prevStateVector = getStateVector(room.yDoc);
    room.snapshotVersion = 1;
  }


  // --- 全量快照点 (Checkpoint) 逻辑 ---
  const version = room.snapshotVersion;
  // 每 config.collab.checkpointInterval 次版本号递增，就生成一个全量快照
  const isCheckpoint = (version > 0 && version % config.collab.checkpointInterval === 0);

  if (isCheckpoint) {
    // 提取纯文本内容，供 Java 端直接存入 Elasticsearch 或 MySQL 全文索引
    // 适配 BlockNote 编辑器
    const documentStore = room.yDoc.getXmlFragment('document-store');
    const plainText = JSON.stringify(documentStore.toJSON());

    const fullMsg: NoteSnapshotMessage = {
      resourceId: room.resourceId,
      version,
      type: 'FULL',
      data: Buffer.from(encodeFullSnapshot(room.yDoc)).toString('base64'),
      plainText: plainText,
      updatedBy: currentAuthors,
    };

    // 发送全量快照消息
    await sendSnapshot(fullMsg);
    console.log(`[Scheduler] Flushed FULL Checkpoint for room ${room.resourceId} v${version}`);
  }

  // 清空本轮时间窗口的活跃用户集合
  room.activeUsersInWindow.clear();
  // 清除脏标记
  room.dirty = false;
}
