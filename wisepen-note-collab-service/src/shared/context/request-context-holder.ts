import { AsyncLocalStorage } from 'async_hooks';
import { IncomingHttpHeaders } from 'http';
import { GrayContext, extractGrayContextFromHeaders } from '../gray/gray-context';
import { SecurityContext, extractSecurityContextFromHeaders } from '../security/security-context';

export interface RequestContext {
  security: SecurityContext;
  gray: GrayContext;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(
  headers: IncomingHttpHeaders,
  callback: () => T,
): T {
  return storage.run({
    security: extractSecurityContextFromHeaders(headers),
    gray: extractGrayContextFromHeaders(headers),
  }, callback);
}

export function getSecurityContext(): SecurityContext | undefined {
  return storage.getStore()?.security;
}

export function getGrayContext(): GrayContext | undefined {
  return storage.getStore()?.gray;
}
