import { IResult } from './result';

export class ServiceError extends Error {
  constructor(
    public readonly errorResult: IResult,
    message?: string,
  ) {
    super(message ? `${errorResult.msg ?? errorResult.key}: ${message}` : (errorResult.msg ?? errorResult.key));
    this.name = 'ServiceError';
  }

  get code(): number {
    return this.errorResult.code;
  }

  get key(): string {
    return this.errorResult.key;
  }
}
