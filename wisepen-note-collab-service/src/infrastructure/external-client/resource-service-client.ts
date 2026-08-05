import { AxiosInstance } from 'axios';
import { R } from '../../shared/types';
import { createInternalServiceClient, unwrapRequiredData } from './internal-service-client';

export type ResourceAccessRole = 'OWNER' | 'OWNER_SPECIFIED' | 'GROUP_ADMIN' | 'GROUP_MEMBER' | 'NONE';
export type ResourceAction =
  | 'DISCOVER'
  | 'VIEW'
  | 'LOAD'
  | 'EDIT'
  | 'INLINE_COMMENT'
  | 'DOWNLOAD_WATERMARK'
  | 'DOWNLOAD_ORIGINAL'
  | 'FORK'
  | 'COMMENT'
  | 'MARKET_VIEW';

export interface ResourceCheckPermissionReqDTO {
  resourceId: string;
  userId: string | number;
  groupRoles: Record<string, number>;
  targetVersion?: number;
}

export interface ResourceCheckPermissionResDTO {
  resourceAccessRole: ResourceAccessRole;
  permissionSources?: string[] | null;
  allowedActions?: ResourceAction[] | null;
}

export async function getResourceServiceClient(): Promise<AxiosInstance> {
  // 通过 Nacos 发现 Java 资源服务
  return createInternalServiceClient('wisepen-resource-service');
}

export async function checkPermission(
  resourceId: string,
  userId: string,
  groupRoles: Record<string, number>,
  targetVersion?: number,
): Promise<ResourceCheckPermissionResDTO> {
  const client = await getResourceServiceClient();
  const request: ResourceCheckPermissionReqDTO = {
    resourceId,
    userId,
    groupRoles,
    ...(targetVersion !== undefined ? { targetVersion } : {}),
  };
  const resp = await client.post<R<ResourceCheckPermissionResDTO>>(
    '/internal/resource/checkResPermission',
    request
  );
  return unwrapRequiredData(resp.data);
}
