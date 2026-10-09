import { useSearchParams } from 'react-router';
import { can } from '@financeiro/shared';
import { PageHeader } from '@/components/page-header';
import { ErrorState, TableSkeleton } from '@/components/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSession } from '@/lib/auth';
import { useSettings } from './api';
import { GeneralSettingsForm } from './GeneralSettingsForm';
import { IntegrationsPanel } from './IntegrationsPanel';
import { CategoriesPanel } from '../expenses/CategoriesPanel';
import { MessagesPanel } from '../reminders/MessagesPanel';
import { ReminderSettingsPanel } from '../reminders/ReminderSettingsPanel';

const TABS = ['geral', 'integracoes', 'categorias', 'regua', 'mensagens'] as const;
const ADMIN_TABS: Tab[] = ['integracoes', 'categorias', 'regua', 'mensagens'];
type Tab = (typeof TABS)[number];

export function SettingsPage() {
  const { user } = useSession();
  const isAdmin = can(user?.role, 'ADMINISTER');
  const settings = useSettings();
  const [params, setParams] = useSearchParams();

  const requested = params.get('aba') as Tab | null;
  const tab: Tab =
    requested && TABS.includes(requested) && (!ADMIN_TABS.includes(requested) || isAdmin) ? requested : 'geral';

  return (
    <>
      <PageHeader title="Configurações" description="Padrões financeiros, dados da empresa, integrações e régua de cobrança." />

      <Tabs value={tab} onValueChange={(value) => setParams(value === 'geral' ? {} : { aba: value }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="geral">Geral</TabsTrigger>
          {isAdmin && <TabsTrigger value="integracoes">Integrações</TabsTrigger>}
          {isAdmin && <TabsTrigger value="categorias">Categorias de despesa</TabsTrigger>}
          {isAdmin && <TabsTrigger value="regua">Régua</TabsTrigger>}
          {isAdmin && <TabsTrigger value="mensagens">Mensagens</TabsTrigger>}
        </TabsList>

        <TabsContent value="geral" className="mt-4">
          {settings.isPending ? (
            <TableSkeleton rows={8} />
          ) : settings.isError ? (
            <ErrorState error={settings.error} onRetry={() => settings.refetch()} />
          ) : (
            <GeneralSettingsForm settings={settings.data} canEdit={isAdmin} />
          )}
        </TabsContent>

        {isAdmin && (
          <TabsContent value="integracoes" className="mt-4">
            <IntegrationsPanel />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="categorias" className="mt-4">
            <CategoriesPanel />
          </TabsContent>
        )}

        {isAdmin && settings.data && (
          <TabsContent value="regua" className="mt-4">
            <ReminderSettingsPanel settings={settings.data} />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="mensagens" className="mt-4">
            <MessagesPanel />
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}
