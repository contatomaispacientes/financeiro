import { useSearchParams } from 'react-router';
import { can } from '@financeiro/shared';
import { PageHeader } from '@/components/page-header';
import { ErrorState, TableSkeleton } from '@/components/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSession } from '@/lib/auth';
import { useSettings } from './api';
import { GeneralSettingsForm } from './GeneralSettingsForm';
import { IntegrationsPanel } from './IntegrationsPanel';

const TABS = ['geral', 'integracoes', 'regua'] as const;
type Tab = (typeof TABS)[number];

export function SettingsPage() {
  const { user } = useSession();
  const isAdmin = can(user?.role, 'ADMINISTER');
  const settings = useSettings();
  const [params, setParams] = useSearchParams();

  const requested = params.get('aba') as Tab | null;
  const tab: Tab =
    requested && TABS.includes(requested) && (requested !== 'integracoes' || isAdmin) ? requested : 'geral';

  return (
    <>
      <PageHeader title="Configurações" description="Padrões financeiros, dados da empresa e integrações." />

      <Tabs value={tab} onValueChange={(value) => setParams(value === 'geral' ? {} : { aba: value }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="geral">Geral</TabsTrigger>
          {isAdmin && <TabsTrigger value="integracoes">Integrações</TabsTrigger>}
          <TabsTrigger value="regua">Régua</TabsTrigger>
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

        <TabsContent value="regua" className="mt-4">
          <div className="rounded-lg border border-dashed bg-card px-6 py-12 text-center">
            <p className="font-medium">Régua de cobrança</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Dias de lembrete antes e depois do vencimento, canais e mensagens chegam com a spec 08.
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}
