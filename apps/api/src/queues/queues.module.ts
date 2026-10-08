import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import type { Env } from '../config/env.schema';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const url = new URL(config.get('REDIS_URL', { infer: true }));
        return {
          prefix: config.get('QUEUE_PREFIX', { infer: true }),
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            username: url.username || undefined,
            password: url.password || undefined,
            db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
          },
          // ADR-010: o resultado vive no Postgres, o Redis só retém por um tempo
          defaultJobOptions: {
            removeOnComplete: { age: 7 * 24 * 3600 },
            removeOnFail: { age: 30 * 24 * 3600 },
          },
        };
      },
    }),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
