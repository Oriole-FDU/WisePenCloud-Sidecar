import { CommonError, PermissionError, ServiceError } from '../errors';
import { getSecurityContext } from '../context/request-context-holder';
import { GroupRoleType, IdentityType, SecurityContext } from './security-context';

export function getUserId(): string | undefined {
  return getSecurityContext()?.userId;
}

export function getIdentityType(): IdentityType | undefined {
  return getSecurityContext()?.identityType;
}

export function getGroupRoleMap(): Record<string, GroupRoleType> {
  return getSecurityContext()?.groupRoleMap ?? {};
}

export function getGroupRole(groupId: string | number | undefined): GroupRoleType {
  if (groupId === undefined || groupId === null) {
    return GroupRoleType.NOT_MEMBER;
  }
  return getGroupRoleMap()[String(groupId)] ?? GroupRoleType.NOT_MEMBER;
}

export function getCurrentSecurityContext(): SecurityContext | undefined {
  return getSecurityContext();
}

export function requireLogin(): string {
  const userId = getUserId();
  if (!userId) throw new ServiceError(PermissionError.NOT_LOGIN);
  return userId;
}

export function assertUserId(userId: string | number): void {
  if (String(userId) !== getUserId()) {
    throw new ServiceError(PermissionError.PERMISSION_DENIED);
  }
}

export function assertInGroup(groupId: string | number | undefined): GroupRoleType {
  if (groupId === undefined || groupId === null) {
    throw new ServiceError(CommonError.SECURITY_CONTEXT_PARAM_MISSING);
  }
  const role = getGroupRole(groupId);
  if (role === GroupRoleType.NOT_MEMBER) {
    throw new ServiceError(PermissionError.PERMISSION_DENIED);
  }
  return role;
}

export function assertGroupRole(
  groupId: string | number | undefined,
  ...requiredRoles: GroupRoleType[]
): void {
  if (groupId === undefined || groupId === null || requiredRoles.length === 0) {
    throw new ServiceError(CommonError.SECURITY_CONTEXT_PARAM_MISSING);
  }
  const currentRole = getGroupRole(groupId);
  if (!requiredRoles.includes(currentRole)) {
    throw new ServiceError(PermissionError.PERMISSION_DENIED);
  }
}
