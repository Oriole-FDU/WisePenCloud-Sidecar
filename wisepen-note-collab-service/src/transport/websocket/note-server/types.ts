import { ClientIntent } from '../../../application/services/yjs/types';

export interface QueuedWebSocketMessage {
  rawData: Buffer | string;
  isBinary: boolean;
}

export interface WebSocketConnectionContext {
  resourceId: string;
  userId: string;
  isReady: boolean;
  isWritable: boolean;
  messageQueue: QueuedWebSocketMessage[];
  intents: ClientIntent[];
}
