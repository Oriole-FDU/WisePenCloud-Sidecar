import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AiNoteController } from './controllers/ai-note-controller';
import { HealthController } from './controllers/health-controller';
import { HeaderInterceptorMiddleware } from './header-interceptor.middleware';

@Module({
  controllers: [AiNoteController, HealthController],
  providers: [
    {
      provide: APP_PIPE,
      useClass: ZodValidationPipe,
    },
  ],
})
export class HttpModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(HeaderInterceptorMiddleware)
      .exclude(
        { path: '/', method: RequestMethod.ALL },
        { path: 'docs', method: RequestMethod.ALL },
        { path: 'docs/{*path}', method: RequestMethod.ALL },
        { path: 'openapi.json', method: RequestMethod.ALL },
      )
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
