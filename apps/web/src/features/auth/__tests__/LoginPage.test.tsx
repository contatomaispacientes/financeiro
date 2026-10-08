import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { routes } from '@/router';
import { resetSessionForTests, session } from '@/lib/auth';
import { apiUrl, server } from '@/test/server';
import { fakeUser, mockEnvironment, renderRoutes, signIn } from '@/test/render';
import { page, userDto } from '@/test/fixtures';
import { safeRedirect } from '../LoginPage';

const admin = fakeUser('ADMIN');

function mockLogin() {
  const bodies: unknown[] = [];
  server.use(
    http.post(apiUrl('/auth/login'), async ({ request }) => {
      const body = (await request.json()) as { email: string; password: string };
      bodies.push(body);
      return body.password === 'senha-correta-1'
        ? HttpResponse.json({ accessToken: 'token-novo', user: admin })
        : HttpResponse.json(
            { error: { code: 'INVALID_CREDENTIALS', message: 'E-mail ou senha inválidos' } },
            { status: 401 },
          );
    }),
  );
  return bodies;
}

async function fillAndSubmit(email: string, password: string) {
  await userEvent.type(screen.getByLabelText('E-mail'), email);
  await userEvent.type(screen.getByLabelText('Senha'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
}

describe('LoginPage', () => {
  beforeEach(() => {
    signIn(null);
    mockEnvironment();
  });

  it('[FND-06.2] entra e volta para a rota de destino guardada no ?redirect', async () => {
    const bodies = mockLogin();
    server.use(http.get(apiUrl('/users'), () => HttpResponse.json(page([userDto()]))));
    const { router } = renderRoutes(routes, `/login?redirect=${encodeURIComponent('/configuracoes/usuarios')}`);

    await fillAndSubmit('  Ana@Empresa.com.br ', 'senha-correta-1');

    expect(await screen.findByRole('heading', { name: 'Usuários' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/configuracoes/usuarios');
    expect(bodies[0]).toEqual({ email: 'ana@empresa.com.br', password: 'senha-correta-1' });
    expect(session.getAccessToken()).toBe('token-novo');
  });

  it('sem ?redirect vai para a visão geral', async () => {
    mockLogin();
    const { router } = renderRoutes(routes, '/login');
    await fillAndSubmit('ana@empresa.com.br', 'senha-correta-1');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('[FND-02.2] credenciais inválidas: mostra a mensagem da API e continua no login', async () => {
    mockLogin();
    const { router } = renderRoutes(routes, '/login');

    await fillAndSubmit('ana@empresa.com.br', 'senha-errada-1');

    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha inválidos');
    expect(router.state.location.pathname).toBe('/login');
    expect(session.getState().status).toBe('anonymous');
  });

  it('[FND-02.5] excesso de tentativas mostra a mensagem de espera', async () => {
    server.use(
      http.post(apiUrl('/auth/login'), () =>
        HttpResponse.json(
          { error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Aguarde um minuto.' } },
          { status: 429 },
        ),
      ),
    );
    renderRoutes(routes, '/login');
    await fillAndSubmit('ana@empresa.com.br', 'qualquer-senha');
    expect(await screen.findByRole('alert')).toHaveTextContent('Aguarde um minuto');
  });

  it('valida no navegador, em português, sem chamar a API', async () => {
    const bodies = mockLogin();
    renderRoutes(routes, '/login');

    await fillAndSubmit('nao-e-email', '123');

    expect(await screen.findByText('Formato do endereço de e-mail inválido')).toBeInTheDocument();
    expect(screen.getByText(/esperava que o texto tivesse >= 8 caracteres/)).toBeInTheDocument();
    expect(screen.getByLabelText('E-mail')).toHaveAttribute('aria-invalid', 'true');
    expect(bodies).toHaveLength(0);
  });

  it('[FND-06.2] avisa quando a sessão expirou', () => {
    resetSessionForTests({ status: 'anonymous', expired: true });
    renderRoutes(routes, '/login?redirect=%2Fdespesas');
    expect(screen.getByRole('status')).toHaveTextContent('Sua sessão expirou');
  });

  it('já autenticado, sai direto do login', () => {
    signIn('ADMIN');
    const { router } = renderRoutes(routes, '/login?redirect=%2Fclientes');
    expect(router.state.location.pathname).toBe('/clientes');
  });

  it('mostra e oculta a senha', async () => {
    renderRoutes(routes, '/login');
    const input = screen.getByLabelText('Senha');
    expect(input).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }));
    expect(input).toHaveAttribute('type', 'text');
  });
});

describe('safeRedirect', () => {
  it.each([
    [null, '/'],
    ['/clientes?busca=ana', '/clientes?busca=ana'],
    ['//site-malicioso.com', '/'],
    ['/\\site-malicioso.com', '/'],
    ['https://site-malicioso.com', '/'],
    ['javascript:alert(1)', '/'],
    ['/login', '/'],
  ])('%s → %s', (input, expected) => {
    expect(safeRedirect(input)).toBe(expected);
  });
});
