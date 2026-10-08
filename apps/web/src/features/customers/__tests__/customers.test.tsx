import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { CustomerDetailDto, CustomerListItemDto } from '@financeiro/shared';
import { routes } from '@/router';
import { apiUrl, server } from '@/test/server';
import { mockEnvironment, renderRoutes, signIn } from '@/test/render';
import { page } from '@/test/fixtures';

const item: CustomerListItemDto = {
  id: 'c-1',
  name: 'Maria Silva',
  personType: 'PF',
  document: '52998224725',
  email: 'maria@example.com',
  phone: '11999990001',
  asaasCustomerId: null,
  archivedAt: null,
  chargesCount: 3,
  paidCents: 150_000,
  openCents: 30_000,
  overdueCents: 10_000,
};

const detail: CustomerDetailDto = {
  ...item,
  address: null,
  notes: null,
  remindersEnabled: true,
  asaasSyncError: null,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
  totals: { chargesCount: 3, paidCents: 150_000, openCents: 30_000, overdueCents: 10_000 },
  recentCharges: [
    {
      id: 'ch-1',
      description: 'Consultoria',
      type: 'SINGLE',
      status: 'OVERDUE',
      billingType: 'PIX',
      valueCents: 10_000,
      dueDate: '2026-10-05',
      paidAt: null,
      installmentNumber: null,
      installmentCount: null,
      asaasPaymentId: 'pay_1',
    },
  ],
  subscriptions: [],
  contracts: [],
};

describe('[CLI-01][CLI-02][CLI-03] telas de clientes', () => {
  beforeEach(() => {
    signIn('FINANCEIRO');
    mockEnvironment();
  });

  it('lista com totais e busca refletida na requisição', async () => {
    const searches: Array<string | null> = [];
    server.use(
      http.get(apiUrl('/customers'), ({ request }) => {
        searches.push(new URL(request.url).searchParams.get('search'));
        return HttpResponse.json(page([item]));
      }),
    );
    renderRoutes(routes, '/clientes');

    const row = (await screen.findByRole('link', { name: 'Maria Silva' })).closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('529.982.247-25');
    expect(row).toHaveTextContent('Criado na 1ª cobrança');
    expect(row).toHaveTextContent(/R\$\s1\.500,00/);
    expect(row).toHaveTextContent(/R\$\s100,00 vencido/);

    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar clientes' }), 'joão');
    await waitFor(() => expect(searches.at(-1)).toBe('joão'));
  });

  it('cadastro: valida, avisa duplicado ao sair do CPF e abre a ficha do novo cliente', async () => {
    const created: unknown[] = [];
    server.use(
      http.get(apiUrl('/customers'), () => HttpResponse.json(page([]))),
      http.get(apiUrl('/customers/lookup'), ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.get('document') === '52998224725'
            ? { exists: true, customerId: 'c-1', name: 'Maria Silva', archived: false }
            : { exists: false },
        ),
      ),
      http.post(apiUrl('/customers'), async ({ request }) => {
        created.push(await request.json());
        return HttpResponse.json({ ...detail, id: 'c-new', name: 'Tech Ltda' }, { status: 201 });
      }),
      http.get(apiUrl('/customers/c-new'), () => HttpResponse.json({ ...detail, id: 'c-new', name: 'Tech Ltda' })),
    );
    const { router } = renderRoutes(routes, '/clientes');

    await userEvent.click(await screen.findByRole('button', { name: 'Novo cliente' }));
    const sheet = await screen.findByRole('dialog', { name: 'Novo cliente' });

    await userEvent.click(within(sheet).getByRole('button', { name: 'Cadastrar cliente' }));
    expect(await within(sheet).findByText('CPF ou CNPJ inválido')).toBeInTheDocument();

    const doc = within(sheet).getByLabelText('CPF ou CNPJ');
    await userEvent.type(doc, '52998224725');
    expect(doc).toHaveValue('529.982.247-25');
    await userEvent.tab();
    expect(await within(sheet).findByText('Maria Silva')).toBeInTheDocument();

    await userEvent.clear(doc);
    await userEvent.type(doc, '11222333000181');
    expect(doc).toHaveValue('11.222.333/0001-81');
    await userEvent.type(within(sheet).getByLabelText('Nome ou razão social'), 'Tech Ltda');
    await userEvent.type(within(sheet).getByLabelText('Celular'), '11988887777');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cadastrar cliente' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/clientes/c-new'));
    expect(created[0]).toMatchObject({ name: 'Tech Ltda', document: '11222333000181', phone: '11988887777', address: null, remindersEnabled: true });
  });

  it('ficha: totais, aviso de endereço para contrato e arquivar com confirmação', async () => {
    const actions: string[] = [];
    server.use(
      http.get(apiUrl('/customers/c-1'), () => HttpResponse.json(detail)),
      http.post(apiUrl('/customers/c-1/archive'), () => {
        actions.push('archive');
        return HttpResponse.json(
          { error: { code: 'CUSTOMER_HAS_OPEN_ITEMS', message: 'Não dá para arquivar: há cobrança em aberto' } },
          { status: 409 },
        );
      }),
    );
    renderRoutes(routes, '/clientes/c-1');

    expect(await screen.findByRole('heading', { name: 'Maria Silva' })).toBeInTheDocument();
    expect(screen.getByText(/Endereço de cobrança incompleto/)).toBeInTheDocument();
    expect(screen.getByText('Vencido', { selector: 'p' }).nextSibling).toHaveTextContent(/R\$\s100,00/);
    expect(within(screen.getByRole('main')).getByRole('link', { name: /Nova cobrança/ })).toHaveAttribute('href', '/cobrancas/nova?cliente=c-1');
    expect(screen.getByRole('link', { name: 'Consultoria' })).toHaveAttribute('href', '/cobrancas/ch-1');

    await userEvent.click(screen.getByRole('button', { name: 'Arquivar' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Arquivar' }));
    expect(await screen.findByText(/há cobrança em aberto/)).toBeInTheDocument();
    expect(actions).toEqual(['archive']);
  });

  it('[CLI-02.4] LEITURA não vê ações de edição', async () => {
    signIn('LEITURA');
    server.use(http.get(apiUrl('/customers/c-1'), () => HttpResponse.json({ ...detail, document: '***.982.247-**' })));
    renderRoutes(routes, '/clientes/c-1');
    expect(await screen.findByText(/\*\*\*\.982\.247-\*\*/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('main')).queryByRole('link', { name: /Nova cobrança/ })).not.toBeInTheDocument();
  });
});
