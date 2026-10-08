import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { formatBRL, Permission } from '@financeiro/shared';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AsaasPayment } from '../../integrations/asaas/asaas.client';
import { AsaasMockService } from './asaas-mock.service';

const SimulateSchema = z.object({ action: z.enum(['RECEIVE', 'OVERDUE']) });

const statusLabels: Record<string, string> = {
  PENDING: 'Aguardando pagamento',
  OVERDUE: 'Vencida',
  RECEIVED: 'Paga',
  CONFIRMED: 'Paga',
  REFUNDED: 'Estornada',
};
const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => entities[c]!);

function invoicePage(p: AsaasPayment): string {
  const open = !p.deleted && (p.status === 'PENDING' || p.status === 'OVERDUE');
  const status = p.deleted ? 'Cancelada' : (statusLabels[p.status] ?? p.status);
  const [y, m, d] = p.dueDate.split('-');
  const action = open
    ? `<form method="post" action="${esc(p.id)}/pagar"><button type="submit">Simular pagamento</button></form>`
    : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fatura simulada</title><style>
body{font-family:system-ui,sans-serif;background:#F2F3EF;color:#15171A;margin:0;padding:24px 16px}
main{max-width:420px;margin:0 auto;background:#fff;border:1px solid #E1E3DD;border-radius:12px;padding:24px}
.tag{display:inline-block;background:#FEF3C7;color:#92400E;border-radius:999px;padding:2px 10px;font-size:12px}
.v{font-size:32px;font-weight:600;margin:12px 0 4px}.muted{color:#5B6068;font-size:14px}
button{width:100%;margin-top:20px;padding:12px;border:0;border-radius:8px;background:#0E6B4E;color:#fff;font-size:16px;cursor:pointer}
</style></head><body><main>
<span class="tag">Asaas simulado · nada é cobrado</span>
<p class="v">${formatBRL(p.valueCents)}</p>
<p class="muted">${esc(p.description ?? '')}</p>
<p>Vencimento: <strong>${d}/${m}/${y}</strong><br>Situação: <strong>${esc(status)}</strong></p>
${action}
</main></body></html>`;
}

/** ADR-016: rotas do Asaas simulado. Respondem 404 fora de ASAAS_ENV=mock. */
@ApiTags('asaas-mock')
@Controller('asaas-mock')
export class AsaasMockController {
  constructor(private readonly service: AsaasMockService) {}

  @Post('charges/:id/simulate')
  @HttpCode(200)
  @ApiBearerAuth()
  @Roles(...Permission.MANAGE_CHARGES)
  @ApiOperation({ summary: 'Simula pagamento ou vencimento de uma cobrança (só Asaas simulado)' })
  async simulate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(SimulateSchema)) body: z.infer<typeof SimulateSchema>,
  ) {
    const payment = await this.service.simulateCharge(id, body.action);
    return { status: payment.status };
  }

  /** Página que o "link da fatura" abre, no lugar da fatura do Asaas. */
  @Public()
  @Get('fatura/:paymentId')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async invoice(@Param('paymentId') paymentId: string) {
    return invoicePage(await this.service.invoice(paymentId));
  }

  @Public()
  @Post('fatura/:paymentId/pagar')
  async pay(@Param('paymentId') paymentId: string, @Res() res: Response) {
    await this.service.simulatePayment(paymentId, 'RECEIVE');
    res.redirect(303, `../${encodeURIComponent(paymentId)}`);
  }
}
