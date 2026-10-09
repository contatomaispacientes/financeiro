import { Body, Controller, Get, Header, HttpStatus, Inject, Param, Post, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { DomainException } from '../../common/filters/domain-exception.filter';
import { CONTRACT_PROVIDER, type ContractProvider } from '../../integrations/contracts/contract-provider';
import { FakeContractProvider } from '../../integrations/contracts/fake-contract.provider';
import { ContractWebhookReceiver } from '../webhooks/contract-webhook.receiver';

const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => entities[c]!);
const statusText: Record<string, string> = {
  PENDING: 'Aguardando assinaturas',
  SIGNED: 'Assinado por todos',
  REFUSED: 'Recusado',
  CANCELED: 'Cancelado',
  EXPIRED: 'Expirado',
};

/**
 * CTR-NF3 (ajustado, ADR-016): página de assinatura do provedor simulado. Existe só com
 * CONTRACT_PROVIDER=fake. Assinar/recusar manda o webhook assinado pelo mesmo caminho do Clicksign.
 */
@ApiExcludeController()
@Controller('dev/fake-sign')
export class DevFakeSignController {
  constructor(
    @Inject(CONTRACT_PROVIDER) private readonly provider: ContractProvider,
    private readonly receiver: ContractWebhookReceiver,
  ) {}

  private get fake(): FakeContractProvider {
    if (!(this.provider instanceof FakeContractProvider)) {
      throw new DomainException('NOT_FOUND', 'Disponível só com CONTRACT_PROVIDER=fake', HttpStatus.NOT_FOUND);
    }
    return this.provider;
  }

  @Public()
  @Get(':docId/:signerId')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async page(@Param('docId') docId: string, @Param('signerId') signerId: string) {
    const { title, status, fields, signer } = await this.fake.signPage(docId, signerId);
    const open = status === 'PENDING' && signer.status === 'PENDING';
    const rows = Object.entries(fields)
      .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
      .join('');
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Assinatura simulada</title><style>
body{font-family:system-ui,sans-serif;background:#F2F3EF;color:#15171A;margin:0;padding:24px 16px}
main{max-width:640px;margin:0 auto;background:#fff;border:1px solid #E1E3DD;border-radius:12px;padding:24px}
.tag{display:inline-block;background:#FEF3C7;color:#92400E;border-radius:999px;padding:2px 10px;font-size:12px}
table{width:100%;border-collapse:collapse;font-size:14px;margin:16px 0}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #E1E3DD;vertical-align:top}
th{color:#5B6068;font-weight:500;width:35%}.actions{display:flex;gap:8px;flex-wrap:wrap}
button{padding:10px 18px;border-radius:8px;border:1px solid #E1E3DD;background:#fff;font-size:15px;cursor:pointer}
button.primary{background:#0E6B4E;border-color:#0E6B4E;color:#fff}
</style></head><body><main>
<span class="tag">Provedor de assinatura simulado</span>
<h1 style="font-size:20px">${esc(title)}</h1>
<p>Signatário: <strong>${esc(signer.name)}</strong> (${esc(signer.email)})<br>Situação: <strong>${esc(signer.status === 'SIGNED' ? 'Você já assinou' : signer.status === 'REFUSED' ? 'Você recusou' : (statusText[status] ?? status))}</strong></p>
<table>${rows}</table>
${open ? `<form method="post" class="actions"><button class="primary" name="action" value="sign">Assinar</button><button name="action" value="refuse">Recusar</button></form>` : ''}
</main></body></html>`;
  }

  @Public()
  @Post(':docId/:signerId')
  async act(@Param('docId') docId: string, @Param('signerId') signerId: string, @Body() body: { action?: string }, @Res() res: Response) {
    const { rawBody, headers } = await this.fake.act(docId, signerId, body.action === 'refuse' ? 'refuse' : 'sign');
    await this.receiver.receive('fake', headers, rawBody);
    res.redirect(303, signerId);
  }
}
