import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './http';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Erro 4xx não melhora repetindo; 5xx e falha de rede tentam mais uma vez.
        retry: (failures, error) =>
          !(error instanceof ApiError && error.status < 500) && failures < 1,
      },
      mutations: { retry: false },
    },
  });
}
