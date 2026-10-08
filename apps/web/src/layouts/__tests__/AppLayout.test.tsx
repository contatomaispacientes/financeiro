import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { routes } from '@/router';
import { apiUrl, server } from '@/test/server';
import { renderRoutes, signIn } from '@/test/render';
import { session } from '@/lib/auth';

function mockEnvironment(asaasEnv: 'sandbox' | 'production' = 'sandbox') {
  server.use(http.get(apiUrl('/settings/environment'), () => HttpResponse.json({ asaasEnv })));
}

function menuLinks() {
  const nav = screen.getByRole('navigation', { name: 'Menu principal' });
  return within(nav)
    .getAllByRole('link')
    .map((link) => link.textContent);
}

describe('AppLayout', () => {
  beforeEach(() => mockEnvironment());

  it('[FND-06.1] menu com os grupos Análise, Contas a receber, Contas a pagar e Sistema', async () => {
    signIn('ADMIN');
    renderRoutes(routes, '/');

    for (const group of ['Análise', 'Contas a receber', 'Contas a pagar', 'Sistema']) {
      expect(screen.getByText(group)).toBeInTheDocument();
    }
    expect(screen.getByRole('heading', { name: 'Visão geral' })).toBeInTheDocument();
  });

  it('[FND-06.1] mostra o selo do ambiente do Asaas', async () => {
    signIn('LEITURA');
    renderRoutes(routes, '/');
    expect((await screen.findAllByText('Asaas Sandbox')).length).toBeGreaterThan(0);
  });

  it('[FND-06.1] selo de produção', async () => {
    mockEnvironment('production');
    signIn('ADMIN');
    renderRoutes(routes, '/');
    expect((await screen.findAllByText('Asaas Produção')).length).toBeGreaterThan(0);
  });

  it('[FND-06.3] ADMIN vê todos os itens, inclusive Usuários e Auditoria', () => {
    signIn('ADMIN');
    renderRoutes(routes, '/');
    expect(menuLinks()).toEqual(
      expect.arrayContaining(['Nova cobrança', 'Usuários', 'Auditoria', 'Log de eventos', 'Configurações']),
    );
  });

  it('[FND-06.3] FINANCEIRO não vê itens de administração', () => {
    signIn('FINANCEIRO');
    renderRoutes(routes, '/');
    const links = menuLinks();
    expect(links).toContain('Nova cobrança');
    expect(links).not.toContain('Usuários');
    expect(links).not.toContain('Auditoria');
    expect(links).not.toContain('Log de eventos');
  });

  it('[FND-06.3] LEITURA não vê ações de criação nem administração', () => {
    signIn('LEITURA');
    renderRoutes(routes, '/');
    const links = menuLinks();
    expect(links).toContain('Cobranças');
    expect(links).not.toContain('Nova cobrança');
    expect(links).not.toContain('Usuários');
  });

  it('[FND-06.3] rota de ADMIN acessada direto pelo endereço mostra "Sem permissão"', () => {
    signIn('FINANCEIRO');
    renderRoutes(routes, '/configuracoes/usuarios');
    expect(screen.getByRole('heading', { name: 'Sem permissão' })).toBeInTheDocument();
  });

  it('marca o item da tela atual', () => {
    signIn('ADMIN');
    renderRoutes(routes, '/clientes');
    const nav = screen.getByRole('navigation', { name: 'Menu principal' });
    expect(within(nav).getByRole('link', { name: 'Clientes' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Visão geral' })).not.toHaveAttribute('aria-current');
  });

  it('mostra quem está logado e sai pelo botão "Sair"', async () => {
    signIn('ADMIN');
    server.use(http.post(apiUrl('/auth/logout'), () => new HttpResponse(null, { status: 204 })));
    const { router } = renderRoutes(routes, '/');

    expect(screen.getAllByText('Ana Souza').length).toBeGreaterThan(0);
    expect(screen.getByText('Administrador')).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Sair' })[0]!);

    expect(session.getState().status).toBe('anonymous');
    expect(router.state.location.pathname).toBe('/login');
  });
});
