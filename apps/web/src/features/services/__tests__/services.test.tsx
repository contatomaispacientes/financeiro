import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ServiceListItemDto } from '@financeiro/shared';
import { routes } from '@/router';
import { apiUrl, server } from '@/test/server';
import { mockEnvironment, renderRoutes, signIn } from '@/test/render';

const item: ServiceListItemDto = {
  id: 's-1',
  name: 'Consultoria mensal',
  description: 'Acompanhamento financeiro',
  defaultPriceCents: 150_000,
  active: true,
  usageCount: 4,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
};

const list = (data: ServiceListItemDto[]) => HttpResponse.json({ data });
const conflict = (code: string, message: string) => HttpResponse.json({ error: { code, message } }, { status: 409 });

describe('[SRV-01][SRV-02][SRV-03] tela de serviços', () => {
  beforeEach(() => {
    signIn('FINANCEIRO');
    mockEnvironment();
  });

  it('[SRV-03.1] lista preço, vendas e situação; filtro de situação vai na requisição', async () => {
    const statuses: Array<string | null> = [];
    server.use(
      http.get(apiUrl('/services'), ({ request }) => {
        statuses.push(new URL(request.url).searchParams.get('status'));
        return list([item]);
      }),
    );
    renderRoutes(routes, '/servicos');

    const row = (await screen.findByText('Consultoria mensal')).closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('Acompanhamento financeiro');
    expect(row).toHaveTextContent(/R\$\s1\.500,00/);
    expect(within(row).getAllByRole('cell')[2]).toHaveTextContent('4');
    expect(within(row).getByRole('switch', { name: 'Ativar ou desativar Consultoria mensal' })).toBeChecked();

    await userEvent.click(screen.getByRole('tab', { name: 'Inativos' }));
    await waitFor(() => expect(statuses.at(-1)).toBe('inactive'));
    expect(statuses[0]).toBe('active');
  });

  it('[SRV-01.1][SRV-01.2] formulário: valida, mostra nome duplicado no campo e cadastra em centavos', async () => {
    const posted: unknown[] = [];
    server.use(
      http.get(apiUrl('/services'), () => list([])),
      http.post(apiUrl('/services'), async ({ request }) => {
        posted.push(await request.json());
        return posted.length === 1
          ? conflict('SERVICE_DUPLICATE', 'Já existe um serviço ativo com este nome')
          : HttpResponse.json({ ...item, id: 's-new', name: 'Gestão de tráfego' }, { status: 201 });
      }),
    );
    renderRoutes(routes, '/servicos');

    await userEvent.click(await screen.findByRole('button', { name: 'Novo serviço' }));
    const sheet = await screen.findByRole('dialog', { name: 'Novo serviço' });

    await userEvent.click(within(sheet).getByRole('button', { name: 'Cadastrar serviço' }));
    expect(await within(sheet).findByText('Informe o nome (mínimo 2 caracteres)')).toBeInTheDocument();
    expect(within(sheet).getByText('Informe um preço maior que zero')).toBeInTheDocument();

    await userEvent.type(within(sheet).getByLabelText('Nome'), 'Gestão de tráfego');
    const price = within(sheet).getByLabelText('Preço padrão');
    await userEvent.type(price, '150000');
    expect((price as HTMLInputElement).value).toMatch(/^R\$\s1\.500,00$/);

    await userEvent.click(within(sheet).getByRole('button', { name: 'Cadastrar serviço' }));
    expect(await within(sheet).findByText('Já existe um serviço ativo com este nome')).toBeInTheDocument();

    await userEvent.click(within(sheet).getByRole('button', { name: 'Cadastrar serviço' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Novo serviço' })).not.toBeInTheDocument());
    expect(posted[1]).toEqual({ name: 'Gestão de tráfego', description: null, defaultPriceCents: 150_000, active: true });
  });

  it('[SRV-02.1] toggle muda na hora e volta se a API recusar', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const patched: unknown[] = [];
    server.use(
      http.get(apiUrl('/services'), () => list([item])),
      http.patch(apiUrl('/services/s-1'), async ({ request }) => {
        patched.push(await request.json());
        await held;
        return conflict('SERVICE_DUPLICATE', 'Já existe um serviço ativo com este nome');
      }),
    );
    renderRoutes(routes, '/servicos');

    const toggle = await screen.findByRole('switch', { name: 'Ativar ou desativar Consultoria mensal' });
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(patched).toEqual([{ active: false }]);

    release();
    await waitFor(() => expect(toggle).toBeChecked());
    expect(await screen.findByText('Já existe um serviço ativo com este nome')).toBeInTheDocument();
  });

  it('[SRV-02.2] excluir serviço já usado avisa e oferece desativar', async () => {
    server.use(
      http.get(apiUrl('/services'), () => list([item])),
      http.delete(apiUrl('/services/s-1'), () =>
        conflict('SERVICE_IN_USE', 'Este serviço já foi usado e não pode ser excluído. Desative-o para tirá-lo do catálogo.'),
      ),
    );
    renderRoutes(routes, '/servicos');

    await userEvent.click(await screen.findByRole('button', { name: 'Excluir Consultoria mensal' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Excluir' }));

    expect(await screen.findByText(/não pode ser excluído/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desativar' })).toBeInTheDocument();
  });

  it('LEITURA vê a lista sem ações', async () => {
    signIn('LEITURA');
    server.use(http.get(apiUrl('/services'), () => list([item])));
    renderRoutes(routes, '/servicos');

    expect(await screen.findByText('Consultoria mensal')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Novo serviço' })).not.toBeInTheDocument();
  });
});
