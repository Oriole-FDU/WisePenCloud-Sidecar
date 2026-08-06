import { IncomingHttpHeaders } from 'http';
import { config } from '../config';
import { runWithRequestContext } from '../shared/context/request-context-holder';

const HEADER_FROM_SOURCE = 'X-From-Source';

export class HeaderInterceptError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = 'HeaderInterceptError';
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  const header = Array.isArray(value) ? value[0] : value;
  const normalized = header?.trim();
  return normalized || undefined;
}

export function interceptHeaders<T>(
  headers: IncomingHttpHeaders,
  callback: () => T,
): T {
  if (firstHeader(headers[HEADER_FROM_SOURCE.toLowerCase()]) !== config.security.fromSourceSecret) {
    throw new HeaderInterceptError(404, 'NOT_FOUND');
  }
  return runWithRequestContext(headers, callback);
}
