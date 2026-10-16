import { createHash } from 'crypto';
import * as Y from 'yjs';

/**
 * 为当前 Y.Doc 生成可读版本号
 *
 * 版本号基于 Y.encodeStateAsUpdate 的完整状态哈希，格式固定为 yjs-v1:<digest>
 */
export function getReadableVersion(doc: Y.Doc): string {
  const encodedState = Y.encodeStateAsUpdate(doc);
  const digest = createHash('sha256').update(encodedState).digest('base64url');
  return `yjs-v1:${digest}`;
}

/**
 * 为 AI 插入块生成确定性块 ID
 *
 * 同一个 resourceId/patchId/opId 永远得到同一个 ai_<hash>
 * 这样在重试同一 patch 时不会插入新块，可被识别为同一 AI 生成块
 */
export function createDeterministicBlockId(
  resourceId: string,
  patchId: string,
  opId: string,
): string {
  const digest = createHash('sha256')
    .update(resourceId)
    .update('\0')
    .update(patchId)
    .update('\0')
    .update(opId)
    .digest('hex')
    .slice(0, 24);
  return `ai_${digest}`;
}
