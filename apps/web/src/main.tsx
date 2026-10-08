import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import { bootstrapSession, session } from '@/lib/auth';
import { createQueryClient } from '@/lib/query';
import { routes } from '@/router';
import './index.css';

const queryClient = createQueryClient();
const router = createBrowserRouter(routes);

// Dados de um usuário não podem sobrar no cache quando a sessão acaba.
session.subscribe(() => {
  if (session.getState().status === 'anonymous') queryClient.clear();
});

void bootstrapSession();

const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root não encontrado');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
);
