import { IResult } from './result';

export const CommonError = {
  INTERNAL_ERROR: {
    code: 1000,
    key: 'framework.system.internal_error',
    msg: '系统错误',
  },
  REQUEST_ERROR: {
    code: 1001,
    key: 'framework.request.internal_error',
    msg: '请求错误',
  },
  REQUEST_PARAM_INVALID: {
    code: 1111,
    key: 'framework.request_parameter_validator.invalid',
    msg: null,
  },
  REQUEST_PARAM_REQUIRED_MISSING: {
    code: 1121,
    key: 'framework.request_parameter_validator.required_missing',
    msg: null,
  },
  REQUEST_PARAM_ABOVE_UPPER_BOUND: {
    code: 1131,
    key: 'framework.request_parameter_validator.above_upper_bound',
    msg: null,
  },
  REQUEST_PARAM_BELOW_LOWER_BOUND: {
    code: 1141,
    key: 'framework.request_parameter_validator.below_lower_bound',
    msg: null,
  },
  SECURITY_CONTEXT_PARAM_MISSING: {
    code: 1311,
    key: 'framework.security_context.required_missing',
    msg: '安全上下文参数错误',
  },
} as const satisfies Record<string, IResult>;
