import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { http, HttpResponse } from 'msw';
import type { AuthUser, Role } from '@financeiro/shared';
import { Toaster } from '@/components/ui/sonner';
import { resetSessionForTests } from '@/lib/auth';
import { apiUrl, server } from './server';

export function fakeUser(role: Role = 'ADMIN'): AuthUser {
  return { id: 'u-1', name: 'Ana Souza', email: 'ana@empresa.com.br', role };
}

/** Sessão autenticada com o papel pedido; `null` = anônimo. */
export function signIn(role: Role | null) {
  if (role === null) resetSessionForTests({ status: 'anonymous' });
  else resetSessionForTests({ status: 'authenticated', user: fakeUser(role), token: 'token-1' });
}

/** Selo do ambiente: o layout sempre consulta. */
export function mockEnvironment(asaasEnv: 'sandbox' | 'production' = 'sandbox') {
  server.use(http.get(apiUrl('/settings/environment'), () => HttpResponse.json({ asaasEnv })));
}

export function renderRoutes(routes: RouteObject[], initialPath = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>,
  );
  return { ...utils, router, queryClient };
}
