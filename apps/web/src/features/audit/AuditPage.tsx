import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { FilterX } from 'lucide-react';
import type { AuditLogDto, Paginated } from '@financeiro/shared';
import { DatePicker } from '@/components/date-picker';
import { PageHeader } from '@/components/page-header';
import { PaginationBar } from '@/components/pagination-bar';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { get } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useUsers } from '../users/api';
import { AuditDetails } from './AuditDetails';
import { actionLabels, entityLabels } from './labels';

const PAGE_SIZE = 25;
const ALL = 'todas';

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const filters = {
    entity: params.get('entidade') ?? undefined,
    userId: params.get('usuario') ?? undefined,
    from: params.get('de') ?? undefined,
    to: params.get('ate') ?? undefined,
  };
  const page = Math.max(1, Number(params.get('pagina')) || 1);
  const hasFilters = Object.values(filters).some(Boolean);

  const logs = useQuery({
    queryKey: ['audit-logs', filters, page],
    queryFn: () => get<Paginated<AuditLogDto>>('/audit-logs', { ...filters, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const users = useUsers(1, 100);

  /** Atualiza um filtro na URL e volta para a primeira página. */
  function setFilter(key: 'entidade' | 'usuario' | 'de' | 'ate', value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('pagina');
    setParams(next, { replace: true });
  }

  function setPage(next: number) {
    const updated = new URLSearchParams(params);
    if (next > 1) updated.set('pagina', String(next));
    else updated.delete('pagina');
    setParams(updated);
  }

  return (
    <>
      <PageHeader title="Auditoria" description="Quem fez o quê e quando: logins, usuários, configurações e integrações." />

      <div className="mb-4 grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_10rem_10rem_auto] lg:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="filtro-entidade">Entidade</Label>
          <Select value={filters.entity ?? ALL} onValueChange={(v) => setFilter('entidade', v === ALL ? null : v)}>
            <SelectTrigger id="filtro-entidade" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas</SelectItem>
              {Object.entries(entityLabels).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="filtro-usuario">Usuário</Label>
          <Select value={filters.userId ?? ALL} onValueChange={(v) => setFilter('usuario', v === ALL ? null : v)}>
            <SelectTrigger id="filtro-usuario" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos</SelectItem>
              {users.data?.data.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="filtro-de">De</Label>
          <DatePicker id="filtro-de" value={filters.from ?? null} max={filters.to} onChange={(v) => setFilter('de', v)} />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="filtro-ate">Até</Label>
          <DatePicker id="filtro-ate" value={filters.to ?? null} min={filters.from} onChange={(v) => setFilter('ate', v)} />
        </div>

        <Button variant="ghost" disabled={!hasFilters} onClick={() => setParams({}, { replace: true })}>
          <FilterX aria-hidden />
          Limpar
        </Button>
      </div>

      {logs.isPending ? (
        <TableSkeleton />
      ) : logs.isError ? (
        <ErrorState error={logs.error} onRetry={() => logs.refetch()} />
      ) : logs.data.data.length === 0 ? (
        <EmptyState
          title={hasFilters ? 'Nada encontrado com esses filtros' : 'Nenhum registro ainda'}
          description={hasFilters ? 'Amplie o período ou limpe os filtros.' : 'As ações sensíveis aparecem aqui assim que acontecem.'}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">Quando</TableHead>
                  <TableHead>Quem</TableHead>
                  <TableHead>Ação</TableHead>
                  <TableHead>Detalhes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.data.data.map((log) => (
                  <TableRow key={log.id} className="align-top">
                    <TableCell className="tabular text-sm whitespace-nowrap">{formatDateTime(log.createdAt)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {/* Na tentativa recusada o usuário é o alvo, não quem agiu. */}
                      {log.action === 'auth.login_failed' ? (
                        <span className="text-muted-foreground">Não autenticado</span>
                      ) : (
                        log.userName ?? <span className="text-muted-foreground">Sistema</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <p>{actionLabels[log.action] ?? log.action}</p>
                      <p className="text-xs text-muted-foreground">{entityLabels[log.entity] ?? log.entity}</p>
                    </TableCell>
                    <TableCell className="min-w-64 text-sm whitespace-normal">
                      <AuditDetails log={log} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar page={page} pageSize={PAGE_SIZE} total={logs.data.meta.total} onPageChange={setPage} />
        </>
      )}
    </>
  );
}
