import { expireSession, refreshSession, session } from './auth';
import { parse, send, type RequestOptions } from './http';

export { ApiError } from './http';

/**
 * Cliente da API autenticada. Em 401, renova a sessão uma vez e repete a chamada;
 * se não der, encerra a sessão e o RequireAuth leva ao login guardando a rota (FND-06.2).
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const tokenUsed = session.getAccessToken();
  let res = await send(path, options, tokenUsed);

  if (res.status === 401) {
    const current = session.getAccessToken();
    // Outra chamada já renovou enquanto esta estava no ar: basta repetir com o token novo.
    const renewed = current && current !== tokenUsed ? true : await refreshSession();
    if (renewed) res = await send(path, options, session.getAccessToken());
    if (!renewed || res.status === 401) expireSession();
  }

  return parse<T>(res);
}

export const get = <T>(path: string, query?: RequestOptions['query']) => api<T>(path, { query });
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
