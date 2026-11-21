import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { jsonLogger } from './common/json-logger';
import { loadConfig } from './config';
import { configureApp } from './setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: jsonLogger });
  configureApp(app);
  app.enableShutdownHooks();
  const { port } = loadConfig();
  await app.listen(port);
  jsonLogger.log(`listening on :${port} (docs: /docs, metrics: /metrics, health: /health)`, 'Bootstrap');
}

void bootstrap();
