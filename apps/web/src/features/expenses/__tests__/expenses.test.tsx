import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ExpenseDto, ExpenseListDto } from '@financeiro/shared';
import { routes } from '@/router';
import { apiUrl, server } from '@/test/server';
import { mockEnvironment, renderRoutes, signIn } from '@/test/render';

const late: ExpenseDto = {
  id: 'e-1',
  description: 'Aluguel',
  category: { id: 'cat-1', name: 'Escritório' },
  supplier: 'Imobiliária',
  valueCents: 150_000,
  dueDate: '2026-10-01',
  status: 'OPEN',
  late: true,
  paidAt: null,
  paidValueCents: null,
  paymentMethod: null,
  recurrenceId: 'r-1',
  notes: null,
  createdAt: '2026-09-01T12:00:00.000Z',
};

const list: ExpenseListDto = {
  data: [late],
  meta: { page: 1, pageSize: 20, total: 1 },
  summary: {
    openCents: 150_000,
    lateCents: 150_000,
    paidThisMonthCents: 20_000,
    monthTotalCents: 170_000,
    countByState: { open: 0, late: 1, paid: 2, canceled: 0 },
  },
};

describe('[DSP-05][DSP-02] Contas a pagar', () => {
  beforeEach(() => {
    signIn('FINANCEIRO');
    mockEnvironment();
    server.use(http.get(apiUrl('/expense-categories'), () => HttpResponse.json([{ id: 'cat-1', name: 'Escritório', active: true }])));
  });

  it('mostra KPIs, situação atrasada e marca como paga com forma de pagamento', async () => {
    const payments: unknown[] = [];
    server.use(
      http.get(apiUrl('/expenses'), () => HttpResponse.json(list)),
      http.post(apiUrl('/expenses/e-1/pay'), async ({ request }) => {
        payments.push(await request.json());
        return HttpResponse.json({ ...late, status: 'PAID', late: false });
      }),
    );
    renderRoutes(routes, '/despesas');

    const row = (await screen.findByText('Aluguel')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Atrasada')).toBeInTheDocument();
    expect(screen.getByText('Atrasadas', { selector: 'p' }).nextSibling).toHaveTextContent(/R\$\s1\.500,00/);

    await userEvent.click(within(row).getByRole('button', { name: 'Marcar paga' }));
    const dialog = await screen.findByRole('dialog', { name: 'Marcar como paga' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar pagamento' }));

    await waitFor(() => expect(payments).toHaveLength(1));
    expect(payments[0]).toMatchObject({ paidValueCents: 150_000, paymentMethod: 'PIX' });
  });

  it('LEITURA não vê ações', async () => {
    signIn('LEITURA');
    server.use(http.get(apiUrl('/expenses'), () => HttpResponse.json(list)));
    renderRoutes(routes, '/despesas');
    await screen.findByText('Aluguel');
    expect(screen.queryByRole('button', { name: 'Marcar paga' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Nova despesa/ })).not.toBeInTheDocument();
  });
});
