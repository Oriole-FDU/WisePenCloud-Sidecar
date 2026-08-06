import { PermissionError, ServiceError } from '../errors';
import {
  getIdentityType,
  requireLogin,
} from './security-context-holder';
import { IdentityType } from './security-context';

export interface SecurityPolicy {
  login?: boolean;
  identityTypes?: IdentityType[];
}

export function checkSecurityPolicy(policy: SecurityPolicy): void {
  if (policy.login || policy.identityTypes) {
    requireLogin();
  }
  if (policy.identityTypes && policy.identityTypes.length > 0) {
    const identityType = getIdentityType();
    if (!identityType || !policy.identityTypes.includes(identityType)) {
      throw new ServiceError(PermissionError.UNAUTHORIZED);
    }
  }
}

export function withSecurity<Args extends unknown[], Result>(
  policy: SecurityPolicy,
  handler: (...args: Args) => Result,
): (...args: Args) => Result {
  return (...args) => {
    checkSecurityPolicy(policy);
    return handler(...args);
  };
}
