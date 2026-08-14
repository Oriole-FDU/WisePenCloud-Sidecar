import { Logger } from '@nestjs/common';
import { NoteSnapshotMessage, sendOperationLogs, sendSnapshot } from '../../../infrastructure/messaging/kafka-producer';
import { Room } from './types';
import { encodeFullSnapshot, encodeDelta, getStateVector } from './yjs-ydoc-manager';
import { drainOplog } from './yjs-operation-logger';
import { config } from '../../../config';
import { readNoteBlocks } from '../note-ai/read/note-ydoc-reader';
import { renderNoteMarkdown } from '../note-ai/read/note-markdown-codec';

const logger = new Logger('SnapshotScheduler');

const DEFAULT_MAX_DELTA_VERSIONS_BEFORE_FULL = 9;

// 使用对象存储定时器引用和活动状态，便于安全地清除
const schedulerState = new Map<string, { active: boolean, timer?: NodeJS.Timeout }>();
// 同一个 room 可能同时触发定时 flush 和关闭 flush；串行化后可避免两个调用抢到同一个版本号
const flushLocks = new Map<string, Promise<void>>();

export interface FlushRoomOptions {
  // 关闭房间时即使没有新变更，也需要发一个 FULL，便于 Java 将当前版本压实为完整恢复点
  forceFull?: boolean;
}

function getCheckpointEvery(): number {
  // 业务语义是“最多 9 个非必定全量版本后，下一个 x0 版本必须 FULL”
  // 配置项存的是可容忍的 DELTA 槽位数，真正取模周期需要 +1
  const maxDeltaVersions = Number(config.collab.maxDeltaVersionsBeforeFull);
  if (Number.isFinite(maxDeltaVersions) && maxDeltaVersions >= 0) {
    return Math.floor(maxDeltaVersions) + 1;
  }

  return DEFAULT_MAX_DELTA_VERSIONS_BEFORE_FULL + 1;
}

function isCheckpointVersion(version: number): boolean {
  const checkpointEvery = getCheckpointEvery();
  return version > 0 && version % checkpointEvery === 0;
}

function renderFullPlainText(room: Room): string {
  try {
    // 先读成 NoteBlock AST，再渲染 Markdown，避免把 Yjs/BlockNote 内部结构写进 rawText
    return renderNoteMarkdown(readNoteBlocks(room.yDoc, false));
  } catch (err) {
    logger.warn(`Failed to render plainText for room ${room.resourceId}: ${err instanceof Error ? err.message : String(err)}`);
    return '';
  }
}

async function sendFullSnapshot(
  room: Room,
  version: number,
  updatedBy: string[],
): Promise<void> {
  // FULL 消息包括 Yjs 二进制恢复点和 rawText 搜索文本投影
  const fullMsg: NoteSnapshotMessage = {
    resourceId: room.resourceId,
    version,
    type: 'FULL',
    data: Buffer.from(encodeFullSnapshot(room.yDoc)).toString('base64'),
    plainText: renderFullPlainText(room),
    updatedBy,
  };

  await sendSnapshot(fullMsg);
}

// 启动快照调度器
export function startSnapshotScheduler(
  room: Room,
): void {
  if (schedulerState.has(room.resourceId)) return;

  schedulerState.set(room.resourceId, { active: true });
  logger.log(`Started for room ${room.resourceId}`);

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
    logger.log(`Stopped for room ${room.resourceId}`);
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
      logger.error(`Flush failed for room ${room.resourceId}`, err instanceof Error ? err.stack : String(err));
    } finally {
      // 无论成功还是失败（例如网络抖动），都要在结束后再排队下一次
      scheduleNextFlush(room);
    }
  }, config.collab.snapshotFlushIntervalMs);
}

async function flushRoomNow(
  room: Room,
  options: FlushRoomOptions = {},
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

  // 普通定时 flush 在没有内容变化时，不应该产生新快照版本；但关闭房间时例外
  const shouldFlushSnapshot = room.dirty || options.forceFull;
  if (!shouldFlushSnapshot) {
    return;
  }

  // 以下逻辑只有在真正有数据变动，或显式要求关闭全量快照时才会执行

  // Java 侧会将 updatedBy 转成 Long；过滤掉 system/空值等非数字来源，避免 clean close 触发解析失败
  const currentAuthors = Array.from(room.activeUsersInWindow).filter((userId) => /^\d+$/.test(userId));

  // clean close 没有内容变化，只是把当前版本从 DELTA 压实为 FULL，因此复用当前版本号；
  // dirty flush/dirty close 仍然需要创建下一版本。新文档没有当前版本时，回退为 v1 FULL。
  const shouldReuseCurrentVersion = options.forceFull && !room.dirty && room.snapshotVersion > 0;
  const version = shouldReuseCurrentVersion ? room.snapshotVersion : room.snapshotVersion + 1;
  const stateVector = getStateVector(room.yDoc);
  // x0 checkpoint 只发 FULL，不再同版本先 DELTA 再 FULL。
  // clean close 的同版本 FULL 由 Java 侧负责替换同版本 DELTA，不创建新版本。
  const prevStateVector = room.prevStateVector;
  const shouldSendFull = options.forceFull || isCheckpointVersion(version) || !prevStateVector;


  if (shouldSendFull) {
    await sendFullSnapshot(room, version, currentAuthors);
    logger.log(`Flushed FULL for room ${room.resourceId} v${version}${options.forceFull ? ' (forced)' : ''}`);
  } else {
    const deltaMsg: NoteSnapshotMessage = {
      resourceId: room.resourceId,
      version,
      type: 'DELTA',
      data: Buffer.from(encodeDelta(room.yDoc, prevStateVector)).toString('base64'),
      updatedBy: currentAuthors,
    };

    await sendSnapshot(deltaMsg);
    logger.log(`Flushed DELTA for room ${room.resourceId} v${version}`);
  }

  // Kafka 发送成功后再提交内存版本号；发送失败时保留 dirty，下一轮可用同一个版本重试
  room.snapshotVersion = version;
  room.prevStateVector = stateVector;
  // 清空本轮时间窗口的活跃用户集合
  room.activeUsersInWindow.clear();
  // 清除脏标记
  room.dirty = false;
}

export async function flushRoom(
  room: Room,
  options: FlushRoomOptions = {},
): Promise<void> {
  // 复用上一轮 promise 形成 per-room 队列
  // 上一轮失败不会阻塞后续重试
  const previous = flushLocks.get(room.resourceId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => flushRoomNow(room, options));

  flushLocks.set(room.resourceId, next);

  try {
    await next;
  } finally {
    if (flushLocks.get(room.resourceId) === next) {
      flushLocks.delete(room.resourceId);
    }
  }
}
