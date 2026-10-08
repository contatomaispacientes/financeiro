import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv } from './config/env.schema';
import { PrismaModule } from './prisma/prisma.module';
import { QueuesModule } from './queues/queues.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { UsersModule } from './modules/users/users.module';
import { SettingsModule } from './modules/settings/settings.module';
import { CustomersModule } from './modules/customers/customers.module';
import { ServicesModule } from './modules/services/services.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ChargesModule } from './modules/charges/charges.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { PaymentEventsModule } from './modules/payment-events/payment-events.module';
import { AsaasMockModule } from './modules/asaas-mock/asaas-mock.module';

const SAFE_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env['NODE_ENV'] === 'test' ? 'silent' : 'info',
        transport:
          process.env['NODE_ENV'] === 'development'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
        genReqId: (req, res) => {
          const incoming = req.headers['x-request-id'];
          const id =
            typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)
              ? incoming
              : randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        customProps: () => ({ context: 'HTTP' }),
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
            'req.headers["asaas-access-token"]',
            '*.password',
            '*.passwordHash',
            '*.cpfCnpj',
            '*.document',
            '*.apiKey',
          ],
          censor: '[REDACTED]',
        },
      },
    }),
    PrismaModule,
    QueuesModule,
    AuditModule,
    AuthModule,
    UsersModule,
    SettingsModule,
    CustomersModule,
    ServicesModule,
    ExpensesModule,
    ReportsModule,
    ChargesModule,
    WebhooksModule,
    PaymentEventsModule,
    AsaasMockModule,
    HealthModule,
  ],
})
export class AppModule {}
