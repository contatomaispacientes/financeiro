import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { UserDto } from '@financeiro/shared';
import { routes } from '@/router';
import { apiUrl, server } from '@/test/server';
import { mockEnvironment, renderRoutes, signIn } from '@/test/render';
import { page, userDto } from '@/test/fixtures';

const me = userDto({ id: 'u-1', name: 'Ana Souza', role: 'ADMIN' });
const bruno = userDto({ id: 'u-2', name: 'Bruno Lima', email: 'bruno@empresa.com.br', role: 'LEITURA', lastLoginAt: null });

/** API de usuários em memória: o que a tela grava aparece na próxima listagem. */
function mockUsersApi(initial: UserDto[] = [me, bruno]) {
  const users = [...initial];
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  server.use(
    http.get(apiUrl('/users'), ({ request }) => {
      const url = new URL(request.url);
      return HttpResponse.json(
        page(users, { page: Number(url.searchParams.get('page')), pageSize: Number(url.searchParams.get('pageSize')) }),
      );
    }),
    http.post(apiUrl('/users'), async ({ request }) => {
      const body = (await request.json()) as UserDto & { password: string };
      calls.push({ method: 'POST', path: '/users', body });
      if (users.some((u) => u.email === body.email)) {
        return HttpResponse.json(
          { error: { code: 'EMAIL_IN_USE', message: 'Já existe um usuário com este e-mail' } },
          { status: 409 },
        );
      }
      const created = userDto({ id: 'u-new', name: body.name, email: body.email, role: body.role, lastLoginAt: null });
      users.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),
    http.patch(apiUrl('/users/:id'), async ({ request, params }) => {
      const body = (await request.json()) as Partial<UserDto>;
      calls.push({ method: 'PATCH', path: `/users/${params['id']}`, body });
      const user = users.find((u) => u.id === params['id'])!;
      Object.assign(user, body);
      return HttpResponse.json(user);
    }),
    http.post(apiUrl('/users/:id/reset-password'), async ({ request, params }) => {
      calls.push({ method: 'POST', path: `/users/${params['id']}/reset-password`, body: await request.json() });
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return calls;
}

function row(name: string) {
  return screen.getByRole('row', { name: new RegExp(name) });
}

describe('[FND-03.1] Usuários', () => {
  beforeEach(() => {
    signIn('ADMIN');
    mockEnvironment();
  });

  it('lista com papel, situação e último acesso', async () => {
    mockUsersApi();
    renderRoutes(routes, '/configuracoes/usuarios');

    expect(await screen.findByText('Bruno Lima')).toBeInTheDocument();
    expect(within(row('Ana Souza')).getByText('(você)')).toBeInTheDocument();
    expect(within(row('Bruno Lima')).getByText('Leitura')).toBeInTheDocument();
    expect(within(row('Bruno Lima')).getByText('Nunca entrou')).toBeInTheDocument();
    expect(within(row('Bruno Lima')).getByText('Ativo')).toBeInTheDocument();
    expect(screen.getByText('1–2 de 2')).toBeInTheDocument();
  });

  it('cria usuário (papel Financeiro por padrão) e ele aparece na lista', async () => {
    const calls = mockUsersApi();
    renderRoutes(routes, '/configuracoes/usuarios');
    await screen.findByText('Bruno Lima');

    await userEvent.click(screen.getByRole('button', { name: 'Novo usuário' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo usuário' });
    await userEvent.type(within(dialog).getByLabelText('Nome'), 'Carla Dias');
    await userEvent.type(within(dialog).getByLabelText('E-mail'), 'Carla@Empresa.com.br');
    await userEvent.type(within(dialog).getByLabelText('Senha inicial'), 'senha-inicial-1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar usuário' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/users',
      body: { name: 'Carla Dias', email: 'carla@empresa.com.br', role: 'FINANCEIRO', password: 'senha-inicial-1' },
    });
    expect(await screen.findByText('Carla Dias')).toBeInTheDocument();
    expect(await screen.findByText(/já pode entrar/)).toBeInTheDocument();
  });

  it('e-mail repetido aparece no próprio campo (EMAIL_IN_USE)', async () => {
    mockUsersApi();
    renderRoutes(routes, '/configuracoes/usuarios');
    await screen.findByText('Bruno Lima');

    await userEvent.click(screen.getByRole('button', { name: 'Novo usuário' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Nome'), 'Outro Bruno');
    await userEvent.type(within(dialog).getByLabelText('E-mail'), 'bruno@empresa.com.br');
    await userEvent.type(within(dialog).getByLabelText('Senha inicial'), 'senha-inicial-1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar usuário' }));

    expect(await within(dialog).findByText('Já existe um usuário com este e-mail')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('E-mail')).toHaveAttribute('aria-invalid', 'true');
  });

  it('valida senha curta antes de enviar', async () => {
    const calls = mockUsersApi();
    renderRoutes(routes, '/configuracoes/usuarios');
    await screen.findByText('Bruno Lima');

    await userEvent.click(screen.getByRole('button', { name: 'Novo usuário' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Nome'), 'Carla Dias');
    await userEvent.type(within(dialog).getByLabelText('E-mail'), 'carla@empresa.com.br');
    await userEvent.type(within(dialog).getByLabelText('Senha inicial'), 'curta');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar usuário' }));

    expect(await within(dialog).findByText('A senha precisa ter ao menos 10 caracteres')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('edita o papel pelo seletor', async () => {
    const calls = mockUsersApi();
    renderRoutes(routes, '/configuracoes/usuarios');
    await screen.findByText('Bruno Lima');

    await userEvent.click(screen.getByRole('button', { name: 'Editar Bruno Lima' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar usuário' });
    expect(within(dialog).queryByLabelText('Senha inicial')).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Papel' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Financeiro' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PATCH',
        path: '/users/u-2',
        body: { name: 'Bruno Lima', email: 'bruno@empresa.com.br', role: 'FINANCEIRO' },
      }),
    );
    expect(await within(row('Bruno Lima')).findByText('Financeiro')).toBeInTheDocument();
  });

  it('desativa só depois de confirmar', async () => {
    const calls = mockUsersApi();
    renderRoutes(routes, '/configuracoes/usuarios');
    await screen.findByText('Bruno Lima');

    await userEvent.click(screen.getByRole('button', { name: 'Desativar Bruno Lima' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Desativar Bruno Lima?' });
    expect(calls).toHaveLength(0);

    await userEvent.click(within(confirm).getByRole('button', { name: 'Desativar' }));

    await waitFor(() => expect(calls).toContainEqual({ method: 'PATCH', path: '/users/u-2', body: { active: false } }));
    expect(await within(row('Bruno Lima')).findByText('Inativo')).toBeInTheDocument();
    expect(within(row('Bruno Lima')).getByRole('button', { name: 'Reativar Bruno Lima' })).toBeInTheDocument();
  });

  it('[FND-03.4] mostra o motivo quando a API recusa (LAST_ADMIN)', async () => {
    mockUsersApi([me]);
    server.use(
      http.patch(apiUrl('/users/:id'), () =>
        HttpResponse.json(
          { error: { code: 'LAST_ADMIN', message: 'Não é possível remover o último administrador ativo' } },
          { status: 409 },
        ),
      ),
    );
    renderRoutes(routes, '/configuracoes/usuarios');

    // "Ana Souza" também é o usuário logado no menu: espera a linha da tabela.
    await userEvent.click(await screen.findByRole('button', { name: 'Desativar Ana Souza' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Você vai perder o acesso');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Desativar' }));

    expect(await screen.findByText('Não é possível remover o último administrador ativo')).toBeInTheDocument();
    expect(within(row('Ana Souza')).getByText('Ativo')).toBeInTheDocument();
  });

  it('redefine a senha', async () => {
    const calls = mockUsersApi();
    renderRoutes(routes, '/configuracoes/usuarios');
    await screen.findByText('Bruno Lima');

    await userEvent.click(screen.getByRole('button', { name: 'Redefinir senha de Bruno Lima' }));
    const dialog = await screen.findByRole('dialog', { name: 'Redefinir senha' });
    await userEvent.type(within(dialog).getByLabelText('Nova senha'), 'nova-senha-123');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Redefinir senha' }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/users/u-2/reset-password',
        body: { newPassword: 'nova-senha-123' },
      }),
    );
    expect(await screen.findByText(/Senha de Bruno Lima redefinida/)).toBeInTheDocument();
  });

  it('erro ao carregar mostra "Tentar de novo"', async () => {
    let fail = true;
    server.use(
      http.get(apiUrl('/users'), () =>
        fail ? HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno. Tente novamente.' } }, { status: 500 })
             : HttpResponse.json(page([me])),
      ),
    );
    renderRoutes(routes, '/configuracoes/usuarios');

    expect(await screen.findByText('Erro interno. Tente novamente.')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('row', { name: /Ana Souza/ })).toBeInTheDocument();
  });
});
