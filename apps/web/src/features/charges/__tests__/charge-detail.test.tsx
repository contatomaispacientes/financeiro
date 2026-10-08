import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { routes } from '@/router';
import { apiUrl, server } from '@/test/server';
import { mockEnvironment, renderRoutes, signIn } from '@/test/render';
import { chargeDetail } from './fixtures';

describe('[COB-07][WHK-03.4] detalhe da cobrança', () => {
  beforeEach(() => {
    signIn('FINANCEIRO');
    mockEnvironment();
  });

  it('[COB-07.1][WHK-03.4] mostra dados, itens e a timeline de eventos em português', async () => {
    server.use(
      http.get(apiUrl('/charges/ch-1'), () =>
        HttpResponse.json(
          chargeDetail({
            status: 'PAID',
            paidAt: '2026-10-09',
            netValueCents: 29_801,
            events: [
              { id: 'e-2', event: 'PAYMENT_RECEIVED', receivedAt: '2026-10-09T14:00:00.000Z', processedAt: '2026-10-09T14:00:01.000Z', result: 'APPLIED' },
              { id: 'e-1', event: 'PAYMENT_CREATED', receivedAt: '2026-10-08T12:00:00.000Z', processedAt: '2026-10-08T12:00:01.000Z', result: 'APPLIED' },
            ],
          }),
        ),
      ),
    );
    renderRoutes(routes, '/cobrancas/ch-1');

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('R$ 300,00');
    expect(screen.getAllByText('Pago')[0]).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Maria Silva' })[0]).toHaveAttribute('href', '/clientes/c-1');
    expect(screen.getByText('Pago em').nextSibling).toHaveTextContent('09/10/2026');
    expect(screen.getByText('Valor líquido').nextSibling).toHaveTextContent('R$ 298,01');

    const timeline = within(screen.getByRole('region', { name: 'Eventos do Asaas' }));
    const events = timeline.getAllByRole('listitem');
    expect(events[0]).toHaveTextContent('Pagamento recebido');
    expect(events[0]).toHaveTextContent('PAYMENT_RECEIVED');
    expect(events[1]).toHaveTextContent('Cobrança criada');
  });

  it('[COB-05.2][COB-05.3] busca a linha digitável que faltou e copia com um clique', async () => {
    const user = userEvent.setup();
    const charge = chargeDetail({ billingType: 'UNDEFINED' });
    server.use(
      http.get(apiUrl('/charges/ch-1'), () => HttpResponse.json(charge)),
      http.get(apiUrl('/charges/ch-1/payment-info'), () =>
        HttpResponse.json({
          invoiceUrl: charge.invoiceUrl,
          bankSlipUrl: null,
          pixPayload: charge.pixPayload,
          pixQrCodeBase64: null,
          identificationField: '23793381286000000000300000000400000000000030000',
        }),
      ),
    );
    renderRoutes(routes, '/cobrancas/ch-1');

    expect(await screen.findByText('23793381286000000000300000000400000000000030000')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copiar Pix copia-e-cola' }));
    expect(await navigator.clipboard.readText()).toBe(charge.pixPayload);
    await user.click(screen.getByRole('button', { name: 'Copiar linha digitável' }));
    expect(await navigator.clipboard.readText()).toBe('23793381286000000000300000000400000000000030000');
  });

  it('[COB-12.1] rascunho mostra o erro e "Tentar de novo" gera no Asaas', async () => {
    let status: 'DRAFT' | 'PENDING' = 'DRAFT';
    server.use(
      http.get(apiUrl('/charges/ch-1'), () =>
        HttpResponse.json(
          status === 'DRAFT'
            ? chargeDetail({ status: 'DRAFT', asaasPaymentId: null, invoiceUrl: null, pixPayload: null, lastError: 'O Asaas não respondeu.' })
            : chargeDetail(),
        ),
      ),
      http.post(apiUrl('/charges/ch-1/retry'), () => {
        status = 'PENDING';
        return HttpResponse.json(chargeDetail());
      }),
    );
    renderRoutes(routes, '/cobrancas/ch-1');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('O Asaas não respondeu.');
    await userEvent.click(within(alert).getByRole('button', { name: 'Tentar de novo' }));

    expect(await screen.findByRole('button', { name: 'Copiar link da fatura' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Descartar' })).not.toBeInTheDocument();
  });

  it('LEITURA vê o rascunho sem as ações', async () => {
    signIn('LEITURA');
    server.use(
      http.get(apiUrl('/charges/ch-1'), () =>
        HttpResponse.json(chargeDetail({ status: 'DRAFT', asaasPaymentId: null, lastError: 'O Asaas não respondeu.' })),
      ),
    );
    renderRoutes(routes, '/cobrancas/ch-1');

    expect(await screen.findByRole('alert')).toHaveTextContent('O Asaas não respondeu.');
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument();
  });
});
