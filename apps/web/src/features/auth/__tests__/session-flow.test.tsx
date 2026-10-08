import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { routes } from '@/router';
import { resetSessionForTests, session } from '@/lib/auth';
import { apiUrl, server } from '@/test/server';
import { fakeUser, mockEnvironment, renderRoutes } from '@/test/render';
import { page, userDto } from '@/test/fixtures';

const admin = fakeUser('ADMIN');

describe('[FND-06.2] sessão nas telas', () => {
  beforeEach(() => {
    mockEnvironment();
    resetSessionForTests({ status: 'authenticated', user: admin, token: 'token-vencido' });
  });

  it('token expirado → refresh → repete a chamada e a tela carrega sem o usuário perceber', async () => {
    let refreshCalls = 0;
    const authHeaders: Array<string | null> = [];
    server.use(
      http.get(apiUrl('/users'), ({ request }) => {
        authHeaders.push(request.headers.get('authorization'));
        return request.headers.get('authorization') === 'Bearer token-novo'
          ? HttpResponse.json(page([userDto({ name: 'Bruno Lima', email: 'bruno@empresa.com.br' })]))
          : HttpResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Não autenticado' } }, { status: 401 });
      }),
      http.post(apiUrl('/auth/refresh'), () => {
        refreshCalls += 1;
        return HttpResponse.json({ accessToken: 'token-novo', user: admin });
      }),
    );

    renderRoutes(routes, '/configuracoes/usuarios');

    expect(await screen.findByText('Bruno Lima')).toBeInTheDocument();
    expect(refreshCalls).toBe(1);
    expect(authHeaders).toEqual(['Bearer token-vencido', 'Bearer token-novo']);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('refresh recusado → volta ao login preservando a rota, e ao entrar retorna a ela', async () => {
    let usersCalls = 0;
    server.use(
      http.get(apiUrl('/users'), ({ request }) => {
        usersCalls += 1;
        return request.headers.get('authorization') === 'Bearer token-novo'
          ? HttpResponse.json(page([userDto()]))
          : new HttpResponse(null, { status: 401 });
      }),
      http.post(apiUrl('/auth/refresh'), () =>
        HttpResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sessão expirada' } }, { status: 401 }),
      ),
      http.post(apiUrl('/auth/login'), () => HttpResponse.json({ accessToken: 'token-novo', user: admin })),
    );

    const { router } = renderRoutes(routes, '/configuracoes/usuarios?pagina=2');

    expect(await screen.findByText(/Sua sessão expirou/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(new URLSearchParams(router.state.location.search).get('redirect')).toBe(
      '/configuracoes/usuarios?pagina=2',
    );
    expect(session.getState()).toMatchObject({ status: 'anonymous', expired: true });

    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@empresa.com.br');
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-correta-1');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/configuracoes/usuarios'));
    expect(router.state.location.search).toBe('?pagina=2');
    expect(await screen.findByRole('heading', { name: 'Usuários' })).toBeInTheDocument();
    expect(usersCalls).toBeGreaterThanOrEqual(2);
  });
});
