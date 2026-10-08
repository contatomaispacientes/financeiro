import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { AuditLogDto } from '@financeiro/shared';
import { routes } from '@/router';
import { apiUrl, server } from '@/test/server';
import { mockEnvironment, renderRoutes, signIn } from '@/test/render';
import { page, userDto } from '@/test/fixtures';

const logs: AuditLogDto[] = [
  {
    id: 'a1',
    action: 'user.update',
    entity: 'user',
    entityId: 'u-2',
    userId: 'u-1',
    userName: 'Ana Souza',
    data: { before: { role: 'LEITURA', active: true }, after: { role: 'FINANCEIRO', active: false } },
    createdAt: '2026-10-07T17:30:00.000Z',
  },
  {
    id: 'a2',
    action: 'auth.login_failed',
    entity: 'user',
    entityId: 'u-2',
    userId: 'u-2',
    userName: 'Bruno Lima',
    data: { email: 'bruno@empresa.com.br', reason: 'WRONG_PASSWORD' },
    createdAt: '2026-10-07T16:00:00.000Z',
  },
  {
    id: 'a3',
    action: 'settings.update',
    entity: 'settings',
    entityId: '1',
    userId: 'u-1',
    userName: 'Ana Souza',
    data: { before: { defaultFinePct: 2 }, after: { defaultFinePct: 2.5 } },
    createdAt: '2026-10-07T15:00:00.000Z',
  },
];

function mockAuditApi(total = logs.length) {
  const requests: URLSearchParams[] = [];
  server.use(
    http.get(apiUrl('/audit-logs'), ({ request }) => {
      const params = new URL(request.url).searchParams;
      requests.push(params);
      return HttpResponse.json(page(logs, { page: Number(params.get('page')), pageSize: 25, total }));
    }),
    http.get(apiUrl('/users'), () =>
      HttpResponse.json(page([userDto(), userDto({ id: 'u-2', name: 'Bruno Lima' })])),
    ),
  );
  return requests;
}

describe('[FND-05.2] Auditoria', () => {
  beforeEach(() => {
    signIn('ADMIN');
    mockEnvironment();
  });

  it('mostra quem, quando, a ação e o que mudou em texto legível', async () => {
    mockAuditApi();
    renderRoutes(routes, '/configuracoes/auditoria');

    const update = (await screen.findByText('Alterou usuário')).closest('tr') as HTMLElement;
    expect(within(update).getByText('Ana Souza')).toBeInTheDocument();
    expect(update).toHaveTextContent('Papel: Leitura → Financeiro');
    expect(update).toHaveTextContent('Ativo: Sim → Não');

    // A conta tentada (Bruno) é o alvo: quem tentou não estava autenticado.
    const failed = screen.getByText('Tentativa de login recusada').closest('tr') as HTMLElement;
    expect(failed).toHaveTextContent('bruno@empresa.com.br · senha incorreta');
    expect(within(failed).getByText('Não autenticado')).toBeInTheDocument();
    expect(within(failed).queryByText('Bruno Lima')).not.toBeInTheDocument();

    expect(screen.getByText('Alterou configurações').closest('tr')).toHaveTextContent('Multa (%): 2 → 2.5');
  });

  it('filtra por entidade e período; os filtros ficam na URL', async () => {
    const requests = mockAuditApi();
    const { router } = renderRoutes(routes, '/configuracoes/auditoria');
    await screen.findByText('Alterou usuário');

    await userEvent.click(screen.getByRole('combobox', { name: 'Entidade' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Configurações' }));
    await waitFor(() => expect(requests.at(-1)?.get('entity')).toBe('settings'));

    await userEvent.type(screen.getByLabelText('De'), '2026-10-01');
    await waitFor(() => expect(requests.at(-1)?.get('from')).toBe('2026-10-01'));

    const search = new URLSearchParams(router.state.location.search);
    expect(search.get('entidade')).toBe('settings');
    expect(search.get('de')).toBe('2026-10-01');
  });

  it('filtra por usuário', async () => {
    const requests = mockAuditApi();
    renderRoutes(routes, '/configuracoes/auditoria');
    await screen.findByText('Alterou usuário');

    await userEvent.click(screen.getByRole('combobox', { name: 'Usuário' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Bruno Lima' }));
    await waitFor(() => expect(requests.at(-1)?.get('userId')).toBe('u-2'));
  });

  it('abre com os filtros vindos da URL e limpa tudo', async () => {
    const requests = mockAuditApi();
    const { router } = renderRoutes(routes, '/configuracoes/auditoria?entidade=user&de=2026-10-01&pagina=2');

    await screen.findByText('Alterou usuário');
    expect(requests[0]?.get('entity')).toBe('user');
    expect(requests[0]?.get('from')).toBe('2026-10-01');
    expect(requests[0]?.get('page')).toBe('2');

    await userEvent.click(screen.getByRole('button', { name: 'Limpar' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
    await waitFor(() => expect(requests.at(-1)?.get('entity')).toBeNull());
  });

  it('pagina', async () => {
    const requests = mockAuditApi(60);
    renderRoutes(routes, '/configuracoes/auditoria');
    await screen.findByText('1–25 de 60');

    await userEvent.click(screen.getByRole('button', { name: /Próxima/ }));
    await waitFor(() => expect(requests.at(-1)?.get('page')).toBe('2'));
  });

  it('sem resultados com filtro sugere ampliar a busca', async () => {
    server.use(
      http.get(apiUrl('/audit-logs'), () => HttpResponse.json(page([]))),
      http.get(apiUrl('/users'), () => HttpResponse.json(page([]))),
    );
    renderRoutes(routes, '/configuracoes/auditoria?entidade=user');
    expect(await screen.findByText('Nada encontrado com esses filtros')).toBeInTheDocument();
  });
});
