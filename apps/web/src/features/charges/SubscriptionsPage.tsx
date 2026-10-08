import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, CircleAlert, LoaderCircle } from 'lucide-react';
import { can, type SubscriptionStatus } from '@financeiro/shared';
import { PageHeader } from '@/components/page-header';
import { PaginationBar } from '@/components/pagination-bar';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/form-errors';
import { formatBRL, formatDate } from '@/lib/format';
import { CHARGES_PAGE_SIZE, useSubscription, useSubscriptionAction, useSubscriptions } from './api';
import { billingTypeLabels, cycleLabels } from './labels';

const STATUS_CHIPS: Array<{ value: SubscriptionStatus | undefined; label: string }> = [
  { value: undefined, label: 'Todas' },
  { value: 'ACTIVE', label: 'Ativas' },
  { value: 'CANCELED', label: 'Canceladas' },
  { value: 'INACTIVE', label: 'Não enviadas' },
];

/** COB-04.4: recorrências com cliente, valor, ciclo, próximo vencimento e status. */
export function SubscriptionsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = (params.get('situacao') as SubscriptionStatus | null) ?? undefined;
  const page = Math.max(1, Number(params.get('pagina')) || 1);
  const subscriptions = useSubscriptions({ status, page });

  function setParam(key: string, value: string | null | undefined) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'pagina') next.delete('pagina');
    setParams(next, { replace: true });
  }

  return (
    <>
      <PageHeader title="Recorrências" description="Cobranças que se repetem: o Asaas gera uma a cada ciclo e elas aparecem aqui sozinhas." />
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Situação">
        {STATUS_CHIPS.map((c) => (
          <Button key={c.label} size="sm" variant={status === c.value ? 'default' : 'outline'} aria-pressed={status === c.value} onClick={() => setParam('situacao', c.value)}>
            {c.label}
          </Button>
        ))}
      </div>

      {subscriptions.isPending ? (
        <TableSkeleton />
      ) : subscriptions.isError ? (
        <ErrorState error={subscriptions.error} onRetry={() => subscriptions.refetch()} />
      ) : subscriptions.data.data.length === 0 ? (
        <EmptyState title="Nenhuma recorrência" description="Crie uma em Nova cobrança, escolhendo o tipo Recorrente." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Serviços</TableHead>
                  <TableHead>Ciclo</TableHead>
                  <TableHead>Próximo vencimento</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscriptions.data.data.map((s) => (
                  <TableRow key={s.id} className="cursor-pointer" onClick={() => navigate(`/assinaturas/${s.id}`)}>
                    <TableCell>
                      <Link to={`/assinaturas/${s.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                        {s.customer.name}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-sm" title={s.description}>{s.description}</TableCell>
                    <TableCell className="text-sm">{cycleLabels[s.cycle]}</TableCell>
                    <TableCell className="tabular text-sm">{s.status === 'ACTIVE' ? formatDate(s.nextDueDate) : '—'}</TableCell>
                    <TableCell className="tabular text-right">{formatBRL(s.valueCents)}</TableCell>
                    <TableCell><StatusBadge kind="subscription" status={s.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar page={page} pageSize={CHARGES_PAGE_SIZE} total={subscriptions.data.meta.total} onPageChange={(p) => setParam('pagina', p > 1 ? String(p) : null)} />
        </>
      )}
    </>
  );
}

/** Detalhe da recorrência com as cobranças geradas; "Cancelar recorrência" (COB-11). */
export function SubscriptionDetailPage() {
  const { id = '' } = useParams();
  const { user } = useSession();
  const subscription = useSubscription(id);
  const action = useSubscriptionAction();
  const [confirming, setConfirming] = useState(false);

  if (subscription.isPending) return <TableSkeleton rows={8} />;
  if (subscription.isError) return <ErrorState error={subscription.error} onRetry={() => subscription.refetch()} />;
  const s = subscription.data;
  const canCancel = can(user?.role, 'CANCEL_SUBSCRIPTION') && s.status !== 'CANCELED';

  async function run(kind: 'cancel' | 'retry') {
    try {
      const result = await action.mutateAsync({ id: s.id, action: kind });
      if (kind === 'cancel') toast.success('Recorrência cancelada.');
      else if (result.asaasSubscriptionId) toast.success('Recorrência criada no Asaas.');
      else toast.error(result.lastError ?? 'O Asaas ainda não aceitou a recorrência.');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <>
      <Link to="/assinaturas" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4" />
        Recorrências
      </Link>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="tabular text-2xl font-semibold tracking-tight">{formatBRL(s.valueCents)}</h1>
            <StatusBadge kind="subscription" status={s.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            <Link to={`/clientes/${s.customer.id}`} className="font-medium text-foreground hover:underline">{s.customer.name}</Link> ·{' '}
            {cycleLabels[s.cycle]} · {billingTypeLabels[s.billingType]}
            {s.endDate ? ` · até ${formatDate(s.endDate)}` : ' · sem data final'}
          </p>
        </div>
        {canCancel && (
          <Button variant="outline" onClick={() => setConfirming(true)} disabled={action.isPending}>
            Cancelar recorrência
          </Button>
        )}
      </header>

      {!s.asaasSubscriptionId && s.status !== 'CANCELED' && (
        <div role="alert" className="mb-6 flex flex-col gap-3 rounded-md bg-destructive/10 px-4 py-3 text-sm sm:flex-row sm:items-center">
          <CircleAlert aria-hidden className="size-4 shrink-0 text-destructive" />
          <div className="flex-1">
            <p className="font-medium text-destructive">A recorrência ainda não existe no Asaas.</p>
            {s.lastError && <p className="text-destructive">{s.lastError}</p>}
          </div>
          {can(user?.role, 'MANAGE_CHARGES') && (
            <Button size="sm" onClick={() => run('retry')} disabled={action.isPending}>
              {action.isPending && <LoaderCircle aria-hidden className="animate-spin" />}
              Tentar de novo
            </Button>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="sub-charges">
          <h2 id="sub-charges" className="mb-2 text-sm font-medium">Cobranças geradas</h2>
          {s.charges.length === 0 ? (
            <p className="rounded-lg border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
              Nenhuma ainda. O Asaas gera a cobrança de cada ciclo alguns dias antes do vencimento.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vencimento</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.charges.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="tabular"><Link to={`/cobrancas/${c.id}`} className="hover:underline">{formatDate(c.dueDate)}</Link></TableCell>
                      <TableCell className="tabular text-right">{formatBRL(c.valueCents)}</TableCell>
                      <TableCell><StatusBadge kind="charge" status={c.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
        <section aria-labelledby="sub-data" className="space-y-2">
          <h2 id="sub-data" className="text-sm font-medium">Dados</h2>
          <dl className="space-y-2 rounded-lg border bg-card px-4 py-3 text-sm">
            <div><dt className="text-muted-foreground">Próximo vencimento</dt><dd className="tabular">{s.status === 'ACTIVE' ? formatDate(s.nextDueDate) : '—'}</dd></div>
            <div><dt className="text-muted-foreground">Multa e juros</dt><dd className="tabular">{s.finePct.toLocaleString('pt-BR')}% · {s.interestPct.toLocaleString('pt-BR')}% ao mês</dd></div>
            <div><dt className="text-muted-foreground">Itens</dt><dd>{s.items.map((i) => `${i.description} (${i.quantity}x)`).join(' · ')}</dd></div>
            <div><dt className="text-muted-foreground">ID Asaas</dt><dd className="tabular">{s.asaasSubscriptionId ?? '—'}</dd></div>
          </dl>
        </section>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar a recorrência de {s.customer.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {formatBRL(s.valueCents)} {cycleLabels[s.cycle].toLowerCase()}. O Asaas para de gerar cobranças e remove as que estão em aberto. As já pagas continuam como estão.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void run('cancel'); }} disabled={action.isPending}>
              Cancelar recorrência
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
