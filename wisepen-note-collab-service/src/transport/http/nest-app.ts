import 'reflect-metadata';
import http from 'http';
import { NestFactory } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import expressWs from 'express-ws';
import { json } from 'express';
import { HttpExceptionFilter } from './http-exception.filter';
import { HttpModule } from './http.module';
import { setupSwagger } from './swagger';
import { registerWebSocketRoutes } from '../websocket/note-server/ws-server';

export async function createNestServer(): Promise<{ app: INestApplication; server: http.Server }> {
  const app = await NestFactory.create(HttpModule, {
    bodyParser: false,
  });
  app.use(json({ limit: '2mb' }));
  app.useGlobalFilters(new HttpExceptionFilter());
  setupSwagger(app);
  await app.init();

  const server = app.getHttpServer() as http.Server;
  const expressApp = app.getHttpAdapter().getInstance() as expressWs.Application;
  expressWs(expressApp, server);
  registerWebSocketRoutes(expressApp);

  return { app, server };
}
