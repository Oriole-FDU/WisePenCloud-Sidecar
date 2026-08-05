import { AxiosInstance } from 'axios';
import { R } from '../../shared/types';
import { createInternalServiceClient, unwrapRequiredData } from './internal-service-client';

interface SnapshotResponse {
  resourceId: string;
  fullSnapshot: string | null;
  deltas?: string[] | null;
  version: number;
}

export interface LatestNoteSnapshot {
  fullSnapshot: Uint8Array | null;
  deltas: Uint8Array[] | null;
  version: number;
}

export async function getNoteServiceClient(): Promise<AxiosInstance> {
  // 通过 Nacos 发现 Java 笔记服务
  return createInternalServiceClient('wisepen-note-service');
}

export async function getLatestSnapshot(
  resourceId: string,
): Promise<LatestNoteSnapshot> {
  const client = await getNoteServiceClient();
  const resp = await client.get<R<SnapshotResponse>>(
    '/internal/note/getNoteLatestVersion',
    { params: { resourceId } }
  );
  const { fullSnapshot, version, deltas } = unwrapRequiredData(resp.data);
  return {
    fullSnapshot: fullSnapshot ? Buffer.from(fullSnapshot, 'base64') : null,
    deltas: deltas ? deltas.map(d => new Uint8Array(Buffer.from(d, 'base64'))) : null,
    version,
  };
}
