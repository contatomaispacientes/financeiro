import { Body, Controller, HttpCode, HttpStatus, Logger, Param, Post, Req, UseGuards, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator';
import type { Prisma } from '../../generated/prisma/client.js';
import { AsaasWebhookGuard } from './asaas-webhook.guard';
import { WebhookInbox } from './webhook-inbox.service';
import { ContractWebhookReceiver } from './contract-webhook.receiver';
import { webhookInvalidBody } from './webhooks.errors';

const AsaasWebhookBodySchema = z.looseObject({
  id: z.string().min(1),
  event: z.string().min(1),
  payment: z.looseObject({ id: z.string().min(1) }).optional(),
});

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly inbox: WebhookInbox,
    private readonly contractReceiver: ContractWebhookReceiver,
  ) {}

  /** WHK-01: autentica, persiste o corpo bruto e responde 200 (inclusive para evento repetido). */
  @Public()
  @UseGuards(AsaasWebhookGuard)
  @Post('asaas')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook de cobranças do Asaas' })
  async asaas(@Body() body: unknown) {
    const parsed = AsaasWebhookBodySchema.safeParse(body);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((i) => i.path.join('.') || '(corpo)').join(', ');
      this.logger.warn(`Webhook do Asaas com corpo inválido: ${fields}`);
      throw webhookInvalidBody();
    }

    await this.inbox.store('ASAAS', {
      externalEventId: parsed.data.id,
      event: parsed.data.event,
      resourceId: parsed.data.payment?.id ?? null,
      payload: body as Prisma.InputJsonValue, // corpo original, sem alteração (WHK-NF2)
    });
    return { received: true };
  }

  /** CTR-04.5: Clicksign (ou o Fake) com `Content-Hmac` sobre o corpo bruto. */
  @Public()
  @Post('contracts/:provider')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook do provedor de contratos' })
  async contracts(@Param('provider') provider: string, @Req() req: RawBodyRequest<Request>) {
    await this.contractReceiver.receive(provider, req.headers, req.rawBody);
    return { received: true };
  }
}
