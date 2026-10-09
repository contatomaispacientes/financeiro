import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  // rawBody: o webhook de contratos verifica o HMAC sobre o corpo exato (CTR-04.5).
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  configureApp(app);
  await app.listen(process.env['PORT'] ?? 3000);
}

bootstrap();
