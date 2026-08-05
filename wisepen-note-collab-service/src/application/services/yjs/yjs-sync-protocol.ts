import { WebSocket } from 'ws';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { ClientIntent, Room } from './types';

export function handleYjsBinaryMessage(
  room: Room,
  rawData: Buffer,
  currentIntent: ClientIntent,
  isWritable: boolean,
  origin: WebSocket,
): Uint8Array | undefined {
  // 创建一个二进制读取流
  const decoder = decoding.createDecoder(new Uint8Array(rawData.buffer, rawData.byteOffset, rawData.byteLength));
  // 创建一个二进制写入流（预回包）
  const encoder = encoding.createEncoder();

  // 读取第 1 个字节 (Message Type)
  const messageType = decoding.readVarUint(decoder);

  if (messageType === 0) { // Sync 文档同步
    // 只读连接：仅允许 SyncStep1（状态向量握手）和 SyncStep2（服务端回包），
    // 拒绝 SyncUpdate（messageYjsSyncType === 2）以阻止写入
    const peekSyncType = decoding.peekVarUint(decoder);
    if (!isWritable && peekSyncType === 2) {
      return undefined; // 无编辑权限，丢弃增量更新
    }

    encoding.writeVarUint(encoder, 0); // 写入 Message Type 0 (Sync)

    // 如果是 增量更新，则提取操作增量，并直接触发底层的 Y.applyUpdate(yDoc, update)
    // 如果是 状态向量握手/版本交换，则将服务端的完整 yDoc 历史，与收到的客户端 State Vector 进行集合差集运算
    // 最终得到服务端缺失的完整 yDoc 历史，并写入 encoder
    // 直接传递 decoder，无需事先转成 Uint8Array
    syncProtocol.readSyncMessage(decoder, encoder, room.yDoc, currentIntent);

    // 如果 encoder 的长度大于 1（说明是状态向量握手/版本交换），则回包
    return encoding.length(encoder) > 1 ? encoding.toUint8Array(encoder) : undefined;
  }

  if (messageType === 1) {// Awareness 光标状态
    const awarenessUpdate = decoding.readVarUint8Array(decoder); // 读取最新的光标二进制数据

    // Diff，更新状态机，然后触发更新事件
    // origin 用于标记光标更新来源
    awarenessProtocol.applyAwarenessUpdate(room.awareness, awarenessUpdate, origin);
  }

  return undefined;
}
