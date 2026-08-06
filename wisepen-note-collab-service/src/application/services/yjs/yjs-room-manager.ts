import { Logger } from '@nestjs/common';
import { WebSocket } from 'ws';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';

import { config } from '../../../config';
import { clearOplog, trackOperation } from './yjs-operation-logger'; // 引入精细追踪逻辑
import { startSnapshotScheduler, stopSnapshotScheduler, flushRoom } from './yjs-snapshot-flusher';
import { Room, UserConnection, ClientIntent } from './types';
import { loadDocFromNoteService } from './yjs-ydoc-manager';

const logger = new Logger('Room');

// 已创建的房间
// 网关 APISIX 需配置基于 resourceId 的一致性哈希路由，将同一 resourceId 的请求转发到同一实例
const rooms = new Map<string, Room>();
const initializingRooms = new Map<string, Promise<Room>>();

export function getRoom(resourceId: string): Room | undefined {
  return rooms.get(resourceId);
}

export function getAllRooms(): Map<string, Room> {
  return rooms;
}

export async function joinRoom(
  resourceId: string,
  ws: WebSocket,
  userId: string,
): Promise<Room> {
  let room = rooms.get(resourceId);

  // 如果房间不存在，则创建房间
  if (!room) {
    let initPromise = initializingRooms.get(resourceId);
    if (!initPromise) { // 如果房间正在初始化，则等待初始化完成，避免重复初始化
      initPromise = (async () => {
        try {
          logger.log(`Creating room for ${resourceId}`);
          // 从 Note 微服务加载最新快照并初始化 YDoc
          const { yDoc, stateVector, version } = await loadDocFromNoteService(resourceId);
          const newRoom: Room = {
            resourceId,
            yDoc,
            awareness: new awarenessProtocol.Awareness(yDoc),
            connections: new Map(),
            prevStateVector: stateVector,
            snapshotVersion: version,
            dirty: false,
            idleTimer: null,
            pendingBroadcasts: [],
            flushBroadcastsTimer: null,
            activeUsersInWindow: new Set<string>(),
            oplogGranularityMs: 3000,
          };

          // 监听 YDoc 的树状突变（适配BlockNote 编辑器）
          newRoom.yDoc.getXmlFragment('document-store').observeDeep((events, transaction) => {
            const intent = transaction.origin as ClientIntent;

            // 忽略系统级的更新（如初始化、内部同步）
            if (!intent || !intent.userId) return;

            // 解析 BlockNote 的复杂树状突变
            // 深度监听返回的是一个事件数组 (可能同时改了文本、又改了 Block 的背景色)
            const changes = events
            .filter(event => {
              // 保留纯文本的精确字符级修改 (叶子节点)
              if (event.target instanceof Y.XmlText) return true;
              // 保留 Block 块级属性的修改 (比如变粗体、改颜色、改标题层级)
              if (event.changes.keys.size > 0) return true;
              // 其他所有的父级冗余包裹事件直接丢弃
              return false;
            })
            .map(event => {
              return {
                path: event.path, 
                delta: event.changes.delta, 
                keys: Array.from(event.changes.keys.entries()) 
              };
            });
            if (changes.length > 0) {
              // 将提取出的树状增量传递给TrackOp攒批
              trackOperation(newRoom, intent.userId, intent.operationType, changes);
            }
          });

          // 监听 YDoc 的更新事件
          newRoom.yDoc.on('update', (updateBytes: Uint8Array, origin: any) => {
            // 标记为脏，表示有新的更新
            newRoom.dirty = true;
            // 记录活跃用户
            const intent = origin as ClientIntent;
            if (intent && intent.userId) {
              newRoom.activeUsersInWindow.add(intent.userId);
            } else {
              // 如果没有拿到意图（比如系统内部的全量合并），兜底为 system
              newRoom.activeUsersInWindow.add('system');
            }

            // 将原生的增量推入广播队列
            newRoom.pendingBroadcasts.push(updateBytes);

            // 启动 50ms 防抖定时器
            if (!newRoom.flushBroadcastsTimer) {
              newRoom.flushBroadcastsTimer = setTimeout(() => {
                newRoom.flushBroadcastsTimer = null;
                if (newRoom.pendingBroadcasts.length === 0) return;

                // 合并这 50ms 内的所有增量
                const mergedUpdate = Y.mergeUpdates(newRoom.pendingBroadcasts);
                newRoom.pendingBroadcasts = [];

                // 打包成标准 y-websocket 的 Sync 消息格式
                const encoder = encoding.createEncoder(); // 初始化一个二进制写入流
                encoding.writeVarUint(encoder, 0); // 写入 Message Type 0 (Sync)

                syncProtocol.writeUpdate(encoder, mergedUpdate); // 写入合并后的真实数据

                const message = encoding.toUint8Array(encoder); // 封箱，转换为 Uint8Array

                // 广播给所有人
                for (const [ws, _conn] of newRoom.connections) {
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(message);
                  }
                }
              }, 50); // 50ms 攒批
            }
          });

          // 监听 Awareness 的更新事件
          newRoom.awareness.on('update', ({ added, updated, removed }: any, origin: any) => {
            // origin 是 connection-handler.ts 传入的 ws 对象
            const ws = origin as WebSocket;
            const conn = newRoom.connections.get(ws);

            // 维护 WebSocket -> ClientID 的映射，用于后续防僵尸清理
            if (conn) {
              added.forEach((id: number) => conn.clientIds.add(id));
              removed.forEach((id: number) => conn.clientIds.delete(id));
            }

            // 打包成标准 y-websocket 的 Awareness 消息格式
            const changedClients = added.concat(updated, removed);

            const encoder = encoding.createEncoder(); // 初始化一个二进制写入流
            encoding.writeVarUint(encoder, 1); // 写入 Message Type 1 (Awareness)

            // 传入发生变动的 clientIds，可把这些 client 最新的位置坐标压缩成一个二进制包
            const update = awarenessProtocol.encodeAwarenessUpdate(newRoom.awareness, changedClients);

            encoding.writeVarUint8Array(encoder, update); // 写入最新的光标二进制数据

            const message = encoding.toUint8Array(encoder); // 封箱，转换为 Uint8Array

            // 实时广播给所有人
            // 不需要防抖，因为光标数据极小且需要极致流畅
            for (const [ws, _conn] of newRoom.connections) {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(message);
              }
            }
          });

          rooms.set(resourceId, newRoom);
          startSnapshotScheduler(newRoom);
          initializingRooms.delete(resourceId); // 初始化完成，移除锁
          return newRoom;
        } finally {
          // 无论初始化成功还是失败抛错，必须释放并发锁！
          initializingRooms.delete(resourceId);
        }
      })();
      initializingRooms.set(resourceId, initPromise);
    }
    room = await initPromise; // 等待初始化完成
  }

  // 如果房间已有延时销毁定时器，则清除
  if (room.idleTimer) {
    clearTimeout(room.idleTimer);
    room.idleTimer = null;
  }

  if (ws.readyState !== WebSocket.OPEN) {
    logger.log(`Ghost connection from ${userId} aborted before injecting into room.`);
    return room;
  }

  // 添加用户连接
  const conn: UserConnection = { ws, userId, resourceId, clientIds: new Set<number>() };
  room.connections.set(ws, conn);

  // 主动为新连入的用户下发当前房间里已有的全量光标状态
  const currentClientIds = Array.from(room.awareness.getStates().keys());
  if (currentClientIds.length > 0 && ws.readyState === WebSocket.OPEN) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 1); // Message Type 1 (Awareness)
    
    // 提取当前大厅里所有人的全量光标二进制数据
    const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(room.awareness, currentClientIds);
    encoding.writeVarUint8Array(encoder, awarenessUpdate);
    
    ws.send(encoding.toUint8Array(encoder));
  }

  logger.log(`User ${userId} joined room ${resourceId} (${room.connections.size} users)`);
  return room;
}

export async function leaveRoom(resourceId: string, ws: WebSocket): Promise<void> {
  const room = rooms.get(resourceId);
  if (!room) return;

  // 删除用户连接
  const conn = room.connections.get(ws);
  if (conn) {
    // 拔除该用户留下的所有僵尸光标
    // 第三个参数 origin 传 null，表示这是服务端主动清理
    awarenessProtocol.removeAwarenessStates(
      room.awareness,
      Array.from(conn.clientIds),
      null
    );
  }
  room.connections.delete(ws);

  logger.log(`User ${conn?.userId} left room ${resourceId} (${room.connections.size} remaining)`);

  // 优雅延时销毁
  // 用户可能经常会刷新页面，或遇到短暂的网络抖动，销毁房间需要一定的延时，避免频繁创建和销毁房间
  if (room.connections.size === 0) {
    room.idleTimer = setTimeout(async () => {
      logger.log(`Destroying idle room ${resourceId}`);

      await flushRoom(room);

      stopSnapshotScheduler(room);

      // 销毁 Awareness 和 YDoc
      room.awareness.destroy();
      room.yDoc.destroy();
      // 清空操作日志
      clearOplog(resourceId);

      rooms.delete(resourceId);

    }, config.collab.roomIdleDestroyDelayMs);
  }
}
