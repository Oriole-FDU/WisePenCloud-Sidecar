import { WebSocket } from 'ws';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';

export interface ClientIntent {
  operationType: OperationType;
  source?: string;
  userId?: string; 
}

export type OperationType =
  | 'PASTE'
  | 'UNDO'
  | 'REDO'
  | 'AI_DIFF'
  | 'OTHER'
  | 'KEYBOARD';

export interface UserConnection {
  ws: WebSocket;
  userId: string;
  resourceId: string;

  // SharedWorker (多 Tab 共享连接)
  // HTML5 的 SharedWorker 技术可使得若干标签页在本地共用 WebSocket 连接到服务器
  clientIds: Set<number>;
}

export interface Room {
  // 资源ID
  resourceId: string;
  // 资源对应的 YDoc
  yDoc: Y.Doc;

  awareness: awarenessProtocol.Awareness;

  // 用户连接
  connections: Map<WebSocket, UserConnection>;
  // 非 WebSocket 调用持有的短期引用，避免 AI 读写期间房间被空闲回收
  activeLeases: number;
  // 在销毁时是否需要强制发送 FULL 版本
  forceFullOnDestroy: boolean;
  // 上一个状态向量
  prevStateVector: Uint8Array | null;
  // 已持久化快照版本
  snapshotVersion: number;
  
  dirty: boolean;
  // 延时销毁定时器
  idleTimer: ReturnType<typeof setTimeout> | null;

  // 攒批缓冲区
  pendingBroadcasts: Uint8Array[];
  // 攒批定时器
  flushBroadcastsTimer: NodeJS.Timeout | null;

  activeUsersInWindow: Set<string>;

  oplogGranularityMs: number;
}