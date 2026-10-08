import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { addDays, todayInSaoPaulo, type ChargePreviewDto, type CustomerListItemDto } from '@financeiro/shared';
import { routes } from '@/router';
import { apiUrl, server } from '@/test/server';
import { mockEnvironment, renderRoutes, signIn } from '@/test/render';
import { page, settingsDto } from '@/test/fixtures';
import { chargeDetail, consulting, customerDetail, customerItem, fee } from './fixtures';

const today = todayInSaoPaulo();

const preview: ChargePreviewDto = {
  subtotalCents: 30_000,
  discountCents: 0,
  totalCents: 30_000,
  firstDueDate: addDays(today, 3),
  installments: [{ number: 1, dueDate: addDays(today, 3), valueCents: 30_000 }],
  description: 'Consultoria (2x)',
  asaasRequests: [{ method: 'POST', path: '/v3/payments', body: { value: 300 } }],
  customerWillBeCreated: true,
};

function mockApi({ customers = [customerItem], settings = settingsDto() }: { customers?: CustomerListItemDto[]; settings?: ReturnType<typeof settingsDto> } = {}) {
  const created: unknown[] = [];
  server.use(
    http.get(apiUrl('/settings'), () => HttpResponse.json(settings)),
    http.get(apiUrl('/services'), () => HttpResponse.json({ data: [consulting, fee] })),
    http.get(apiUrl('/customers'), () => HttpResponse.json(page(customers))),
    http.post(apiUrl('/charges/preview'), () => HttpResponse.json(preview)),
  );
  return { created };
}

async function pickCustomer(name = 'Maria Silva') {
  await userEvent.click(await screen.findByRole('combobox', { name: 'Buscar cliente' }));
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(name) }));
}

async function addFromCatalog(name: string) {
  const catalog = await screen.findByRole('group', { name: 'Catálogo de serviços' });
  await userEvent.click(within(catalog).getByRole('button', { name: new RegExp(name) }));
}

const summary = () => within(screen.getByRole('region', { name: 'Resumo' }));
const total = () => summary().getByText('Total').nextElementSibling;
const generateButton = () => screen.getByRole('button', { name: 'Gerar cobrança no Asaas' });

describe('[COB-01][COB-02][COB-12] Nova cobrança', () => {
  beforeEach(() => {
    signIn('FINANCEIRO');
    mockEnvironment();
  });

  it('[COB-01.2] serviço do catálogo entra com o preço padrão, editável; repetir soma na quantidade', async () => {
    mockApi();
    renderRoutes(routes, '/cobrancas/nova');

    await addFromCatalog('Consultoria');
    await addFromCatalog('Consultoria');

    expect(screen.getByLabelText('Quantidade do item 1')).toHaveValue(2);
    expect(screen.queryByLabelText('Descrição do item 2')).not.toBeInTheDocument();
    const price = screen.getByLabelText('Preço unitário do item 1');
    expect(price).toHaveValue('R$ 150,00');
    expect(total()).toHaveTextContent('R$ 300,00');

    await userEvent.clear(price);
    await userEvent.type(price, '20000');
    expect(total()).toHaveTextContent('R$ 400,00');
  });

  it('[COB-01.3][COB-01.5] padrões das Configurações; erro de plano aparece no resumo e bloqueia o botão', async () => {
    mockApi({ settings: settingsDto({ defaultDueDays: 5, defaultFinePct: 2.5, defaultInterestPct: 1 }) });
    renderRoutes(routes, '/cobrancas/nova');

    expect(await screen.findByLabelText('Vencimento')).toHaveValue(addDays(today, 5));
    expect(screen.getByLabelText('Multa por atraso')).toHaveValue(2.5);
    expect(screen.getByLabelText('Juros ao mês')).toHaveValue(1);
    expect(screen.getByRole('radio', { name: /Parcelada/ })).toBeDisabled();

    await pickCustomer();
    expect(screen.getByText('Será criado no Asaas ao gerar a cobrança.')).toBeInTheDocument();

    await addFromCatalog('Taxa de adesão');
    expect(summary().getByText('A cobrança precisa ter no mínimo R$ 5,00')).toBeInTheDocument();
    expect(generateButton()).toBeDisabled();

    await addFromCatalog('Consultoria');
    expect(generateButton()).toBeEnabled();

    await userEvent.type(screen.getByLabelText('Desconto'), '99999');
    expect(summary().getByText('O desconto não pode ser maior que o subtotal')).toBeInTheDocument();
    expect(generateButton()).toBeDisabled();
  });

  it('[COB-01.1][COB-05.3] gera a avulsa, envia o plano e mostra o resultado com os dados para pagamento', async () => {
    const { created } = mockApi({ customers: [{ ...customerItem, asaasCustomerId: 'cus_000001' }] });
    const charge = chargeDetail({ billingType: 'BOLETO', pixPayload: null, identificationField: null });
    server.use(
      http.post(apiUrl('/charges'), async ({ request }) => {
        created.push(await request.json());
        return HttpResponse.json({ charges: [charge] }, { status: 201 });
      }),
      http.get(apiUrl('/charges/ch-1/payment-info'), () =>
        HttpResponse.json({
          invoiceUrl: charge.invoiceUrl,
          bankSlipUrl: 'https://sandbox.asaas.com/b/pdf/123',
          pixPayload: null,
          pixQrCodeBase64: null,
          identificationField: '23793381286000000000300000000400000000000030000',
        }),
      ),
    );
    renderRoutes(routes, '/cobrancas/nova');

    await pickCustomer();
    expect(screen.getByText(/Já existe no Asaas/)).toHaveTextContent('Já existe no Asaas (cus_000001)');
    await addFromCatalog('Consultoria');
    await userEvent.clear(screen.getByLabelText('Quantidade do item 1'));
    await userEvent.type(screen.getByLabelText('Quantidade do item 1'), '2');
    await userEvent.click(screen.getByRole('radio', { name: 'Boleto' }));

    await userEvent.click(screen.getByText('Chamada à API'));
    expect(await screen.findByText('/v3/payments')).toBeInTheDocument();

    await userEvent.click(generateButton());

    expect(await screen.findByRole('heading', { name: 'Cobrança gerada no Asaas' })).toBeInTheDocument();
    expect(created).toEqual([
      {
        customerId: 'c-1',
        plan: {
          items: [{ serviceId: consulting.id, description: 'Consultoria', quantity: 2, unitPriceCents: 15_000 }],
          type: 'SINGLE',
          billingType: 'BOLETO',
          dueDate: { mode: 'FIXED_DATE', date: addDays(today, 3) },
          discountCents: 0,
          finePct: 2,
          interestPct: 1,
        },
      },
    ]);
    expect(screen.getByText('pay_123')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copiar link da fatura' })).toBeInTheDocument();
    expect(await screen.findByText('23793381286000000000300000000400000000000030000')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copiar linha digitável' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver cobrança' })).toHaveAttribute('href', '/cobrancas/ch-1');

    await userEvent.click(screen.getByRole('button', { name: 'Criar outra' }));
    expect(await screen.findByRole('heading', { name: 'Nova cobrança' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Buscar cliente' })).toHaveValue('');
  });

  it('[COB-12.1] falha do Asaas guarda o rascunho e oferece descartar ou tentar de novo', async () => {
    mockApi();
    const calls: string[] = [];
    server.use(
      http.post(apiUrl('/charges'), () => {
        calls.push('create');
        return HttpResponse.json(
          { error: { code: 'ASAAS_UNAVAILABLE', message: 'O Asaas não respondeu. Tente de novo em instantes.', details: { chargeIds: ['ch-1'] } } },
          { status: 502 },
        );
      }),
      http.post(apiUrl('/charges/ch-1/discard'), () => {
        calls.push('discard');
        return HttpResponse.json(chargeDetail({ status: 'CANCELED' }));
      }),
      http.post(apiUrl('/charges/ch-1/retry'), () => {
        calls.push('retry');
        return HttpResponse.json(chargeDetail());
      }),
    );
    renderRoutes(routes, '/cobrancas/nova');

    await pickCustomer();
    await addFromCatalog('Consultoria');
    await userEvent.click(generateButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('O Asaas não respondeu. Tente de novo em instantes.');
    expect(screen.getByLabelText('Quantidade do item 1')).toBeDisabled();

    await userEvent.click(within(alert).getByRole('button', { name: 'Descartar' }));
    await waitFor(() => expect(generateButton()).toBeEnabled());
    expect(screen.getByLabelText('Quantidade do item 1')).toBeEnabled();

    await userEvent.click(generateButton());
    await userEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Tentar de novo' }));

    expect(await screen.findByRole('heading', { name: 'Cobrança gerada no Asaas' })).toBeInTheDocument();
    expect(calls).toEqual(['create', 'discard', 'create', 'retry']);
  });

  it('pré-seleciona o cliente vindo da ficha (?cliente=)', async () => {
    mockApi();
    server.use(http.get(apiUrl('/customers/c-1'), () => HttpResponse.json(customerDetail({ asaasCustomerId: 'cus_000001' }))));
    renderRoutes(routes, '/cobrancas/nova?cliente=c-1');

    expect(await screen.findByRole('button', { name: 'Trocar cliente' })).toBeInTheDocument();
    expect(summary().getByText('Maria Silva')).toBeInTheDocument();
    expect(screen.getByText(/Já existe no Asaas/)).toHaveTextContent('cus_000001');
  });

  it('[COB-01.6] cliente arquivado vindo da ficha não é selecionado', async () => {
    mockApi();
    server.use(
      http.get(apiUrl('/customers/c-1'), () => HttpResponse.json(customerDetail({ archivedAt: '2026-10-05T12:00:00.000Z' }))),
    );
    renderRoutes(routes, '/cobrancas/nova?cliente=c-1');

    expect(await screen.findByText('Maria Silva está arquivado e não pode receber cobranças.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Buscar cliente' })).toBeInTheDocument();
  });
});
