import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { CommonError, PermissionError, ServiceError } from '../../shared/errors';
import { R } from '../../shared/types';
import { HeaderInterceptError } from '../header-interceptor';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;

    if (error instanceof HeaderInterceptError) {
      res.status(error.status).json({
        code: error.status,
        key: error.code,
        msg: error.message,
        data: null,
      } satisfies R<null>);
      return;
    }

    if (error instanceof ServiceError) {
      const isPermissionError = error.code === PermissionError.NOT_LOGIN.code ||
        error.code === PermissionError.UNAUTHORIZED.code ||
        error.code === PermissionError.PERMISSION_DENIED.code;
      const status = !isPermissionError
        ? 200
        : error.code === PermissionError.NOT_LOGIN.code
          ? 401
          : 403;
      res.status(status).json({
        code: error.errorResult.code,
        key: error.errorResult.key,
        msg: error.message,
        data: null,
      } satisfies R<null>);
      return;
    }

    if (error instanceof ZodValidationException) {
      const zodError = error.getZodError();
      const issue = typeof zodError === 'object' &&
        zodError !== null &&
        'issues' in zodError &&
        Array.isArray((zodError as { issues?: unknown }).issues)
        ? (zodError as { issues: Array<{ message?: string }> }).issues[0]
        : undefined;
      res.status(400).json({
        code: CommonError.REQUEST_PARAM_INVALID.code,
        key: CommonError.REQUEST_PARAM_INVALID.key,
        msg: issue?.message ?? CommonError.REQUEST_PARAM_INVALID.msg,
        data: null,
      } satisfies R<null>);
      return;
    }

    if (error instanceof HttpException) {
      const status = error.getStatus();
      const errorResult = status >= 400 && status < 500
        ? CommonError.REQUEST_ERROR
        : CommonError.INTERNAL_ERROR;
      res.status(status).json({
        code: errorResult.code,
        key: errorResult.key,
        msg: error.message || errorResult.msg,
        data: null,
      } satisfies R<null>);
      return;
    }

    if (
      typeof error === 'object' &&
      error !== null &&
      'type' in error &&
      (error as { type?: unknown }).type === 'entity.too.large'
    ) {
      res.status(413).json({
        code: CommonError.REQUEST_PARAM_ABOVE_UPPER_BOUND.code,
        key: CommonError.REQUEST_PARAM_ABOVE_UPPER_BOUND.key,
        msg: '请求体过大',
        data: null,
      } satisfies R<null>);
      return;
    }

    this.logger.error('Request failed', error instanceof Error ? error.stack : String(error));
    res.status(500).json({
      code: CommonError.INTERNAL_ERROR.code,
      key: CommonError.INTERNAL_ERROR.key,
      msg: CommonError.INTERNAL_ERROR.msg,
      data: null,
    } satisfies R<null>);
  }
}
