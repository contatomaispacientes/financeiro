import { act, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { routes } from '@/router';
import { expireSession, resetSessionForTests } from '@/lib/auth';
import { apiUrl, server } from '@/test/server';
import { renderRoutes, signIn } from '@/test/render';

describe('RequireAuth', () => {
  beforeEach(() => {
    server.use(http.get(apiUrl('/settings/environment'), () => HttpResponse.json({ asaasEnv: 'sandbox' })));
  });

  it('enquanto restaura a sessão mostra carregando, sem piscar o login', () => {
    resetSessionForTests({ status: 'loading' });
    const { router } = renderRoutes(routes, '/clientes');
    expect(screen.getByText('Carregando sessão…')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/clientes');
  });

  it('[FND-06.2] sem sessão vai ao login guardando a rota de destino', () => {
    signIn(null);
    const { router } = renderRoutes(routes, '/clientes?busca=ana');
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe(`?redirect=${encodeURIComponent('/clientes?busca=ana')}`);
  });

  it('da raiz vai ao login sem parâmetro de retorno', () => {
    signIn(null);
    const { router } = renderRoutes(routes, '/');
    expect(router.state.location.search).toBe('');
  });

  it('[FND-06.2] quando a sessão expira na tela, volta ao login preservando a rota', () => {
    signIn('ADMIN');
    const { router } = renderRoutes(routes, '/despesas');
    expect(router.state.location.pathname).toBe('/despesas');

    act(() => expireSession());

    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe(`?redirect=${encodeURIComponent('/despesas')}`);
  });
});
