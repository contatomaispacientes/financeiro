import { http, HttpResponse } from 'msw';
import { apiUrl, server } from '@/test/server';
import { fakeUser } from '@/test/render';
import { api, ApiError } from '../api';
import { bootstrapSession, resetSessionForTests, session } from '../auth';

const user = fakeUser('FINANCEIRO');

function bearer(request: Request) {
  return request.headers.get('authorization');
}

describe('api()', () => {
  beforeEach(() => {
    resetSessionForTests({ status: 'authenticated', user, token: 'old-token' });
  });

  it('envia o access token em memória como Bearer', async () => {
    server.use(
      http.get(apiUrl('/ping'), ({ request }) => HttpResponse.json({ auth: bearer(request) })),
    );
    await expect(api('/ping')).resolves.toEqual({ auth: 'Bearer old-token' });
  });

  it('[FND-06.2] token expirado: renova pelo refresh e repete a chamada de forma transparente', async () => {
    let refreshCalls = 0;
    server.use(
      http.get(apiUrl('/clientes'), ({ request }) =>
        bearer(request) === 'Bearer new-token'
          ? HttpResponse.json({ data: ['ok'] })
          : HttpResponse.json({ error: { code: 'UNAUTHORIZED', message: 'x' } }, { status: 401 }),
      ),
      http.post(apiUrl('/auth/refresh'), () => {
        refreshCalls += 1;
        return HttpResponse.json({ accessToken: 'new-token', user });
      }),
    );

    await expect(api('/clientes')).resolves.toEqual({ data: ['ok'] });
    expect(refreshCalls).toBe(1);
    expect(session.getAccessToken()).toBe('new-token');
    expect(session.getState().status).toBe('authenticated');
  });

  it('[FND-06.2] várias chamadas com token vencido disparam um único refresh', async () => {
    let refreshCalls = 0;
    server.use(
      http.get(apiUrl('/a'), ({ request }) =>
        bearer(request) === 'Bearer new-token'
          ? HttpResponse.json('a')
          : new HttpResponse(null, { status: 401 }),
      ),
      http.post(apiUrl('/auth/refresh'), async () => {
        refreshCalls += 1;
        await new Promise((r) => setTimeout(r, 20));
        return HttpResponse.json({ accessToken: 'new-token', user });
      }),
    );

    await Promise.all([api('/a'), api('/a'), api('/a')]);
    expect(refreshCalls).toBe(1);
  });

  it('[FND-06.2] refresh recusado encerra a sessão marcando-a como expirada', async () => {
    server.use(
      http.get(apiUrl('/clientes'), () => new HttpResponse(null, { status: 401 })),
      http.post(apiUrl('/auth/refresh'), () =>
        HttpResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sessão expirada' } }, { status: 401 }),
      ),
    );

    await expect(api('/clientes')).rejects.toBeInstanceOf(ApiError);
    expect(session.getState()).toMatchObject({ status: 'anonymous', user: null, expired: true });
    expect(session.getAccessToken()).toBeNull();
  });

  it('converte { error } da API em ApiError com código e mensagem', async () => {
    server.use(
      http.patch(apiUrl('/users/1'), () =>
        HttpResponse.json(
          { error: { code: 'LAST_ADMIN', message: 'Não é possível remover o último administrador ativo' } },
          { status: 409 },
        ),
      ),
    );

    const error = await api('/users/1', { method: 'PATCH', body: { active: false } }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'LAST_ADMIN',
      message: 'Não é possível remover o último administrador ativo',
    });
  });

  it('204 resolve sem corpo; query string ignora valores vazios', async () => {
    let url = '';
    server.use(
      http.post(apiUrl('/auth/logout'), () => new HttpResponse(null, { status: 204 })),
      http.get(apiUrl('/audit-logs'), ({ request }) => {
        url = request.url;
        return HttpResponse.json([]);
      }),
    );

    await expect(api('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
    await api('/audit-logs', { query: { entity: 'user', userId: undefined, from: '' } });
    expect(new URL(url).search).toBe('?entity=user');
  });
});

describe('bootstrapSession()', () => {
  it('restaura a sessão pelo cookie ao abrir o app', async () => {
    resetSessionForTests({ status: 'loading' });
    server.use(http.post(apiUrl('/auth/refresh'), () => HttpResponse.json({ accessToken: 't', user })));

    await expect(bootstrapSession()).resolves.toBe(true);
    expect(session.getState()).toMatchObject({ status: 'authenticated', user });
  });

  it('sem cookie válido fica anônimo, sem marcar como expirada', async () => {
    resetSessionForTests({ status: 'loading' });
    server.use(http.post(apiUrl('/auth/refresh'), () => new HttpResponse(null, { status: 401 })));

    await expect(bootstrapSession()).resolves.toBe(false);
    expect(session.getState()).toMatchObject({ status: 'anonymous', expired: false });
  });

  it('chamada dupla (StrictMode) faz um único refresh', async () => {
    resetSessionForTests({ status: 'loading' });
    let calls = 0;
    server.use(
      http.post(apiUrl('/auth/refresh'), () => {
        calls += 1;
        return HttpResponse.json({ accessToken: 't', user });
      }),
    );

    await Promise.all([bootstrapSession(), bootstrapSession()]);
    expect(calls).toBe(1);
  });
});
