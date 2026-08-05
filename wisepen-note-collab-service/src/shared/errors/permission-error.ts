import { IResult } from './result';

export const PermissionError = {
  NOT_LOGIN: {
    code: 1211,
    key: 'framework.security.unauthenticated',
    msg: '未登录',
  },
  UNAUTHORIZED: {
    code: 1221,
    key: 'framework.security.unauthorized',
    msg: '当前身份角色不满足业务要求',
  },
  PERMISSION_DENIED: {
    code: 1231,
    key: 'framework.security.permission_denied',
    msg: '操作权限不足',
  },
} as const satisfies Record<string, IResult>;
