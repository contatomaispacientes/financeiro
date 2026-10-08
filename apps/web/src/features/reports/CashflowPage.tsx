import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { Download } from 'lucide-react';
import { addMonthsToYearMonth, currentMonthInSaoPaulo, formatBRL, type CashflowMonth } from '@financeiro/shared';
import { ErrorState, TableSkeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { downloadCsv, useAging, useByCategory, useCashflow, useStatement } from './api';
import { MonthPicker, monthLabel } from './MonthPicker';

const IN = '#0E6B4E';
const OUT = '#B4471C';

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="font-medium">{title}</h2>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function ExportButton({ path, query, filename }: { path: string; query: Record<string, string>; filename: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        await downloadCsv(path, query, filename);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Não foi possível exportar.');
      } finally {
        setBusy(false);
      }
    }}>
      <Download aria-hidden />
      Exportar CSV
    </Button>
  );
}

const brlShort = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { notation: 'compact', style: 'currency', currency: 'BRL', maximumFractionDigits: 1 }).format(cents / 100);

/** FLX-02.2: realizado cheio, previsto claro e projeção ainda mais clara (empilhados). */
function Chart({ months }: { months: CashflowMonth[] }) {
  const data = months.map((m) => ({
    label: monthLabel(m.month, true),
    'Entradas': m.inDoneCents,
    'Entradas previstas': m.inForecastCents,
    'Entradas projetadas': m.inProjectedCents,
    'Saídas': m.outDoneCents,
    'Saídas previstas': m.outForecastCents,
    'Saídas projetadas': m.outProjectedCents,
  }));
  return (
    <div className="h-72" role="img" aria-label="Gráfico de entradas e saídas por mês">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 8, right: 8 }}>
          <CartesianGrid vertical={false} stroke="#E1E3DD" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
          <YAxis tickFormatter={brlShort} tickLine={false} axisLine={false} fontSize={12} width={72} />
          <Tooltip formatter={(v) => formatBRL(Number(v))} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Entradas" stackId="in" fill={IN} />
          <Bar dataKey="Entradas previstas" stackId="in" fill={IN} fillOpacity={0.4} />
          <Bar dataKey="Entradas projetadas" stackId="in" fill={IN} fillOpacity={0.15} stroke={IN} strokeDasharray="3 3" />
          <Bar dataKey="Saídas" stackId="out" fill={OUT} />
          <Bar dataKey="Saídas previstas" stackId="out" fill={OUT} fillOpacity={0.4} />
          <Bar dataKey="Saídas projetadas" stackId="out" fill={OUT} fillOpacity={0.15} stroke={OUT} strokeDasharray="3 3" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function MonthTable({ months, totals }: { months: CashflowMonth[]; totals: { inDoneCents: number; outDoneCents: number; resultCents: number } }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Mês</TableHead>
            <TableHead className="text-right">Entradas</TableHead>
            <TableHead className="text-right">Saídas</TableHead>
            <TableHead className="text-right">Resultado</TableHead>
            <TableHead className="text-right">Margem</TableHead>
            <TableHead className="text-right">Previsto (entra / sai)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {months.map((m) => (
            <TableRow key={m.month} className={cn(m.isCurrent && 'bg-accent/40')}>
              <TableCell className="capitalize">{monthLabel(m.month)}{m.isCurrent && <span className="ml-2 text-xs text-muted-foreground">atual</span>}</TableCell>
              <TableCell className="tabular text-right text-inflow">{formatBRL(m.inDoneCents)}</TableCell>
              <TableCell className="tabular text-right text-outflow">{formatBRL(m.outDoneCents)}</TableCell>
              <TableCell className={cn('tabular text-right font-medium', m.resultCents < 0 && 'text-destructive')}>{formatBRL(m.resultCents)}</TableCell>
              <TableCell className="tabular text-right">{m.marginPct === null ? '—' : `${m.marginPct.toLocaleString('pt-BR')}%`}</TableCell>
              <TableCell className="tabular text-right text-sm text-muted-foreground">
                {m.isCurrent || m.isFuture
                  ? `${formatBRL(m.inForecastCents + m.inProjectedCents)} / ${formatBRL(m.outForecastCents + m.outProjectedCents)}`
                  : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>Total realizado</TableCell>
            <TableCell className="tabular text-right">{formatBRL(totals.inDoneCents)}</TableCell>
            <TableCell className="tabular text-right">{formatBRL(totals.outDoneCents)}</TableCell>
            <TableCell className={cn('tabular text-right', totals.resultCents < 0 && 'text-destructive')}>{formatBRL(totals.resultCents)}</TableCell>
            <TableCell colSpan={2} />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

function MonthDetails({ month }: { month: string }) {
  const byCategory = useByCategory(month);
  const statement = useStatement(month);
  const maxCategory = Math.max(1, ...(byCategory.data ?? []).map((c) => c.doneCents + c.forecastCents));

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
      <Section title="Saídas por categoria">
        {byCategory.isPending ? <TableSkeleton rows={4} /> : !byCategory.data?.length ? (
          <p className="text-sm text-muted-foreground">Nenhuma saída no mês.</p>
        ) : (
          <ul className="space-y-3">
            {byCategory.data.map((c) => (
              <li key={c.category} className="text-sm">
                <div className="mb-1 flex justify-between">
                  <span>{c.category}</span>
                  <span className="tabular">{formatBRL(c.doneCents)}{c.forecastCents > 0 && <span className="text-muted-foreground"> + {formatBRL(c.forecastCents)}</span>}</span>
                </div>
                <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                  <div className="bg-outflow" style={{ width: `${(c.doneCents / maxCategory) * 100}%` }} />
                  <div className="bg-outflow/30" style={{ width: `${(c.forecastCents / maxCategory) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Extrato realizado" action={<ExportButton path="/reports/statement.csv" query={{ month }} filename={`extrato-${month}.csv`} />}>
        {statement.isPending ? <TableSkeleton rows={5} /> : !statement.data?.length ? (
          <p className="text-sm text-muted-foreground">Nenhuma movimentação realizada no mês.</p>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto">
            {statement.data.map((e, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="tabular w-12 shrink-0 text-muted-foreground">{formatDate(e.date).slice(0, 5)}</span>
                <span className="min-w-0 flex-1">
                  {e.link ? <Link to={e.link} className="font-medium hover:underline">{e.title}</Link> : <span className="font-medium">{e.title}</span>}
                  <p className="truncate text-xs text-muted-foreground">{e.subtitle}</p>
                </span>
                <span className={cn('tabular shrink-0', e.kind === 'IN' ? 'text-inflow' : 'text-outflow')}>
                  {e.kind === 'IN' ? '+' : '−'} {formatBRL(e.valueCents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Aging() {
  const aging = useAging();
  if (aging.isPending) return <TableSkeleton rows={4} />;
  if (aging.isError) return <ErrorState error={aging.error} onRetry={() => aging.refetch()} />;
  const labels = { '1-15': '1 a 15 dias', '16-30': '16 a 30 dias', '31-60': '31 a 60 dias', '60+': 'Mais de 60 dias' };
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {aging.data.buckets.map((b) => (
          <div key={b.range} className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">{labels[b.range]}</p>
            <p className={cn('tabular mt-1 font-semibold', b.totalCents > 0 && 'text-destructive')}>{formatBRL(b.totalCents)}</p>
            <ul className="mt-2 space-y-1">
              {b.customers.slice(0, 4).map((c) => (
                <li key={c.id} className="truncate text-xs">
                  <Link to={`/clientes/${c.id}`} className="hover:underline">{c.name}</Link>
                </li>
              ))}
              {b.customers.length > 4 && <li className="text-xs text-muted-foreground">+{b.customers.length - 4}</li>}
            </ul>
          </div>
        ))}
      </div>
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Inadimplência (vencido e não pago ÷ total que venceu no mês)</p>
        <ul className="space-y-1.5">
          {aging.data.rateByMonth.map((r) => (
            <li key={r.month} className="flex items-center gap-3 text-sm">
              <span className="w-16 shrink-0 capitalize">{monthLabel(r.month, true)}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-destructive/70" style={{ width: `${Math.min(100, r.ratePct ?? 0)}%` }} />
              </div>
              <span className="tabular w-12 text-right">{r.ratePct === null ? '—' : `${r.ratePct.toLocaleString('pt-BR')}%`}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function CashflowPage() {
  const current = currentMonthInSaoPaulo();
  const maxMonth = addMonthsToYearMonth(current, 3);
  const [params, setParams] = useSearchParams();
  const from = params.get('de') ?? addMonthsToYearMonth(current, -6);
  const to = params.get('ate') ?? maxMonth;
  const [detailMonth, setDetailMonth] = useState(current);
  const cashflow = useCashflow(from, to);

  function setRange(key: 'de' | 'ate', value: string) {
    if (!value) return;
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next, { replace: true });
  }

  return (
    <>
      <header className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fluxo de caixa</h1>
          <p className="mt-1 text-sm text-muted-foreground">Regime de caixa: entradas e saídas pela data em que o dinheiro entrou ou saiu.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs text-muted-foreground">De
            <Input type="month" value={from} max={to} onChange={(e) => setRange('de', e.target.value)} className="w-40" />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">Até
            <Input type="month" value={to} min={from} max={maxMonth} onChange={(e) => setRange('ate', e.target.value)} className="w-40" />
          </label>
          <ExportButton path="/reports/cashflow.csv" query={{ from, to }} filename={`fluxo-${from}-a-${to}.csv`} />
        </div>
      </header>

      <div className="space-y-4">
        <Section title="Entradas × saídas">
          {cashflow.isPending ? <TableSkeleton rows={6} /> : cashflow.isError ? (
            <ErrorState error={cashflow.error} onRetry={() => cashflow.refetch()} />
          ) : (
            <>
              <Chart months={cashflow.data.months} />
              <p className="mt-2 text-xs text-muted-foreground">
                Tom claro = previsto (vence no mês); tracejado = projeção de recorrências e assinaturas ainda não geradas. Cartão conta na data de confirmação.
              </p>
              <div className="mt-4"><MonthTable months={cashflow.data.months} totals={cashflow.data.totals} /></div>
            </>
          )}
        </Section>

        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Detalhe do mês</h2>
          <MonthPicker value={detailMonth} onChange={setDetailMonth} max={maxMonth} />
        </div>
        <MonthDetails month={detailMonth} />

        <Section title="Vencido por faixa de atraso"><Aging /></Section>
      </div>
    </>
  );
}
