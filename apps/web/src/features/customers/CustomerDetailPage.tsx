import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, CircleAlert, FilePlus2, Pencil, Receipt, TriangleAlert } from 'lucide-react';
import {
  can,
  formatPhone,
  formatPostalCode,
  isAddressComplete,
  type CustomerChargeSummary,
  type CustomerDetailDto,
} from '@financeiro/shared';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/form-errors';
import { formatBRL, formatDate } from '@/lib/format';
import { ApiError } from '@/lib/http';
import { cn } from '@/lib/utils';
import { useCustomer, useCustomerAction } from './api';
import { CustomerFormSheet } from './CustomerFormSheet';
import { displayDocument } from './CustomersPage';

const cycleLabels: Record<string, string> = {
  WEEKLY: 'Semanal',
  BIWEEKLY: 'Quinzenal',
  MONTHLY: 'Mensal',
  BIMONTHLY: 'Bimestral',
  QUARTERLY: 'Trimestral',
  SEMIANNUALLY: 'Semestral',
  YEARLY: 'Anual',
};

function chargeKind(c: CustomerChargeSummary) {
  if (c.type === 'INSTALLMENT') return `Parcela ${c.installmentNumber}/${c.installmentCount}`;
  return c.type === 'RECURRING' ? 'Recorrente' : 'Avulsa';
}

function Total({ label, value, tone }: { label: string; value: string; tone?: 'in' | 'out' }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn('tabular mt-1 text-xl font-semibold', tone === 'in' && 'text-inflow', tone === 'out' && 'text-destructive')}>
        {value}
      </p>
    </div>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 py-2 sm:grid-cols-[9rem_1fr] sm:gap-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </div>
  );
}

const missing = <span className="text-muted-foreground">—</span>;

export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const { user } = useSession();
  const canEdit = can(user?.role, 'MANAGE_RECORDS');
  const customer = useCustomer(id);
  const action = useCustomerAction(id);
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  if (customer.isPending) return <TableSkeleton rows={8} />;
  if (customer.isError) {
    if (customer.error instanceof ApiError && customer.error.status === 404) {
      return (
        <EmptyState
          title="Cliente não encontrado"
          description="Ele pode ter sido removido ou o endereço está errado."
          action={<Button asChild variant="outline"><Link to="/clientes">Voltar para clientes</Link></Button>}
        />
      );
    }
    return <ErrorState error={customer.error} onRetry={() => customer.refetch()} />;
  }

  const c: CustomerDetailDto = customer.data;
  const archived = c.archivedAt !== null;

  async function run(kind: 'archive' | 'unarchive' | 'asaas-sync') {
    try {
      await action.mutateAsync(kind);
      toast.success(
        kind === 'archive' ? 'Cliente arquivado.' : kind === 'unarchive' ? 'Cliente reativado.' : 'Reenvio ao Asaas agendado.',
      );
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <>
      <Link to="/clientes" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4" />
        Clientes
      </Link>

      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">
            {c.name}
            {archived && <span className="ml-3 rounded-full bg-zinc-100 px-2.5 py-0.5 align-middle text-xs font-medium text-zinc-700">Arquivado</span>}
          </h1>
          <p className="tabular mt-1 text-sm text-muted-foreground">
            {c.personType === 'PJ' ? 'Pessoa jurídica' : 'Pessoa física'} · {displayDocument(c.document)} · cliente desde{' '}
            {formatDate(c.createdAt)}
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {!archived && (
              <>
                <Button asChild>
                  <Link to={`/cobrancas/nova?cliente=${c.id}`}>
                    <Receipt aria-hidden />
                    Nova cobrança
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to={`/contratos/novo?cliente=${c.id}`}>
                    <FilePlus2 aria-hidden />
                    Novo contrato
                  </Link>
                </Button>
              </>
            )}
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil aria-hidden />
              Editar
            </Button>
            {archived ? (
              <Button variant="ghost" onClick={() => run('unarchive')} disabled={action.isPending}>
                Desarquivar
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmArchive(true)}>
                Arquivar
              </Button>
            )}
          </div>
        )}
      </header>

      <div className="mb-6 space-y-3">
        {!isAddressComplete(c.address) && (
          <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200 ring-inset">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            Endereço de cobrança incompleto — obrigatório para enviar contrato.
          </p>
        )}
        {c.asaasSyncError && (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <CircleAlert aria-hidden className="size-4 shrink-0" />
            <span className="flex-1">Dados não sincronizados com o Asaas: {c.asaasSyncError}</span>
            {canEdit && (
              <Button size="sm" variant="outline" onClick={() => run('asaas-sync')} disabled={action.isPending}>
                Tentar de novo
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Total label="Pago" value={formatBRL(c.totals.paidCents)} tone="in" />
        <Total label="Em aberto" value={formatBRL(c.totals.openCents)} />
        <Total label="Vencido" value={formatBRL(c.totals.overdueCents)} tone={c.totals.overdueCents > 0 ? 'out' : undefined} />
        <Total label="Cobranças" value={String(c.totals.chargesCount)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <section className="h-fit rounded-lg border bg-card px-4 py-2">
          <h2 className="sr-only">Dados cadastrais</h2>
          <dl className="divide-y">
            <Item label="E-mail">{c.email ?? missing}</Item>
            <Item label="Celular">{c.phone ? <span className="tabular">{formatPhone(c.phone)}</span> : missing}</Item>
            <Item label="Endereço">
              {c.address ? (
                <>
                  {c.address.street}, {c.address.number}
                  {c.address.complement ? ` — ${c.address.complement}` : ''}
                  <br />
                  {c.address.district} · {c.address.city}/{c.address.state} · <span className="tabular">{formatPostalCode(c.address.postalCode)}</span>
                </>
              ) : (
                missing
              )}
            </Item>
            <Item label="ID Asaas">
              {c.asaasCustomerId ? <span className="tabular">{c.asaasCustomerId}</span> : <span className="text-muted-foreground">Criado na 1ª cobrança</span>}
            </Item>
            <Item label="Lembretes">{c.remindersEnabled ? 'Ativos' : 'Desligados para este cliente'}</Item>
            {c.notes && <Item label="Observações"><span className="whitespace-pre-line">{c.notes}</span></Item>}
          </dl>
        </section>

        <Tabs defaultValue="cobrancas" className="min-w-0">
          <TabsList>
            <TabsTrigger value="cobrancas">Cobranças</TabsTrigger>
            <TabsTrigger value="assinaturas">Recorrências ({c.subscriptions.length})</TabsTrigger>
            <TabsTrigger value="contratos">Contratos</TabsTrigger>
          </TabsList>

          <TabsContent value="cobrancas" className="mt-3">
            {c.recentCharges.length === 0 ? (
              <EmptyState title="Nenhuma cobrança ainda" description="As cobranças deste cliente aparecem aqui, das mais recentes para as mais antigas." />
            ) : (
              <div className="overflow-x-auto rounded-lg border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vencimento</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {c.recentCharges.map((ch) => (
                      <TableRow key={ch.id}>
                        <TableCell className="tabular">{formatDate(ch.dueDate)}</TableCell>
                        <TableCell>
                          <Link to={`/cobrancas/${ch.id}`} className="block max-w-xs truncate font-medium hover:underline">
                            {ch.description}
                          </Link>
                          <p className="text-xs text-muted-foreground">{chargeKind(ch)}</p>
                        </TableCell>
                        <TableCell className="tabular text-right">{formatBRL(ch.valueCents)}</TableCell>
                        <TableCell><StatusBadge kind="charge" status={ch.status} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="assinaturas" className="mt-3">
            {c.subscriptions.length === 0 ? (
              <EmptyState title="Nenhuma recorrência ativa" />
            ) : (
              <ul className="divide-y rounded-lg border bg-card">
                {c.subscriptions.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <span className="font-medium">{s.description}</span>
                    <span className="tabular text-muted-foreground">
                      {formatBRL(s.valueCents)} · {cycleLabels[s.cycle]} · próximo {formatDate(s.nextDueDate)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="contratos" className="mt-3">
            {c.contracts.length === 0 ? (
              <EmptyState title="Nenhum contrato" description="Contratos enviados para assinatura aparecem aqui." />
            ) : (
              <ul className="divide-y rounded-lg border bg-card">
                {c.contracts.map((ct) => (
                  <li key={ct.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <span className="font-medium">{ct.title}</span>
                    <span className="flex items-center gap-3">
                      <span className="tabular text-muted-foreground">{formatBRL(ct.totalCents)}</span>
                      <StatusBadge kind="contract" status={ct.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <CustomerFormSheet customer={c} open={editing} onOpenChange={setEditing} />

      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar {c.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              O cliente some da lista e da Nova cobrança, mas o histórico fica guardado. Dá para desarquivar depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => run('archive')}>Arquivar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
