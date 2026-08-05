import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { interceptHeaders } from '../header-interceptor';

@Injectable()
export class HeaderInterceptorMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    try {
      interceptHeaders(req.headers, next);
    } catch (error) {
      next(error);
    }
  }
}
