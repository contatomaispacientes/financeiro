import type { RouteObject } from 'react-router';
import { RequireAuth, RequireRole } from '@/components/guards';
import { AppLayout } from '@/layouts/AppLayout';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { PlaceholderPage } from '@/pages/PlaceholderPage';

export const routes: RouteObject[] = [
  { path: '/login', element: <PlaceholderPage title="Entrar" spec="00 (tarefa 10)" /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <PlaceholderPage title="Visão geral" spec="06" /> },
          { path: 'fluxo', element: <PlaceholderPage title="Fluxo de caixa" spec="06" /> },
          {
            path: 'cobrancas/nova',
            element: (
              <RequireRole permission="MANAGE_CHARGES">
                <PlaceholderPage title="Nova cobrança" spec="03" />
              </RequireRole>
            ),
          },
          { path: 'cobrancas', element: <PlaceholderPage title="Cobranças" spec="03" /> },
          { path: 'assinaturas', element: <PlaceholderPage title="Recorrências" spec="03" /> },
          { path: 'contratos', element: <PlaceholderPage title="Contratos" spec="07" /> },
          { path: 'clientes', element: <PlaceholderPage title="Clientes" spec="01" /> },
          { path: 'servicos', element: <PlaceholderPage title="Serviços" spec="02" /> },
          { path: 'despesas', element: <PlaceholderPage title="Contas a pagar" spec="05" /> },
          { path: 'configuracoes', element: <PlaceholderPage title="Configurações" spec="00 (tarefa 10)" /> },
          {
            path: 'configuracoes',
            element: <RequireRole permission="ADMINISTER" />,
            children: [
              { path: 'usuarios', element: <PlaceholderPage title="Usuários" spec="00 (tarefa 10)" /> },
              { path: 'webhooks', element: <PlaceholderPage title="Log de eventos" spec="04" /> },
              { path: 'auditoria', element: <PlaceholderPage title="Auditoria" spec="00 (tarefa 10)" /> },
            ],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
