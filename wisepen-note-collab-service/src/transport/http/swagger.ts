import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

export function setupSwagger(app: INestApplication): OpenAPIObject {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('WisePen 笔记协同 Sidecar API')
      .setDescription('面向内部 AI 工具的活跃笔记读取与 AI Diff 写入接口。')
      .setVersion('1.0.0')
      .setOpenAPIVersion('3.1.0')
      .build(),
  );
  const openApiDocument = cleanupOpenApiDoc(document, { version: '3.1' });
  SwaggerModule.setup('docs', app, openApiDocument, {
    jsonDocumentUrl: '/openapi.json',
  });
  return openApiDocument;
}
