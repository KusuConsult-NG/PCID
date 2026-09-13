import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';
import { buildOpenApiDocument } from './common/openapi/registry';
import { configureApp } from './configure-app';
import { logger } from './common/logger';

// Importing the controllers registers their route documentation, which the
// OpenAPI document is built from. Nest resolves them anyway; this is explicit so
// the contract cannot silently lose an endpoint if composition changes.
import './common/openapi/routes-index';

export async function bootstrap(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
    logger: ['error', 'warn'],
  });
  const env = configureApp(app);
  logger.setLevel(env.LOG_LEVEL);

  const document = buildOpenApiDocument({
    version: '1.0.0',
    serverUrl: env.PLATFORM_BASE_URL,
  });
  SwaggerModule.setup('api/v1/docs', app, document as never, {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.listen(env.PORT, '0.0.0.0');
  logger.info('api_started', { port: env.PORT, environment: env.NODE_ENV });
  return app;
}

if (require.main === module) {
  bootstrap().catch((error: unknown) => {
    logger.error('api_failed_to_start', { message: (error as Error).message });
    process.exitCode = 1;
  });
}
