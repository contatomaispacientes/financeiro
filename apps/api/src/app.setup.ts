import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { DomainExceptionFilter } from './common/filters/domain-exception.filter';

export function configureApp(app: INestApplication) {
  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new DomainExceptionFilter());
  app.use(helmet());
  app.enableCors({
    origin: process.env['WEB_ORIGIN'] ?? 'http://localhost:5173',
    credentials: true,
  });
  app.setGlobalPrefix('api/v1');

  if (process.env['NODE_ENV'] !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Financeiro API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  }
}
