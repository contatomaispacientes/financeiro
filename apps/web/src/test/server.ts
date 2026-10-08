import { setupServer } from 'msw/node';

/** Servidor MSW compartilhado: cada teste registra seus handlers com `server.use(...)`. */
export const server = setupServer();

export const apiUrl = (path: string) => `${window.location.origin}/api/v1${path}`;
