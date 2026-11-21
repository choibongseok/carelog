import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** main.ts 와 테스트가 같은 설정을 쓰도록 모은다. */
export function configureApp(app: INestApplication): void {
  (app as NestExpressApplication).useBodyParser('json', { limit: '1mb' });
  app.useGlobalPipes(new ValidationPipe({ transform: false, forbidUnknownValues: false }));
  const doc = new DocumentBuilder()
    .setTitle('Carelog API')
    .setDescription('건강 기록(혈당·식사·활동) 로깅 백엔드 데모. 합성 데이터이며 의료 조언·진단 도구가 아니다.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc));
}
