import { Logger } from '@nestjs/common';
import { WebSocket } from 'ws';
import { handleYjsBinaryMessage, getRoom } from '../../../application/services/yjs';
import { ClientIntent } from '../../../application/services/yjs/types';
import { WebSocketConnectionContext } from './types';

const logger = new Logger('WebSocket');

export function routeWebSocketMessage(
  ws: WebSocket,
  context: WebSocketConnectionContext,
  rawData: Buffer | string,
  isBinary: boolean,
): void {
  try {
    const room = getRoom(context.resourceId);
    if (!room) return;

    // --- 文本帧 ---
    if (!isBinary) { // 收到文本帧，解析意图
      /**
       * 解析客户端通过 WebSocket 文本帧发来的业务意图 (Intent)
       */
      try {
        const str = rawData.toString('utf8');
        const parsed = JSON.parse(str);

        if (parsed.type === 'meta' && parsed.intent) {
          context.intents.push({
            operationType: parsed.intent.operationType || 'OTHER',
            source: parsed.intent.source,
            userId: context.userId, // 注入身份
          });
        }
      } catch (err) {
        // 非法 JSON 或不符合格式，直接丢弃
      }
      return; // 暂存完毕，直接返回，等待紧随其后的二进制帧
    }

    // --- 二进制帧 ---
    // 消费意图并处理数据
    // 严格遵循 FIFO。如果没有意图，降级为普通键盘打字
    const currentIntent: ClientIntent = context.intents.length > 0
      ? context.intents.shift()!
      : { operationType: 'KEYBOARD', userId: context.userId };

    const response = handleYjsBinaryMessage(
      room,
      Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData),
      currentIntent,
      context.isWritable,
      ws,
    );
    if (response) {
      ws.send(response);
    }
  } catch (err) {
    logger.error(`Error processing message in room ${context.resourceId}`, err instanceof Error ? err.stack : String(err));
  }
}
