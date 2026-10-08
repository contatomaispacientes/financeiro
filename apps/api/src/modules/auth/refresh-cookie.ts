import type { CookieOptions, Request, Response } from 'express';

export const REFRESH_COOKIE = 'refresh_token';
export const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const options: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/api/v1/auth',
};

export function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, { ...options, maxAge: REFRESH_TTL_MS });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, options);
}

export function readRefreshCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === REFRESH_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}
