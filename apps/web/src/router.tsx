import type { RouteObject } from 'react-router';
import { RequireAuth, RequireRole } from '@/components/guards';
import { AppLayout } from '@/layouts/AppLayout';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { PlaceholderPage } from '@/pages/PlaceholderPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { UsersPage } from '@/features/users/UsersPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { AuditPage } from '@/features/audit/AuditPage';
import { CustomersPage } from '@/features/customers/CustomersPage';
import { CustomerDetailPage } from '@/features/customers/CustomerDetailPage';
import { ServicesPage } from '@/features/services/ServicesPage';
import { NewChargePage } from '@/features/charges/NewChargePage';
import { ChargeDetailPage } from '@/features/charges/ChargeDetailPage';
import { ExpensesPage } from '@/features/expenses/ExpensesPage';
import { DashboardPage } from '@/features/reports/DashboardPage';
import { CashflowPage } from '@/features/reports/CashflowPage';
import { WebhookEventsPage } from '@/features/webhooks/WebhookEventsPage';

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'fluxo', element: <CashflowPage /> },
          {
            path: 'cobrancas/nova',
            element: (
              <RequireRole permission="MANAGE_CHARGES">
                <NewChargePage />
              </RequireRole>
            ),
          },
          { path: 'cobrancas/:id', element: <ChargeDetailPage /> },
          { path: 'cobrancas', element: <PlaceholderPage title="Cobranças" spec="03" /> },
          { path: 'assinaturas', element: <PlaceholderPage title="Recorrências" spec="03" /> },
          { path: 'contratos', element: <PlaceholderPage title="Contratos" spec="07" /> },
          { path: 'clientes', element: <CustomersPage /> },
          { path: 'clientes/:id', element: <CustomerDetailPage /> },
          { path: 'servicos', element: <ServicesPage /> },
          { path: 'despesas', element: <ExpensesPage /> },
          { path: 'configuracoes', element: <SettingsPage /> },
          {
            path: 'configuracoes',
            element: <RequireRole permission="ADMINISTER" />,
            children: [
              { path: 'usuarios', element: <UsersPage /> },
              { path: 'webhooks', element: <WebhookEventsPage /> },
              { path: 'auditoria', element: <AuditPage /> },
            ],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
