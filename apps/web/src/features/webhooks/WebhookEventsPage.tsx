import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Activity, RefreshCw, RotateCcw } from 'lucide-react';
import type { Paginated, WebhookEventDetailDto, WebhookEventDto, WebhookEventState, WebhookHealthDto } from '@financeiro/shared';
import { PageHeader } from '@/components/page-header';
import { PaginationBar } from '@/components/pagination-bar';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { get, post } from '@/lib/api';
import { errorMessage } from '@/lib/form-errors';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { eventLabel } from '../charges/labels';

const PAGE_SIZE = 25;
const ALL = 'todos';

const stateStyle: Record<WebhookEventState, [string, string]> = {
  processed: ['Processado', 'bg-emerald-100 text-emerald-900 ring-emerald-300'],
  pending: ['Pendente', 'bg-amber-100 text-amber-900 ring-amber-300'],
  error: ['Com erro', 'bg-red-100 text-red-900 ring-red-300'],
  ignored: ['Ignorado', 'bg-zinc-100 text-zinc-700 ring-zinc-300'],
};
const sourceLabels = { ASAAS: 'Asaas', CONTRACT: 'Contratos', RECONCILE: 'Reconciliação' } as const;
const resultLabels: Record<string, string> = {
  APPLIED: 'aplicado',
  IMPORTED: 'importado',
  IGNORED: 'só registro',
  IGNORED_TRANSITION: 'transição fora de ordem',
  UNKNOWN_RESOURCE: 'cobrança não encontrada',
};

function StateBadge({ state }: { state: WebhookEventState }) {
  const [label, cls] = stateStyle[state];
  return <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', cls)}>{label}</span>;
}

export function useWebhookHealth() {
  return useQuery({ queryKey: ['webhook-health'], queryFn: () => get<WebhookHealthDto>('/webhook-events/health'), staleTime: 60_000 });
}

/** WHK-03.3: saúde do recebimento de eventos. */
export function WebhookHealthCard() {
  const health = useWebhookHealth();
  const qc = useQueryClient();
  // WHK-04.4: confere no Asaas as cobranças em aberto e as pagas/canceladas recentes.
  const reconcile = useMutation({
    mutationFn: () => post<{ checked: number; fixed: number; imported: number; errors: number }>('/reconcile'),
    onSuccess: (s) => {
      toast.success(`Reconciliação: ${s.checked} verificadas, ${s.fixed} corrigidas, ${s.imported} importadas${s.errors ? `, ${s.errors} com erro` : ''}.`);
      return Promise.all(['webhook-events', 'webhook-health', 'charges', 'dashboard'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!health.data) return null;
  const h = health.data;
  return (
    <div className={cn('flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border px-4 py-3 text-sm', h.alert ? 'border-amber-300 bg-amber-50 text-amber-900' : 'bg-card')}>
      <span className="flex items-center gap-2 font-medium"><Activity aria-hidden className="size-4" />{h.alert ?? 'Recebimento de eventos em dia'}</span>
      <span className="text-muted-foreground">Último evento: {h.lastReceivedAt ? formatDateTime(h.lastReceivedAt) : 'nenhum'}</span>
      <span className="text-muted-foreground">Erros nas últimas 24 h: <span className="tabular">{h.errorsLast24h}</span></span>
      <Button size="sm" variant="outline" className="ml-auto" disabled={reconcile.isPending} onClick={() => reconcile.mutate()}>
        <RefreshCw aria-hidden className={reconcile.isPending ? 'animate-spin' : undefined} />
        Reconciliar agora
      </Button>
    </div>
  );
}

export function WebhookEventsPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const filters = {
    source: params.get('origem') ?? undefined,
    state: params.get('situacao') ?? undefined,
    resourceId: params.get('recurso') ?? undefined,
  };
  const page = Math.max(1, Number(params.get('pagina')) || 1);
  const [selected, setSelected] = useState<string | null>(null);

  const events = useQuery({
    queryKey: ['webhook-events', filters, page],
    queryFn: () => get<Paginated<WebhookEventDto>>('/webhook-events', { ...filters, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const detail = useQuery({
    queryKey: ['webhook-event', selected],
    queryFn: () => get<WebhookEventDetailDto>(`/webhook-events/${selected}`),
    enabled: selected !== null,
  });
  const reprocess = useMutation({
    mutationFn: (id: string) => post<WebhookEventDetailDto>(`/webhook-events/${id}/reprocess`),
    onSuccess: () => {
      toast.success('Evento enviado para reprocessar.');
      void Promise.all(['webhook-events', 'webhook-event', 'webhook-health'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  function setFilter(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('pagina');
    setParams(next, { replace: true });
  }

  return (
    <>
      <PageHeader title="Log de eventos" description="Avisos recebidos do Asaas e dos contratos: o que foi aplicado, ignorado ou falhou." />
      <div className="mb-4"><WebhookHealthCard /></div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Select value={filters.source ?? ALL} onValueChange={(v) => setFilter('origem', v === ALL ? null : v)}>
          <SelectTrigger aria-label="Origem" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as origens</SelectItem>
            {Object.entries(sourceLabels).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.state ?? ALL} onValueChange={(v) => setFilter('situacao', v === ALL ? null : v)}>
          <SelectTrigger aria-label="Situação" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as situações</SelectItem>
            {(Object.keys(stateStyle) as WebhookEventState[]).map((s) => <SelectItem key={s} value={s}>{stateStyle[s][0]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          type="search"
          defaultValue={filters.resourceId}
          placeholder="Recurso (ex.: pay_…)"
          aria-label="Filtrar por recurso"
          onKeyDown={(e) => e.key === 'Enter' && setFilter('recurso', e.currentTarget.value.trim() || null)}
          onBlur={(e) => setFilter('recurso', e.currentTarget.value.trim() || null)}
        />
      </div>

      {events.isPending ? (
        <TableSkeleton />
      ) : events.isError ? (
        <ErrorState error={events.error} onRetry={() => events.refetch()} />
      ) : events.data.data.length === 0 ? (
        <EmptyState title="Nenhum evento" description="Quando o Asaas avisar sobre pagamentos, vencimentos e estornos, os eventos aparecem aqui." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recebido</TableHead>
                  <TableHead>Evento</TableHead>
                  <TableHead>Recurso</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Tentativas</TableHead>
                  <TableHead><span className="sr-only">Ações</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.data.data.map((e) => (
                  <TableRow key={e.id} className="cursor-pointer" onClick={() => setSelected(e.id)}>
                    <TableCell className="tabular text-sm whitespace-nowrap">{formatDateTime(e.receivedAt)}</TableCell>
                    <TableCell>
                      <p>{eventLabel(e.event)}</p>
                      <p className="text-xs text-muted-foreground">{sourceLabels[e.source]} · {e.event}</p>
                    </TableCell>
                    <TableCell className="tabular text-xs">
                      {e.chargeId ? (
                        <Link to={`/cobrancas/${e.chargeId}`} onClick={(ev) => ev.stopPropagation()} className="hover:underline">{e.resourceId}</Link>
                      ) : (e.resourceId ?? '—')}
                    </TableCell>
                    <TableCell>
                      <StateBadge state={e.state} />
                      {e.result && <p className="mt-0.5 text-xs text-muted-foreground">{resultLabels[e.result] ?? e.result}</p>}
                      {e.error && <p className="mt-0.5 max-w-xs truncate text-xs text-destructive" title={e.error}>{e.error}</p>}
                    </TableCell>
                    <TableCell className="tabular text-right">{e.attempts}</TableCell>
                    <TableCell className="text-right">
                      {(e.state === 'error' || e.state === 'pending') && (
                        <Button size="sm" variant="outline" disabled={reprocess.isPending} onClick={(ev) => { ev.stopPropagation(); reprocess.mutate(e.id); }}>
                          <RotateCcw aria-hidden />Reprocessar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar page={page} pageSize={PAGE_SIZE} total={events.data.meta.total} onPageChange={(p) => {
            const next = new URLSearchParams(params);
            if (p > 1) next.set('pagina', String(p));
            else next.delete('pagina');
            setParams(next);
          }} />
        </>
      )}

      <Sheet open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="flex w-full flex-col sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{detail.data ? eventLabel(detail.data.event) : 'Evento'}</SheetTitle>
            <SheetDescription>{detail.data ? `${detail.data.event} · ${detail.data.externalEventId}` : 'Carregando…'}</SheetDescription>
          </SheetHeader>
          {detail.data && (
            <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <StateBadge state={detail.data.state} />
                <span className="text-muted-foreground">{detail.data.attempts} tentativa(s)</span>
                {detail.data.processedAt && <span className="text-muted-foreground">processado {formatDateTime(detail.data.processedAt)}</span>}
              </div>
              {detail.data.error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">{detail.data.error}</p>}
              <pre className="tabular overflow-x-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(detail.data.payload, null, 2)}</pre>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
