export const API_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type QueryValue = string | number | boolean | null | undefined;
/** Lista vira a chave repetida (`?status=PAID&status=CONFIRMED`). */
export type Query = Record<string, QueryValue | readonly string[]>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
}

export function buildUrl(path: string, query?: Query): string {
  const url = new URL(API_BASE + path, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, item);
    else if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export function send(path: string, options: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  return fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'include',
    signal: options.signal,
  });
}

/** Converte a resposta em dados ou em ApiError com o `{ error: { code, message } }` da API. */
export async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const body: unknown = text ? safeJson(text) : undefined;

  if (res.ok) return body as T;

  const error = (body as { error?: { code?: string; message?: string; details?: unknown } } | undefined)
    ?.error;
  throw new ApiError(
    res.status,
    error?.code ?? `HTTP_${res.status}`,
    error?.message ?? 'Não foi possível concluir a operação. Tente novamente.',
    error?.details,
  );
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
