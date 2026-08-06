import { Logger } from '@nestjs/common';
import expressWs from 'express-ws';
import { WebSocket } from 'ws';
import { joinRoom, leaveRoom } from '../../../application/services/yjs';
import { checkPermission } from '../../../infrastructure/external-client/resource-service-client';
import { getSecurityContext } from '../../../shared/context/request-context-holder';
import { checkSecurityPolicy } from '../../../shared/security/security-aspect';
import { interceptHeaders } from '../../header-interceptor';
import { routeWebSocketMessage } from './message-router';
import { WebSocketConnectionContext } from './types';

const logger = new Logger('WebSocket');

export function registerWebSocketRoutes(
  app: expressWs.Application,
): void {
  app.ws('/note-collab/ws', (ws: WebSocket, req) => {
    void Promise.resolve().then(() => interceptHeaders(req.headers, async () => {
      const url = new URL(req.originalUrl || req.url || '/', `http://${req.headers.host}`);
      const resourceId = url.searchParams.get('resourceId');

      if (!resourceId) {
        ws.close(4001, 'Missing resourceId');
        return;
      }

      try {
        checkSecurityPolicy({ login: true });
        const securityContext = getSecurityContext()!;
        const userId = securityContext.userId!;
        const groupRoleMap = securityContext.groupRoleMap;
        const context: WebSocketConnectionContext = {
          resourceId,
          userId,
          isReady: false,
          isWritable: false,
          messageQueue: [],
          intents: [],
        };

        // 处理客户端消息
        ws.on('message', (rawData: Buffer | string) => {
          const isBinary = !(typeof rawData === 'string' || rawData.toString('utf8').trimStart().startsWith('{'));
          if (!context.isReady) {
            // 如果鉴权或房间还没准备好，先丢进队列暂存
            context.messageQueue.push({ rawData, isBinary: isBinary });
          } else {
            routeWebSocketMessage(ws, context, rawData, isBinary);
          }
        });

        // 离开房间
        ws.on('close', () => {
          leaveRoom(resourceId, ws).catch((err: unknown) =>
            logger.error(`Error leaving room ${resourceId}`, err instanceof Error ? err.stack : String(err)),
          );
        });

        ws.on('error', (err) => {
          logger.error(`Connection error in room ${resourceId}`, err instanceof Error ? err.stack : String(err));
        });

        const { resourceAccessRole, allowedActions } = await checkPermission(
          resourceId,
          userId,
          groupRoleMap,
        );

        if (resourceAccessRole === 'NONE') {
          logger.warn(`Permission denied userId=${userId} resourceId=${resourceId} groupRoleMap=${JSON.stringify(groupRoleMap)}`);
          ws.close(4003, 'Resource Permission denied');
          return;
        }
        // 判断数组中是否包含协同编辑权限
        context.isWritable = Boolean(allowedActions && allowedActions.includes('EDIT'));

        // 加入房间
        await joinRoom(resourceId, ws, userId);

        context.isReady = true; // 鉴权和房间准备完成，标记连接为就绪状态

        // 处理之前暂存的消息
        while (context.messageQueue.length > 0) {
          const msg = context.messageQueue.shift()!;
          routeWebSocketMessage(ws, context, msg.rawData, msg.isBinary);
        }
      } catch (err) {
        logger.error(`Connection setup failed for ${resourceId}`, err instanceof Error ? err.stack : String(err));
        ws.close(4500, 'Connection setup error');
        return;
      }
    })).catch((err) => {
      logger.error('Header intercept failed', err instanceof Error ? err.stack : String(err));
      ws.close(4004, 'Invalid source');
    });
  });
}
