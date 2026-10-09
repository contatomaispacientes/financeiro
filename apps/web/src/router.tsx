import type { RouteObject } from 'react-router';
import { RequireAuth, RequireRole } from '@/components/guards';
import { AppLayout } from '@/layouts/AppLayout';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { UsersPage } from '@/features/users/UsersPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { AuditPage } from '@/features/audit/AuditPage';
import { CustomersPage } from '@/features/customers/CustomersPage';
import { CustomerDetailPage } from '@/features/customers/CustomerDetailPage';
import { ServicesPage } from '@/features/services/ServicesPage';
import { NewChargePage } from '@/features/charges/NewChargePage';
import { ChargeDetailPage } from '@/features/charges/ChargeDetailPage';
import { ChargesPage } from '@/features/charges/ChargesPage';
import { ContractDetailPage } from '@/features/contracts/ContractDetailPage';
import { ContractsPage } from '@/features/contracts/ContractsPage';
import { NewContractPage } from '@/features/contracts/NewContractPage';
import { TemplatesPage } from '@/features/contracts/TemplatesPage';
import { SubscriptionDetailPage, SubscriptionsPage } from '@/features/charges/SubscriptionsPage';
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
          { path: 'cobrancas', element: <ChargesPage /> },
          { path: 'assinaturas', element: <SubscriptionsPage /> },
          { path: 'assinaturas/:id', element: <SubscriptionDetailPage /> },
          { path: 'contratos', element: <ContractsPage /> },
          { path: 'contratos/novo', element: <NewContractPage /> },
          { path: 'contratos/modelos', element: <TemplatesPage /> },
          { path: 'contratos/:id', element: <ContractDetailPage /> },
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
