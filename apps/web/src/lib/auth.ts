import { useSyncExternalStore } from 'react';
import type { AuthUser, LoginResponse } from '@financeiro/shared';
import { parse, send } from './http';

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

export interface SessionState {
  status: SessionStatus;
  user: AuthUser | null;
  /** true quando a sessão caiu sozinha (refresh falhou), para a tela de login avisar. */
  expired: boolean;
}

let state: SessionState = { status: 'loading', user: null, expired: false };
// Access token só em memória (design da spec 00): nunca em localStorage.
let accessToken: string | null = null;
const listeners = new Set<() => void>();

function setState(next: SessionState) {
  state = next;
  listeners.forEach((listener) => listener());
}

function authenticate({ accessToken: token, user }: LoginResponse) {
  accessToken = token;
  setState({ status: 'authenticated', user, expired: false });
}

function clear(expired: boolean) {
  accessToken = null;
  setState({ status: 'anonymous', user: null, expired });
}

export const session = {
  getState: () => state,
  getAccessToken: () => accessToken,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useSession(): SessionState {
  return useSyncExternalStore(session.subscribe, session.getState);
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await send('/auth/login', { method: 'POST', body: { email, password } }, null);
  const data = await parse<LoginResponse>(res);
  authenticate(data);
  return data.user;
}

export async function logout(): Promise<void> {
  try {
    await send('/auth/logout', { method: 'POST' }, null);
  } finally {
    clear(false);
  }
}

/** Chamado quando a API recusa o token e o refresh não salvou: volta ao login. */
export function expireSession() {
  if (state.status === 'authenticated') clear(true);
}

let inflight: Promise<boolean> | null = null;

/**
 * Renova o access token pelo cookie. Chamadas simultâneas compartilham a mesma promessa, e entre
 * abas a renovação é serializada (Web Locks): a API revoga tudo se o mesmo refresh for usado duas vezes.
 */
export function refreshSession(): Promise<boolean> {
  inflight ??= withCrossTabLock(doRefresh).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function doRefresh(): Promise<boolean> {
  try {
    const res = await send('/auth/refresh', { method: 'POST' }, null);
    authenticate(await parse<LoginResponse>(res));
    return true;
  } catch {
    clear(state.status === 'authenticated');
    return false;
  }
}

function withCrossTabLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? (locks.request('financeiro-auth-refresh', fn) as Promise<T>) : fn();
}

/** Ao abrir o app, recupera a sessão a partir do cookie de refresh. */
export function bootstrapSession(): Promise<boolean> {
  if (state.status !== 'loading') return Promise.resolve(state.status === 'authenticated');
  return refreshSession();
}

/** Só para testes. */
export function resetSessionForTests(next: Partial<SessionState> & { token?: string } = {}) {
  inflight = null;
  accessToken = next.token ?? null;
  state = {
    status: next.status ?? 'loading',
    user: next.user ?? null,
    expired: next.expired ?? false,
  };
  listeners.forEach((listener) => listener());
}
