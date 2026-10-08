import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Search, UserPlus } from 'lucide-react';
import { can, formatDocument, formatPhone } from '@financeiro/shared';
import { PageHeader } from '@/components/page-header';
import { PaginationBar } from '@/components/pagination-bar';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSession } from '@/lib/auth';
import { formatBRL } from '@/lib/format';
import { CUSTOMERS_PAGE_SIZE, useCustomers } from './api';
import { CustomerFormSheet } from './CustomerFormSheet';

/** Documento vem só com dígitos, ou já mascarado para LEITURA (CLI-02.4). */
export const displayDocument = (document: string) => (document.includes('*') ? document : formatDocument(document));

export function CustomersPage() {
  const { user } = useSession();
  const canEdit = can(user?.role, 'MANAGE_RECORDS');
  const [params, setParams] = useSearchParams();
  const search = params.get('busca') ?? '';
  const archived = params.get('arquivados') === '1';
  const page = Math.max(1, Number(params.get('pagina')) || 1);
  const [term, setTerm] = useState(search);
  const [creating, setCreating] = useState(false);
  const customers = useCustomers({ search: search || undefined, archived, page });

  // Busca com debounce de 300 ms (design da spec 01), refletida na URL.
  useEffect(() => {
    const id = setTimeout(() => {
      if (term.trim() === search) return;
      const next = new URLSearchParams(params);
      if (term.trim()) next.set('busca', term.trim());
      else next.delete('busca');
      next.delete('pagina');
      setParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(id);
  }, [term, search, params, setParams]);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'pagina') next.delete('pagina');
    setParams(next, { replace: key !== 'pagina' });
  }

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Quem você cobra. O cadastro no Asaas é criado na primeira cobrança."
        actions={
          canEdit && (
            <Button onClick={() => setCreating(true)}>
              <UserPlus aria-hidden />
              Novo cliente
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Buscar por nome, CPF ou CNPJ"
            aria-label="Buscar clientes"
            className="pl-9"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={archived} onCheckedChange={(v) => setParam('arquivados', v ? '1' : null)} />
          Mostrar arquivados
        </label>
      </div>

      {customers.isPending ? (
        <TableSkeleton />
      ) : customers.isError ? (
        <ErrorState error={customers.error} onRetry={() => customers.refetch()} />
      ) : customers.data.data.length === 0 ? (
        search ? (
          <EmptyState title="Nenhum cliente encontrado" description="Confira a grafia ou busque pelo CPF/CNPJ." />
        ) : (
          <EmptyState
            title="Nenhum cliente ainda"
            description="Cadastre o primeiro cliente para emitir cobranças e contratos."
            action={canEdit && <Button onClick={() => setCreating(true)}>Novo cliente</Button>}
          />
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead>Asaas</TableHead>
                  <TableHead className="text-right">Cobranças</TableHead>
                  <TableHead className="text-right">Pago</TableHead>
                  <TableHead className="text-right">Em aberto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.data.data.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link to={`/clientes/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      {c.archivedAt && (
                        <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">Arquivado</span>
                      )}
                      <p className="tabular text-xs text-muted-foreground">{displayDocument(c.document)}</p>
                    </TableCell>
                    <TableCell className="text-sm">
                      <p>{c.email ?? <span className="text-muted-foreground">—</span>}</p>
                      {c.phone && <p className="tabular text-xs text-muted-foreground">{formatPhone(c.phone)}</p>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {c.asaasCustomerId ? (
                        <span className="tabular text-xs">{c.asaasCustomerId}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Criado na 1ª cobrança</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular text-right">{c.chargesCount}</TableCell>
                    <TableCell className="tabular text-right text-inflow">{formatBRL(c.paidCents)}</TableCell>
                    <TableCell className="tabular text-right">
                      {formatBRL(c.openCents)}
                      {c.overdueCents > 0 && (
                        <p className="text-xs text-destructive">{formatBRL(c.overdueCents)} vencido</p>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar
            page={page}
            pageSize={CUSTOMERS_PAGE_SIZE}
            total={customers.data.meta.total}
            onPageChange={(next) => setParam('pagina', next > 1 ? String(next) : null)}
          />
        </>
      )}

      <CustomerFormSheet open={creating} onOpenChange={setCreating} />
    </>
  );
}
