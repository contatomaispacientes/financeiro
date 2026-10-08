import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { MoreHorizontal, Paperclip, Plus, Repeat, Search } from 'lucide-react';
import { can, formatBRL, paymentMethodLabels, type ExpenseDto, type ExpenseState } from '@financeiro/shared';
import { PageHeader } from '@/components/page-header';
import { PaginationBar } from '@/components/pagination-bar';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSession } from '@/lib/auth';
import { get } from '@/lib/api';
import { errorMessage } from '@/lib/form-errors';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { EXPENSES_PAGE_SIZE, useCategories, useExpenseMutations, useExpenses, useRecurrences } from './api';
import { ExpenseFormSheet, PayExpenseDialog, RecurrenceFormSheet } from './ExpenseForms';

const STATE_CHIPS: Array<{ value: ExpenseState | undefined; label: string }> = [
  { value: undefined, label: 'Todas' },
  { value: 'open', label: 'A pagar' },
  { value: 'late', label: 'Atrasadas' },
  { value: 'paid', label: 'Pagas' },
  { value: 'canceled', label: 'Canceladas' },
];

function Kpi({ label, value, tone }: { label: string; value: number; tone?: 'out' | 'warn' | 'in' }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn('tabular mt-1 text-xl font-semibold', tone === 'out' && 'text-outflow', tone === 'warn' && 'text-destructive', tone === 'in' && 'text-inflow')}>
        {formatBRL(value)}
      </p>
    </div>
  );
}

function ExpensesTab({ canEdit }: { canEdit: boolean }) {
  const [params, setParams] = useSearchParams();
  const state = (params.get('situacao') as ExpenseState | null) ?? undefined;
  const categoryId = params.get('categoria') ?? undefined;
  const search = params.get('busca') ?? '';
  const page = Math.max(1, Number(params.get('pagina')) || 1);
  const [term, setTerm] = useState(search);
  const expenses = useExpenses({ state, categoryId, search: search || undefined, page });
  const categories = useCategories();
  const { unpay, cancel, attach, detach } = useExpenseMutations();
  const fileInput = useRef<HTMLInputElement>(null);
  const [attachTo, setAttachTo] = useState<string | null>(null);

  function pickFile(id: string) {
    setAttachTo(id);
    fileInput.current?.click();
  }

  async function onFile(file: File | undefined) {
    if (!file || !attachTo) return;
    if (file.size > 5 * 1024 * 1024) return void toast.error('O anexo pode ter no máximo 5 MB.');
    await run(attach.mutateAsync({ id: attachTo, file }), 'Anexo salvo.');
    if (fileInput.current) fileInput.current.value = '';
  }

  /** DSP-NF1: link assinado de poucos minutos, aberto em outra aba. */
  async function openAttachment(id: string) {
    try {
      const { url } = await get<{ url: string }>(`/expenses/${id}/attachment`);
      window.open(url, '_blank', 'noopener');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }
  const [editing, setEditing] = useState<ExpenseDto | 'new' | null>(null);
  const [paying, setPaying] = useState<ExpenseDto | null>(null);

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

  async function run(action: Promise<unknown>, ok: string) {
    try {
      await action;
      toast.success(ok);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const summary = expenses.data?.summary;

  return (
    <>
      {summary && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Em aberto" value={summary.openCents} tone="out" />
          <Kpi label="Atrasadas" value={summary.lateCents} tone={summary.lateCents > 0 ? 'warn' : undefined} />
          <Kpi label="Pago no mês" value={summary.paidThisMonthCents} />
          <Kpi label="Total do mês" value={summary.monthTotalCents} />
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Situação">
        {STATE_CHIPS.map((chip) => {
          const count = chip.value ? summary?.countByState[chip.value] : undefined;
          const active = state === chip.value;
          return (
            <Button key={chip.label} size="sm" variant={active ? 'default' : 'outline'} aria-pressed={active} onClick={() => setParam('situacao', chip.value)}>
              {chip.label}
              {count !== undefined && <span className="tabular opacity-70">{count}</span>}
            </Button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative sm:max-w-sm sm:flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Descrição ou fornecedor" aria-label="Buscar despesas" className="pl-9" />
        </div>
        <Select value={categoryId ?? 'todas'} onValueChange={(v) => setParam('categoria', v === 'todas' ? null : v)}>
          <SelectTrigger aria-label="Categoria" className="sm:w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as categorias</SelectItem>
            {categories.data?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {canEdit && (
          <Button className="sm:ml-auto" onClick={() => setEditing('new')}>
            <Plus aria-hidden />
            Nova despesa
          </Button>
        )}
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => void onFile(e.target.files?.[0])}
      />

      {expenses.isPending ? (
        <TableSkeleton />
      ) : expenses.isError ? (
        <ErrorState error={expenses.error} onRetry={() => expenses.refetch()} />
      ) : expenses.data.data.length === 0 ? (
        <EmptyState title="Nenhuma despesa encontrada" description="Lance as contas a pagar para acompanhar o caixa." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Situação</TableHead>
                  {canEdit && <TableHead><span className="sr-only">Ações</span></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.data.data.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="tabular">{formatDate(e.dueDate)}</TableCell>
                    <TableCell>
                      <p className="font-medium">
                        {e.description}
                        {e.recurrenceId && <Repeat aria-label="Recorrente" className="ml-1.5 inline size-3.5 text-muted-foreground" />}
                        {e.hasAttachment && (
                          <button type="button" onClick={() => void openAttachment(e.id)} aria-label={`Ver anexo de ${e.description}`} className="ml-1.5 inline-flex align-middle text-muted-foreground hover:text-foreground">
                            <Paperclip aria-hidden className="size-3.5" />
                          </button>
                        )}
                      </p>
                      {e.supplier && <p className="text-xs text-muted-foreground">{e.supplier}</p>}
                    </TableCell>
                    <TableCell className="text-sm">{e.category.name}</TableCell>
                    <TableCell className="tabular text-right">
                      {formatBRL(e.paidValueCents ?? e.valueCents)}
                      {e.paidAt && (
                        <p className="text-xs text-muted-foreground">
                          pago {formatDate(e.paidAt)} · {e.paymentMethod ? paymentMethodLabels[e.paymentMethod] : ''}
                        </p>
                      )}
                    </TableCell>
                    <TableCell><StatusBadge kind="expense" status={e.late ? 'OVERDUE' : e.status} /></TableCell>
                    {canEdit && (
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {e.status === 'OPEN' && <Button size="sm" variant="outline" onClick={() => setPaying(e)}>Marcar paga</Button>}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon-sm" variant="ghost" aria-label={`Mais ações de ${e.description}`}><MoreHorizontal /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => setEditing(e)}>Editar</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => pickFile(e.id)}>{e.hasAttachment ? 'Trocar anexo' : 'Anexar comprovante'}</DropdownMenuItem>
                              {e.hasAttachment && (
                                <DropdownMenuItem onSelect={() => run(detach.mutateAsync(e.id), 'Anexo removido.')}>Remover anexo</DropdownMenuItem>
                              )}
                              {e.status === 'PAID' && (
                                <DropdownMenuItem onSelect={() => run(unpay.mutateAsync(e.id), 'Pagamento desfeito.')}>Desfazer pagamento</DropdownMenuItem>
                              )}
                              {e.status === 'OPEN' && (
                                <DropdownMenuItem variant="destructive" onSelect={() => run(cancel.mutateAsync(e.id), 'Despesa cancelada.')}>Cancelar despesa</DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar page={page} pageSize={EXPENSES_PAGE_SIZE} total={expenses.data.meta.total} onPageChange={(p) => setParam('pagina', p > 1 ? String(p) : null)} />
        </>
      )}

      <ExpenseFormSheet open={editing !== null} expense={editing && editing !== 'new' ? editing : undefined} onOpenChange={(o) => !o && setEditing(null)} />
      <PayExpenseDialog expense={paying} onOpenChange={(o) => !o && setPaying(null)} />
    </>
  );
}

function RecurrencesTab({ canEdit }: { canEdit: boolean }) {
  const recurrences = useRecurrences();
  const { updateRecurrence } = useExpenseMutations();
  const [creating, setCreating] = useState(false);

  async function toggle(id: string, active: boolean) {
    try {
      await updateRecurrence.mutateAsync({ id, input: { active } });
      toast.success(active ? 'Recorrência retomada.' : 'Recorrência pausada.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      {canEdit && (
        <div className="mb-4 flex justify-end">
          <Button onClick={() => setCreating(true)}><Plus aria-hidden />Nova recorrência</Button>
        </div>
      )}
      {recurrences.isPending ? (
        <TableSkeleton />
      ) : recurrences.isError ? (
        <ErrorState error={recurrences.error} onRetry={() => recurrences.refetch()} />
      ) : recurrences.data.length === 0 ? (
        <EmptyState title="Nenhuma despesa recorrente" description="Aluguel, internet e salários podem ser lançados sozinhos todo mês." />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descrição</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Vence</TableHead>
                <TableHead>Período</TableHead>
                <TableHead>Ativa</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recurrences.data.map((r) => (
                <TableRow key={r.id} className={cn(!r.active && 'text-muted-foreground')}>
                  <TableCell>
                    <p className="font-medium">{r.description}</p>
                    {r.supplier && <p className="text-xs text-muted-foreground">{r.supplier}</p>}
                  </TableCell>
                  <TableCell className="text-sm">{r.category.name}</TableCell>
                  <TableCell className="tabular text-right">{formatBRL(r.valueCents)}</TableCell>
                  <TableCell className="tabular">dia {r.dayOfMonth}</TableCell>
                  <TableCell className="tabular text-sm">{r.startMonth.split('-').reverse().join('/')}{r.endMonth ? ` a ${r.endMonth.split('-').reverse().join('/')}` : ' em diante'}</TableCell>
                  <TableCell>
                    <Switch checked={r.active} disabled={!canEdit} onCheckedChange={(v) => toggle(r.id, v)} aria-label={`${r.active ? 'Pausar' : 'Retomar'} ${r.description}`} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <RecurrenceFormSheet open={creating} onOpenChange={setCreating} />
    </>
  );
}

export function ExpensesPage() {
  const { user } = useSession();
  const canEdit = can(user?.role, 'MANAGE_RECORDS');
  return (
    <>
      <PageHeader title="Contas a pagar" description="Despesas da empresa, pagamentos e contas que se repetem todo mês." />
      <Tabs defaultValue="despesas">
        <TabsList>
          <TabsTrigger value="despesas">Despesas</TabsTrigger>
          <TabsTrigger value="recorrentes">Recorrentes</TabsTrigger>
        </TabsList>
        <TabsContent value="despesas" className="mt-4"><ExpensesTab canEdit={canEdit} /></TabsContent>
        <TabsContent value="recorrentes" className="mt-4"><RecurrencesTab canEdit={canEdit} /></TabsContent>
      </Tabs>
    </>
  );
}
