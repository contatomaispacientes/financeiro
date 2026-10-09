import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { CircleAlert, FileText, Plus, Search } from 'lucide-react';
import { can, type ContractStatus } from '@financeiro/shared';
import { PageHeader } from '@/components/page-header';
import { PaginationBar } from '@/components/pagination-bar';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSession } from '@/lib/auth';
import { formatBRL, formatDate } from '@/lib/format';
import { CONTRACTS_PAGE_SIZE, useContracts } from './api';

const CHIPS: Array<{ value: ContractStatus | undefined; label: string }> = [
  { value: undefined, label: 'Todos' },
  { value: 'DRAFT', label: 'Rascunhos' },
  { value: 'SENT', label: 'Enviados' },
  { value: 'PARTIALLY_SIGNED', label: 'Assinando' },
  { value: 'SIGNED', label: 'Assinados' },
  { value: 'REFUSED', label: 'Recusados' },
  { value: 'CANCELED', label: 'Cancelados' },
  { value: 'EXPIRED', label: 'Expirados' },
];

/** CTR-07.1: lista com status e se a cobrança já foi gerada. */
export function ContractsPage() {
  const navigate = useNavigate();
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const status = (params.get('situacao') as ContractStatus | null) ?? undefined;
  const search = params.get('busca') ?? '';
  const page = Math.max(1, Number(params.get('pagina')) || 1);
  const [term, setTerm] = useState(search);
  const contracts = useContracts({ status, search: search || undefined, page });

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

  return (
    <>
      <PageHeader
        title="Contratos"
        description="Venda formalizada: quando todos assinam, a cobrança é gerada sozinha."
        actions={
          <>
            {can(user?.role, 'MANAGE_CONTRACT_TEMPLATES') && (
              <Button asChild variant="outline">
                <Link to="/contratos/modelos">
                  <FileText aria-hidden />
                  Modelos
                </Link>
              </Button>
            )}
            {can(user?.role, 'MANAGE_CONTRACTS') && (
              <Button asChild>
                <Link to="/cobrancas/nova?contrato=1">
                  <Plus aria-hidden />
                  Novo contrato
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Situação">
        {CHIPS.map((c) => (
          <Button key={c.label} size="sm" variant={status === c.value ? 'default' : 'outline'} aria-pressed={status === c.value} onClick={() => setParam('situacao', c.value)}>
            {c.label}
          </Button>
        ))}
      </div>
      <div className="relative mb-4 sm:max-w-sm">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Título ou cliente" aria-label="Buscar contratos" className="pl-9" />
      </div>

      {contracts.isPending ? (
        <TableSkeleton />
      ) : contracts.isError ? (
        <ErrorState error={contracts.error} onRetry={() => contracts.refetch()} />
      ) : contracts.data.data.length === 0 ? (
        <EmptyState title="Nenhum contrato" description="Monte a cobrança em Nova cobrança e use “Gerar contrato” para enviar para assinatura." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contrato</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Enviado</TableHead>
                  <TableHead>Assinado</TableHead>
                  <TableHead>Cobrança</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.data.data.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => navigate(`/contratos/${c.id}`)}>
                    <TableCell>
                      <Link to={`/contratos/${c.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                        {c.title}
                      </Link>
                      <p className="text-xs text-muted-foreground">{c.customer.name}</p>
                    </TableCell>
                    <TableCell className="tabular text-right">{formatBRL(c.totalCents)}</TableCell>
                    <TableCell><StatusBadge kind="contract" status={c.status} /></TableCell>
                    <TableCell className="tabular text-sm">{c.sentAt ? formatDate(c.sentAt.slice(0, 10)) : '—'}</TableCell>
                    <TableCell className="tabular text-sm">{c.signedAt ? formatDate(c.signedAt.slice(0, 10)) : '—'}</TableCell>
                    <TableCell className="text-sm">
                      {c.chargeGeneratedAt ? (
                        <span className="text-emerald-800">Gerada</span>
                      ) : c.chargeError ? (
                        <span className="inline-flex items-center gap-1 text-destructive"><CircleAlert aria-hidden className="size-3.5" />Erro ao gerar</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar page={page} pageSize={CONTRACTS_PAGE_SIZE} total={contracts.data.meta.total} onPageChange={(p) => setParam('pagina', p > 1 ? String(p) : null)} />
        </>
      )}
    </>
  );
}
