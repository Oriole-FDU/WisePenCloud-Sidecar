import { IncomingHttpHeaders } from 'http';

export const DEVELOPER_HEADER = 'X-Developer';

export interface GrayContext {
  developer?: string;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  const header = Array.isArray(value) ? value[0] : value;
  const normalized = header?.trim();
  return normalized || undefined;
}

export function extractGrayContextFromHeaders(headers: IncomingHttpHeaders): GrayContext {
  return {
    developer: firstHeader(headers[DEVELOPER_HEADER.toLowerCase()]),
  };
}
