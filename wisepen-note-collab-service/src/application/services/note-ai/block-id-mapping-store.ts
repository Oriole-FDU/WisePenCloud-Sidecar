import { createHash } from 'crypto';
import * as Y from 'yjs';
import { Note, NoteBlock } from './note-types';

const MAX_MAPPINGS_PER_DOCUMENT = 32;
const PUBLIC_BLOCK_ID_PATTERN = /^p_\d{3,}$/;

export interface BlockIdMapping {
  version: string;
  internalBlockIDToPublicBlockID: Map<string, string>;
  publicBlockIDToInternalBlockID: Map<string, string>;
}

interface DocumentMappingCache {
  byVersion: Map<string, BlockIdMapping>;
  latestVersion?: string;
}

/**
 * 短块 ID 映射缺失或不可信时抛出的业务错误
 */
export class BlockIdMappingError extends Error {
  constructor() {
    super('BLOCK_ID_MAPPING_NOT_FOUND');
    this.name = 'BlockIdMappingError';
  }
}

// WeakMap 以 Y.Doc 为 key 挂一份短块 ID 映射缓存，房间销毁后缓存会自然释放，不需要额外生命周期清理
const mappingCaches = new WeakMap<Y.Doc, DocumentMappingCache>();

/**
 * 深度遍历 NoteBlock 树
 *
 * 公开块 ID 的分配按先序遍历（先访问父块、再访问 children）生成
 * 只要同一份快照结构不变，生成的短块 ID 顺序就稳定
 */
function visitBlocks(blocks: NoteBlock[], visitor: (block: NoteBlock) => void): void {
  for (const block of blocks) {
    visitor(block);
    visitBlocks(block.children, visitor);
  }
}

/**
 * 为一份快照创建内部块 ID 和公开（短）块 ID 的双向映射（双向Map）
 *
 * AI 工具使用短 ID，在收到请求后再解析回内部 ID
 */
function createMapping(snapshot: Note): BlockIdMapping {
  const internalBlockIDToPublicBlockID = new Map<string, string>();
  const publicBlockIDToInternalBlockID = new Map<string, string>();
  // 前序遍历文档树
  visitBlocks(snapshot.blocks, (block) => {
    if (internalBlockIDToPublicBlockID.has(block.id)) return;
    const publicId = `p_${String(internalBlockIDToPublicBlockID.size + 1).padStart(3, '0')}`;
    internalBlockIDToPublicBlockID.set(block.id, publicId);
    publicBlockIDToInternalBlockID.set(publicId, block.id);
  });
  return { version: snapshot.version, internalBlockIDToPublicBlockID, publicBlockIDToInternalBlockID };
}

/**
 * 查找指定版本或最新版本的短 ID 映射
 */
export function findMapping(doc: Y.Doc, version?: string): BlockIdMapping | undefined {
  // 按 doc 找这份文档的 Mapping 缓存，没找到直接返回空
  const cache = mappingCaches.get(doc);
  if (!cache) return undefined;

  // 如果指定 version，就找指定版本，否则找最近一次的版本 latestVersion，没找到直接返回空
  const targetVersion = version ?? cache.latestVersion;
  if (!targetVersion) return undefined;

  // 如果这个版本的映射已经被淘汰或从未缓存过，也返回空
  const mapping = cache.byVersion.get(targetVersion);
  if (!mapping) return undefined;

  // 把该映射移动到 Map 尾部形成一个很轻量的 LRU 行为
  // 与 addBlockIdMapping 中的最大缓存数量配合，避免长时间协作房间的 Map 无限增长
  cache.byVersion.delete(targetVersion);
  cache.byVersion.set(targetVersion, mapping);
  return mapping;
}

/**
 * 新增块 ID 映射
 */
export function addBlockIdMapping(
  doc: Y.Doc,
  snapshot: Note,
): BlockIdMapping {

  // 根据 Y.doc 获取或初始化Cache
  let cache = mappingCaches.get(doc);
  if (!cache) {
    cache = { byVersion: new Map() };
    mappingCaches.set(doc, cache);
  }

  // 尝试获取对应版本的 Mapping 缓存，若已经存在则只刷新（LRU）
  const existing = cache.byVersion.get(snapshot.version);
  if (existing) {
    cache.byVersion.delete(snapshot.version);
    cache.byVersion.set(snapshot.version, existing);
    cache.latestVersion = snapshot.version;
    return existing;
  }

  // 不存在这样的缓存，则新增
  const mapping = createMapping(snapshot);
  cache.byVersion.set(snapshot.version, mapping);
  cache.latestVersion = snapshot.version;

  // 淘汰缓存
  while (cache.byVersion.size > MAX_MAPPINGS_PER_DOCUMENT) { // 缓存超限
    const oldestVersion = cache.byVersion.keys().next().value as string | undefined;
    if (!oldestVersion) break;
    cache.byVersion.delete(oldestVersion); // 淘汰最老的缓存
  }

  return mapping;
}

/**
 * 把内部块 ID 转成公开短块 ID
 */
export function getPublicBlockId(mapping: BlockIdMapping, internalId: string): string {
    // 转换块ID
  const publicId = mapping.internalBlockIDToPublicBlockID.get(internalId);
  if (!publicId) throw new BlockIdMappingError();
  return publicId;
}

/**
 * 把公开短块 ID 解析回 Yjs 内部块 ID
 */
export function resolvePublicId(mapping: BlockIdMapping, blockId: string): string {
  // 必须符合公开（短）块格式
  if (!PUBLIC_BLOCK_ID_PATTERN.test(blockId)) throw new BlockIdMappingError();
  // 转换块ID
  const internalId = mapping.publicBlockIDToInternalBlockID.get(blockId);
  if (!internalId) throw new BlockIdMappingError();
  return internalId;
}

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
