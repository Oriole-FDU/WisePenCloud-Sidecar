import { IncomingHttpHeaders } from 'http';

export const AUTHORIZATION_TOKEN = 'authorization';
export const HEADER_USER_ID = 'X-User-Id';
export const HEADER_IDENTITY_TYPE = 'X-Identity-Type';
export const HEADER_GROUP_ROLE_MAP = 'X-Group-Role-Map';

export enum IdentityType {
  STUDENT = 1,
  TEACHER = 2,
  ADMIN = 3,
}

export enum GroupRoleType {
  OWNER = 0,
  ADMIN = 1,
  MEMBER = 2,
  NOT_MEMBER = -1,
}

export enum GroupType {
  NORMAL_GROUP = 1,
  ADVANCED_GROUP = 2,
  MARKET_GROUP = 3,
}

export interface SecurityContext {
  authToken?: string;
  userId?: string;
  identityType?: IdentityType;
  groupRoleMap: Record<string, GroupRoleType>;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  const header = Array.isArray(value) ? value[0] : value;
  const normalized = header?.trim();
  return normalized || undefined;
}

function parseIdentityTypeFromCode(value: string | undefined): IdentityType | undefined {
  const code = value === undefined ? undefined : Number(value);
  if (code === IdentityType.STUDENT) return IdentityType.STUDENT;
  if (code === IdentityType.TEACHER) return IdentityType.TEACHER;
  if (code === IdentityType.ADMIN) return IdentityType.ADMIN;
  return undefined;
}

function parseGroupRoleTypeFromCode(value: unknown): GroupRoleType {
  const code = Number(value);
  if (code === GroupRoleType.OWNER) return GroupRoleType.OWNER;
  if (code === GroupRoleType.ADMIN) return GroupRoleType.ADMIN;
  if (code === GroupRoleType.MEMBER) return GroupRoleType.MEMBER;
  if (code === GroupRoleType.NOT_MEMBER) return GroupRoleType.NOT_MEMBER;
  return GroupRoleType.NOT_MEMBER;
}

function parseGroupRoleMap(value: string | undefined): Record<string, GroupRoleType> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).map(([groupId, role]) => [
        groupId,
        parseGroupRoleTypeFromCode(role),
      ]),
    );
  } catch {
    return {};
  }
}

export function extractSecurityContextFromHeaders(headers: IncomingHttpHeaders): SecurityContext {
  return {
    authToken: firstHeader(headers[AUTHORIZATION_TOKEN]),
    userId: firstHeader(headers[HEADER_USER_ID.toLowerCase()]),
    identityType: parseIdentityTypeFromCode(firstHeader(headers[HEADER_IDENTITY_TYPE.toLowerCase()])),
    groupRoleMap: parseGroupRoleMap(firstHeader(headers[HEADER_GROUP_ROLE_MAP.toLowerCase()])),
  };
}
