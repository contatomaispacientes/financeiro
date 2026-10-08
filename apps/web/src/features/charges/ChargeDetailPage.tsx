import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, CircleAlert, LoaderCircle } from 'lucide-react';
import { can, type ChargeDetailDto } from '@financeiro/shared';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/form-errors';
import { formatBRL, formatDate, formatDateTime } from '@/lib/format';
import { ApiError } from '@/lib/http';
import { displayDocument } from '@/features/customers/CustomersPage';
import { useCharge, useChargeAction } from './api';
import { billingTypeLabels, chargeTypeLabel, eventLabel, eventNote, originLabels } from './labels';
import { MockSimulator } from './MockSimulator';
import { PaymentData } from './PaymentData';

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 py-2 sm:grid-cols-[9rem_1fr] sm:gap-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </div>
  );
}

function Card({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <h2 className="mb-2 text-sm font-medium">{title}</h2>
      <div className="rounded-lg border bg-card px-4 py-3">{children}</div>
    </section>
  );
}

const missing = <span className="text-muted-foreground">—</span>;

/** Detalhe da cobrança (COB-07.1) com a timeline de eventos do Asaas (WHK-03.4). */
export function ChargeDetailPage() {
  const { id = '' } = useParams();
  const { user } = useSession();
  const canManage = can(user?.role, 'MANAGE_CHARGES');
  const charge = useCharge(id);
  const action = useChargeAction();

  if (charge.isPending) return <TableSkeleton rows={8} />;
  if (charge.isError) {
    if (charge.error instanceof ApiError && charge.error.status === 404) {
      return (
        <EmptyState
          title="Cobrança não encontrada"
          description="Ela pode ter sido removida ou o endereço está errado."
          action={
            <Button asChild variant="outline">
              <Link to="/cobrancas">Voltar para cobranças</Link>
            </Button>
          }
        />
      );
    }
    return <ErrorState error={charge.error} onRetry={() => charge.refetch()} />;
  }

  const c: ChargeDetailDto = charge.data;

  async function run(kind: 'retry' | 'discard') {
    try {
      const result = await action.mutateAsync({ id: c.id, action: kind });
      if (kind === 'discard') toast.success('Rascunho descartado.');
      else if (result.status === 'DRAFT') toast.error(result.lastError ?? 'O Asaas ainda não aceitou a cobrança.');
      else toast.success('Cobrança gerada no Asaas.');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <>
      <Link to="/cobrancas" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4" />
        Cobranças
      </Link>

      <header className="mb-6 flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="tabular text-2xl font-semibold tracking-tight">{formatBRL(c.valueCents)}</h1>
          <StatusBadge kind="charge" status={c.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          <Link to={`/clientes/${c.customer.id}`} className="font-medium text-foreground hover:underline">
            {c.customer.name}
          </Link>{' '}
          · {chargeTypeLabel(c)} · vence em <span className="tabular">{formatDate(c.dueDate)}</span>
        </p>
      </header>

      {c.status === 'DRAFT' && (
        <div role="alert" className="mb-6 flex flex-col gap-3 rounded-md bg-destructive/10 px-4 py-3 text-sm sm:flex-row sm:items-center">
          <CircleAlert aria-hidden className="size-4 shrink-0 text-destructive" />
          <div className="flex-1">
            <p className="font-medium text-destructive">Rascunho: a cobrança ainda não existe no Asaas.</p>
            {c.lastError && <p className="text-destructive">{c.lastError}</p>}
          </div>
          {canManage && (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => run('retry')} disabled={action.isPending}>
                {action.isPending && action.variables?.action === 'retry' && <LoaderCircle aria-hidden className="animate-spin" />}
                Tentar de novo
              </Button>
              <Button size="sm" variant="outline" onClick={() => run('discard')} disabled={action.isPending}>
                Descartar
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          <Card title="Dados da cobrança">
            <dl className="divide-y">
              <Item label="Cliente">
                <Link to={`/clientes/${c.customer.id}`} className="font-medium hover:underline">
                  {c.customer.name}
                </Link>
                <span className="tabular block text-xs text-muted-foreground">{displayDocument(c.customer.document)}</span>
              </Item>
              <Item label="Tipo">
                {chargeTypeLabel(c)} · origem {originLabels[c.origin].toLowerCase()}
              </Item>
              <Item label="Forma de pagamento">{billingTypeLabels[c.billingType]}</Item>
              <Item label="Vencimento">
                <span className="tabular">{formatDate(c.dueDate)}</span>
              </Item>
              <Item label="Pago em">{c.paidAt ? <span className="tabular">{formatDate(c.paidAt)}</span> : missing}</Item>
              {c.netValueCents !== null && (
                <Item label="Valor líquido">
                  <span className="tabular">{formatBRL(c.netValueCents)}</span>
                </Item>
              )}
              {c.refundedCents > 0 && (
                <Item label="Estornado">
                  <span className="tabular">{formatBRL(c.refundedCents)}</span>
                </Item>
              )}
              <Item label="Multa e juros">
                <span className="tabular">
                  {c.finePct.toLocaleString('pt-BR')}% · {c.interestPct.toLocaleString('pt-BR')}% ao mês
                </span>
              </Item>
              <Item label="ID Asaas">{c.asaasPaymentId ? <span className="tabular">{c.asaasPaymentId}</span> : missing}</Item>
            </dl>
          </Card>

          <Card title="Itens">
            <div className="-mx-4 -my-3 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Descrição</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                    <TableHead className="text-right">Preço unit.</TableHead>
                    <TableHead className="pr-4 text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {c.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="pl-4 whitespace-normal">{item.description}</TableCell>
                      <TableCell className="tabular text-right">{item.quantity}</TableCell>
                      <TableCell className="tabular text-right">{formatBRL(item.unitPriceCents)}</TableCell>
                      <TableCell className="tabular pr-4 text-right">{formatBRL(item.totalCents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {c.discountCents > 0 && (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={3} className="pl-4 text-right text-muted-foreground">
                        Desconto
                      </TableCell>
                      <TableCell className="tabular pr-4 text-right">− {formatBRL(c.discountCents)}</TableCell>
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </div>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          {canManage && <MockSimulator charge={c} />}
          <Card title="Dados para pagamento">
            <PaymentData charge={c} />
          </Card>

          <section aria-labelledby="charge-events">
            <h2 id="charge-events" className="mb-2 text-sm font-medium">
              Eventos do Asaas
            </h2>
            {c.events.length === 0 ? (
              <p className="rounded-lg border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
                Nenhum evento recebido ainda. Pagamentos e mudanças feitas no Asaas aparecem aqui.
              </p>
            ) : (
              <ol className="rounded-lg border bg-card px-4 py-3">
                {c.events.map((e, i) => {
                  const note = eventNote(e);
                  return (
                    <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
                      {i < c.events.length - 1 && <span aria-hidden className="absolute top-4 bottom-0 left-[0.3125rem] w-px bg-border" />}
                      <span
                        aria-hidden
                        className={`relative mt-1.5 size-2.5 shrink-0 rounded-full ring-2 ring-card ${note ? 'bg-zinc-300' : 'bg-primary'}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{eventLabel(e.event)}</p>
                        <p className="text-xs text-muted-foreground">
                          <time dateTime={e.receivedAt} className="tabular">
                            {formatDateTime(e.receivedAt)}
                          </time>{' '}
                          · <span className="tabular">{e.event}</span>
                        </p>
                        {note && <p className="text-xs text-muted-foreground italic">{note}</p>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
