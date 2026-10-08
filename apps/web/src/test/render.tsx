import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import type { AuthUser, Role } from '@financeiro/shared';
import { resetSessionForTests } from '@/lib/auth';

export function fakeUser(role: Role = 'ADMIN'): AuthUser {
  return { id: 'u-1', name: 'Ana Souza', email: 'ana@empresa.com.br', role };
}

/** Sessão autenticada com o papel pedido; `null` = anônimo. */
export function signIn(role: Role | null) {
  if (role === null) resetSessionForTests({ status: 'anonymous' });
  else resetSessionForTests({ status: 'authenticated', user: fakeUser(role), token: 'token-1' });
}

export function renderRoutes(routes: RouteObject[], initialPath = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...utils, router, queryClient };
}
