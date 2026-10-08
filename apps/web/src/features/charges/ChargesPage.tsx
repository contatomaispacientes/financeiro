import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Plus, Search } from 'lucide-react';
import { can, type BillingType, type ChargeStatus, type ChargeType } from '@financeiro/shared';
import { DatePicker } from '@/components/date-picker';
import { PageHeader } from '@/components/page-header';
import { PaginationBar } from '@/components/pagination-bar';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSession } from '@/lib/auth';
import { formatBRL, formatDate } from '@/lib/format';
import { CHARGES_PAGE_SIZE, useCharges } from './api';
import { billingTypeLabels, chargeKindLabel } from './labels';

/** Chips agrupam status parecidos (pago + confirmado, estornado + parcial). */
const STATUS_CHIPS: Array<{ key: string; label: string; statuses: ChargeStatus[] }> = [
  { key: 'pendentes', label: 'Pendentes', statuses: ['PENDING'] },
  { key: 'vencidas', label: 'Vencidas', statuses: ['OVERDUE'] },
  { key: 'pagas', label: 'Pagas', statuses: ['PAID', 'CONFIRMED'] },
  { key: 'estornadas', label: 'Estornadas', statuses: ['REFUNDED', 'PARTIALLY_REFUNDED', 'CHARGEBACK'] },
  { key: 'canceladas', label: 'Canceladas', statuses: ['CANCELED'] },
  { key: 'rascunhos', label: 'Rascunhos', statuses: ['DRAFT'] },
];
const ALL = 'todos';
const typeLabels: Record<ChargeType, string> = { SINGLE: 'Avulsa', INSTALLMENT: 'Parcelada', RECURRING: 'Recorrente' };

/** COB-06: lista com filtros na URL, contagem por status e soma do filtro. */
export function ChargesPage() {
  const navigate = useNavigate();
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const chip = STATUS_CHIPS.find((c) => c.key === params.get('situacao'));
  const search = params.get('busca') ?? '';
  const page = Math.max(1, Number(params.get('pagina')) || 1);
  const [term, setTerm] = useState(search);
  const charges = useCharges({
    status: chip?.statuses,
    type: (params.get('tipo') as ChargeType | null) ?? undefined,
    billingType: (params.get('forma') as BillingType | null) ?? undefined,
    dueFrom: params.get('de') ?? undefined,
    dueTo: params.get('ate') ?? undefined,
    search: search || undefined,
    page,
  });

  function setParam(key: string, value: string | null | undefined) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'pagina') next.delete('pagina');
    setParams(next, { replace: true });
  }

  useEffect(() => {
    const id = setTimeout(() => term.trim() !== search && setParam('busca', term.trim()), 300);
    return () => clearTimeout(id);
  });

  const counts = charges.data?.summary.countByStatus;
  const total = counts ? Object.values(counts).reduce((s, n) => s + (n ?? 0), 0) : undefined;

  return (
    <>
      <PageHeader
        title="Cobranças"
        description="Tudo o que foi cobrado no Asaas, com o status atualizado sozinho."
        actions={
          can(user?.role, 'MANAGE_CHARGES') && (
            <Button asChild>
              <Link to="/cobrancas/nova">
                <Plus aria-hidden />
                Nova cobrança
              </Link>
            </Button>
          )
        }
      />

      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Situação">
        <Button size="sm" variant={chip ? 'outline' : 'default'} aria-pressed={!chip} onClick={() => setParam('situacao', null)}>
          Todas
          {total !== undefined && <span className="tabular opacity-70">{total}</span>}
        </Button>
        {STATUS_CHIPS.map((c) => {
          const count = counts ? c.statuses.reduce((s, st) => s + (counts[st] ?? 0), 0) : undefined;
          const active = chip?.key === c.key;
          if (c.key === 'rascunhos' && !count && !active) return null;
          return (
            <Button key={c.key} size="sm" variant={active ? 'default' : 'outline'} aria-pressed={active} onClick={() => setParam('situacao', c.key)}>
              {c.label}
              {count !== undefined && <span className="tabular opacity-70">{count}</span>}
            </Button>
          );
        })}
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_10rem_10rem_9.5rem_9.5rem]">
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Cliente, serviço ou pay_…" aria-label="Buscar cobranças" className="pl-9" />
        </div>
        <Select value={params.get('tipo') ?? ALL} onValueChange={(v) => setParam('tipo', v === ALL ? null : v)}>
          <SelectTrigger aria-label="Tipo" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os tipos</SelectItem>
            {Object.entries(typeLabels).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={params.get('forma') ?? ALL} onValueChange={(v) => setParam('forma', v === ALL ? null : v)}>
          <SelectTrigger aria-label="Forma de pagamento" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as formas</SelectItem>
            {Object.entries(billingTypeLabels).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
        <DatePicker aria-label="Vencimento de" value={params.get('de')} onChange={(v) => setParam('de', v)} />
        <DatePicker aria-label="Vencimento até" value={params.get('ate')} onChange={(v) => setParam('ate', v)} />
      </div>

      {charges.isPending ? (
        <TableSkeleton />
      ) : charges.isError ? (
        <ErrorState error={charges.error} onRetry={() => charges.refetch()} />
      ) : charges.data.data.length === 0 ? (
        <EmptyState
          title="Nenhuma cobrança encontrada"
          description={params.size ? 'Ajuste os filtros para ver mais resultados.' : 'As cobranças geradas aparecem aqui.'}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Serviços</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Forma</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {charges.data.data.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => navigate(`/cobrancas/${c.id}`)}>
                    <TableCell>
                      <Link to={`/cobrancas/${c.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                        {c.customer.name}
                      </Link>
                      {c.asaasPaymentId && <p className="tabular text-xs text-muted-foreground">{c.asaasPaymentId}</p>}
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-sm" title={c.description}>{c.description}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{chargeKindLabel(c)}</TableCell>
                    <TableCell className="text-sm">{billingTypeLabels[c.billingType]}</TableCell>
                    <TableCell className="tabular text-sm">{formatDate(c.dueDate)}</TableCell>
                    <TableCell className="tabular text-right">{formatBRL(c.valueCents)}</TableCell>
                    <TableCell>
                      <StatusBadge kind="charge" status={c.status} />
                      {c.refundRequestedAt && (c.status === 'PAID' || c.status === 'CONFIRMED') && (
                        <p className="mt-0.5 text-xs text-violet-800">Estorno solicitado</p>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={5} className="text-sm text-muted-foreground">
                    {charges.data.meta.total} {charges.data.meta.total === 1 ? 'cobrança' : 'cobranças'} no filtro
                  </TableCell>
                  <TableCell className="tabular text-right font-medium">{formatBRL(charges.data.summary.totalCents)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
          <PaginationBar
            page={page}
            pageSize={CHARGES_PAGE_SIZE}
            total={charges.data.meta.total}
            onPageChange={(p) => setParam('pagina', p > 1 ? String(p) : null)}
          />
        </>
      )}
    </>
  );
}
