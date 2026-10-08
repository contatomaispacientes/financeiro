import { createHash, timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Env } from '../../config/env.schema';
import { webhookUnauthorized } from './webhooks.errors';

// Hash antes de comparar: timingSafeEqual exige o mesmo tamanho e não pode vazar o tamanho do token.
const digest = (value: string) => createHash('sha256').update(value).digest();

/** WHK-01.2, WHK-NF2: header `asaas-access-token` comparado em tempo constante. */
@Injectable()
export class AsaasWebhookGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(config: ConfigService<Env, true>) {
    this.expected = digest(config.get('ASAAS_WEBHOOK_TOKEN', { infer: true }));
  }

  canActivate(context: ExecutionContext): boolean {
    const token = context.switchToHttp().getRequest<Request>().headers['asaas-access-token'];
    if (typeof token !== 'string' || !timingSafeEqual(digest(token), this.expected)) {
      throw webhookUnauthorized();
    }
    return true;
  }
}
