import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AlertTriangle, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { addMonthsToYearMonth, can, currentMonthInSaoPaulo, formatBRL, type DashboardPayable } from '@financeiro/shared';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PayExpenseDialog } from '../expenses/ExpenseForms';
import { eventLabel } from '../charges/labels';
import { useDashboard } from './api';
import { MonthPicker } from './MonthPicker';

function Kpi({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: 'in' | 'out' | 'warn' }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn('tabular mt-1 text-xl font-semibold', tone === 'in' && 'text-inflow', tone === 'out' && 'text-outflow', tone === 'warn' && 'text-destructive')}>
        {formatBRL(value)}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border bg-card">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="font-medium">{title}</h2>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Barras horizontais de realizado (cheio) + previsto (claro) — FLX-01.3. */
function ResultBar({ label, done, forecast, max, tone }: { label: string; done: number; forecast: number; max: number; tone: 'in' | 'out' }) {
  const pct = (v: number) => `${max > 0 ? (v / max) * 100 : 0}%`;
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="flex items-center gap-1.5">
          {tone === 'in' ? <ArrowUpRight className="size-4 text-inflow" aria-hidden /> : <ArrowDownRight className="size-4 text-outflow" aria-hidden />}
          {label}
        </span>
        <span className="tabular">
          {formatBRL(done)} <span className="text-muted-foreground">+ {formatBRL(forecast)} previsto</span>
        </span>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${label}: ${formatBRL(done)} realizado, ${formatBRL(forecast)} previsto`}>
        <div className={tone === 'in' ? 'bg-inflow' : 'bg-outflow'} style={{ width: pct(done) }} />
        <div className={tone === 'in' ? 'bg-inflow/30' : 'bg-outflow/30'} style={{ width: pct(forecast) }} />
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const month = params.get('mes') ?? currentMonthInSaoPaulo();
  const dashboard = useDashboard(month);
  const [paying, setPaying] = useState<DashboardPayable | null>(null);
  const canEdit = can(user?.role, 'MANAGE_RECORDS');

  const header = (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Visão geral</h1>
        <p className="mt-1 text-sm text-muted-foreground">Recebimentos, contas a pagar e saldo do mês.</p>
      </div>
      <MonthPicker value={month} onChange={(m) => setParams(m === currentMonthInSaoPaulo() ? {} : { mes: m })} max={addMonthsToYearMonth(currentMonthInSaoPaulo(), 3)} />
    </header>
  );

  if (dashboard.isPending) return <>{header}<TableSkeleton rows={8} /></>;
  if (dashboard.isError) return <>{header}<ErrorState error={dashboard.error} onRetry={() => dashboard.refetch()} /></>;

  const d = dashboard.data;
  const { alerts } = d;
  const max = Math.max(d.monthResult.in.doneCents + d.monthResult.in.forecastCents, d.monthResult.out.doneCents + d.monthResult.out.forecastCents);
  const alertItems = [
    alerts.staleDraftCharges > 0 && `${alerts.staleDraftCharges} cobrança(s) em rascunho há mais de 24 h — o Asaas falhou ao gerar`,
    alerts.pendingWebhookEvents > 0 && `${alerts.pendingWebhookEvents} evento(s) do Asaas sem processar há mais de 1 h`,
    alerts.contractsWithChargeError > 0 && `${alerts.contractsWithChargeError} contrato(s) assinado(s) com erro ao gerar a cobrança`,
  ].filter(Boolean) as string[];

  return (
    <>
      {header}

      {alertItems.length > 0 && (
        <div role="alert" className="mb-4 space-y-1 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200 ring-inset">
          {alertItems.map((a) => (
            <p key={a} className="flex items-start gap-2"><AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />{a}</p>
          ))}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Recebido no mês" value={d.kpis.receivedCents} tone="in" />
        <Kpi label="A receber no mês" value={d.kpis.receivableCents} hint="vencimento no mês" />
        <Kpi label="Vencido" value={d.kpis.overdueCents} tone={d.kpis.overdueCents > 0 ? 'warn' : undefined} hint="acumulado, todos os meses" />
        <Kpi label="Contas a pagar" value={d.kpis.payablesOpenCents} tone="out" hint="em aberto, inclui atrasadas" />
        <Kpi label="Saldo previsto" value={d.kpis.forecastBalanceCents} tone={d.kpis.forecastBalanceCents < 0 ? 'warn' : 'in'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Próximos recebimentos" action={<Link to="/cobrancas" className="text-sm text-muted-foreground hover:text-foreground">Ver cobranças</Link>}>
          {d.upcomingReceivables.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma cobrança em aberto.</p>
          ) : (
            <ul className="divide-y">
              {d.upcomingReceivables.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link to={`/cobrancas/${c.id}`} className="min-w-0 hover:underline">
                    <p className="truncate font-medium">{c.customerName}</p>
                    <p className="tabular text-xs text-muted-foreground">{formatDate(c.dueDate)} · {c.description}</p>
                  </Link>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="tabular">{formatBRL(c.valueCents)}</span>
                    <StatusBadge kind="charge" status={c.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Despesas em aberto" action={<Link to="/despesas" className="text-sm text-muted-foreground hover:text-foreground">Ver despesas</Link>}>
          {d.openPayables.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma despesa em aberto.</p>
          ) : (
            <ul className="divide-y">
              {d.openPayables.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{e.description}</p>
                    <p className={cn('tabular text-xs', e.late ? 'text-destructive' : 'text-muted-foreground')}>
                      {formatDate(e.dueDate)}{e.late && ' · atrasada'} · {e.categoryName}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="tabular">{formatBRL(e.valueCents)}</span>
                    {canEdit && <Button size="sm" variant="outline" onClick={() => setPaying(e)}>Marcar paga</Button>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Resultado do mês" action={<Link to="/fluxo" className="text-sm text-muted-foreground hover:text-foreground">Fluxo de caixa</Link>}>
          <div className="space-y-4">
            <ResultBar label="Entradas" done={d.monthResult.in.doneCents} forecast={d.monthResult.in.forecastCents} max={max} tone="in" />
            <ResultBar label="Saídas" done={d.monthResult.out.doneCents} forecast={d.monthResult.out.forecastCents} max={max} tone="out" />
            <p className="flex justify-between border-t pt-3 text-sm">
              <span className="text-muted-foreground">Resultado realizado</span>
              <span className={cn('tabular font-semibold', d.monthResult.in.doneCents - d.monthResult.out.doneCents < 0 ? 'text-destructive' : 'text-inflow')}>
                {formatBRL(d.monthResult.in.doneCents - d.monthResult.out.doneCents)}
              </span>
            </p>
          </div>
        </Card>

        {user?.role !== 'LEITURA' && (
          <Card title="Últimos eventos do Asaas" action={can(user?.role, 'ADMINISTER') && <Link to="/configuracoes/webhooks" className="text-sm text-muted-foreground hover:text-foreground">Log de eventos</Link>}>
            {d.recentEvents.length === 0 ? (
              <EmptyState title="Nenhum evento recebido" description="Os avisos do Asaas (pagamento, vencimento, estorno) aparecem aqui." />
            ) : (
              <ul className="divide-y">
                {d.recentEvents.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0">
                      <p className="truncate">{eventLabel(e.event)}</p>
                      <p className="tabular text-xs text-muted-foreground">{formatDateTime(e.receivedAt)} · {e.resourceId ?? '—'}</p>
                    </span>
                    <span className={cn('shrink-0 text-xs', e.error ? 'text-destructive' : 'text-muted-foreground')}>{e.error ? 'erro' : e.result ?? 'pendente'}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      <PayExpenseDialog
        expense={paying && { ...paying, category: { id: '', name: paying.categoryName }, supplier: null, status: 'OPEN', paidAt: null, paidValueCents: null, paymentMethod: null, recurrenceId: null, notes: null, createdAt: '' }}
        onOpenChange={(o) => !o && setPaying(null)}
      />
    </>
  );
}
