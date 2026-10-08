import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { LoaderCircle } from 'lucide-react';
import {
  ExpenseCreateSchema,
  ExpensePaySchema,
  ExpenseUpdateSchema,
  PAYMENT_METHODS,
  RecurrenceCreateSchema,
  formatBRL,
  paymentMethodLabels,
  todayInSaoPaulo,
  type ExpenseDto,
  type PaymentMethod,
  type RecurrenceDto,
} from '@financeiro/shared';
import { DatePicker } from '@/components/date-picker';
import { FormField, fieldAria } from '@/components/form-field';
import { MoneyInput } from '@/components/money-input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { applyApiError, errorMessage } from '@/lib/form-errors';
import { zodFormResolver } from '@/lib/zod-resolver';
import { useCategories, useExpenseMutations } from './api';

function CategorySelect({ id, value, onChange, error }: { id: string; value: string; onChange: (v: string) => void; error?: string }) {
  const categories = useCategories();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger {...fieldAria(id, error)} className="w-full">
        <SelectValue placeholder="Escolha a categoria" />
      </SelectTrigger>
      <SelectContent>
        {categories.data?.filter((c) => c.active || c.id === value).map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function FormError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

// ───────── Nova / editar despesa ─────────

interface ExpenseValues {
  description: string;
  categoryId: string;
  supplier: string;
  valueCents: number | null;
  dueDate: string | null;
  notes: string;
  repeatMonthly: boolean;
}

const expensePayload = (v: ExpenseValues) => ({ ...v, valueCents: v.valueCents ?? 0, dueDate: v.dueDate ?? '' });

export function ExpenseFormSheet({ expense, open, onOpenChange }: { expense?: ExpenseDto; open: boolean; onOpenChange: (o: boolean) => void }) {
  const editing = Boolean(expense);
  const onlyNotes = editing && expense!.status !== 'OPEN';
  const { create, update } = useExpenseMutations();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ExpenseValues>({
    resolver: zodFormResolver<ExpenseValues>(editing ? ExpenseUpdateSchema : ExpenseCreateSchema, expensePayload),
  });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    form.reset({
      description: expense?.description ?? '',
      categoryId: expense?.category.id ?? '',
      supplier: expense?.supplier ?? '',
      valueCents: expense?.valueCents ?? null,
      dueDate: expense?.dueDate ?? todayInSaoPaulo(),
      notes: expense?.notes ?? '',
      repeatMonthly: false,
    });
  }, [open, expense, form]);

  async function onSubmit(v: ExpenseValues) {
    setFormError(null);
    try {
      if (expense) {
        const { repeatMonthly: _r, ...rest } = expensePayload(v);
        await update.mutateAsync({ id: expense.id, input: ExpenseUpdateSchema.parse(onlyNotes ? { notes: rest.notes } : rest) });
        toast.success('Despesa atualizada.');
      } else {
        await create.mutateAsync(ExpenseCreateSchema.parse(expensePayload(v)));
        toast.success(v.repeatMonthly ? 'Despesa lançada e recorrência criada.' : 'Despesa lançada.');
      }
      onOpenChange(false);
    } catch (error) {
      if (!applyApiError(error, form.setError, ['description', 'categoryId', 'valueCents', 'dueDate'])) setFormError(errorMessage(error));
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>{editing ? 'Editar despesa' : 'Nova despesa'}</SheetTitle>
          <SheetDescription>{onlyNotes ? 'Despesa paga ou cancelada: só as observações podem mudar.' : 'Conta a pagar da empresa.'}</SheetDescription>
        </SheetHeader>
        <form id="expense-form" noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex-1 space-y-4 overflow-y-auto p-4">
          <fieldset disabled={onlyNotes} className="contents">
            <FormField id="exp-description" label="Descrição" error={errors.description?.message}>
              <Input {...fieldAria('exp-description', errors.description?.message)} {...form.register('description')} />
            </FormField>
            <FormField id="exp-category" label="Categoria" error={errors.categoryId?.message}>
              <Controller control={form.control} name="categoryId" render={({ field }) => (
                <CategorySelect id="exp-category" value={field.value} onChange={field.onChange} error={errors.categoryId?.message} />
              )} />
            </FormField>
            <FormField id="exp-supplier" label="Fornecedor" error={errors.supplier?.message}>
              <Input {...fieldAria('exp-supplier', errors.supplier?.message)} {...form.register('supplier')} />
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField id="exp-value" label="Valor" error={errors.valueCents?.message}>
                <Controller control={form.control} name="valueCents" render={({ field }) => (
                  <MoneyInput {...fieldAria('exp-value', errors.valueCents?.message)} value={field.value} onChange={field.onChange} />
                )} />
              </FormField>
              <FormField id="exp-due" label="Vencimento" error={errors.dueDate?.message}>
                <Controller control={form.control} name="dueDate" render={({ field }) => (
                  <DatePicker {...fieldAria('exp-due', errors.dueDate?.message)} value={field.value} onChange={field.onChange} />
                )} />
              </FormField>
            </div>
          </fieldset>
          <FormField id="exp-notes" label="Observações" error={errors.notes?.message}>
            <Textarea rows={3} {...fieldAria('exp-notes', errors.notes?.message)} {...form.register('notes')} />
          </FormField>
          {!editing && (
            <Controller control={form.control} name="repeatMonthly" render={({ field }) => (
              <label className="flex items-start gap-3 text-sm">
                <Switch checked={field.value} onCheckedChange={field.onChange} className="mt-0.5" />
                <span>
                  <span className="font-medium">Repetir todo mês</span>
                  <span className="block text-muted-foreground">Cria a recorrência; a despesa de cada mês aparece sozinha.</span>
                </span>
              </label>
            )} />
          )}
          <FormError message={formError} />
        </form>
        <SheetFooter className="flex-row justify-end border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="submit" form="expense-form" disabled={isSubmitting}>
            {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden />}
            {editing ? 'Salvar' : 'Lançar despesa'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ───────── Marcar como paga ─────────

export function PayExpenseDialog({ expense, onOpenChange }: { expense: ExpenseDto | null; onOpenChange: (o: boolean) => void }) {
  const { pay } = useExpenseMutations();
  const [paidAt, setPaidAt] = useState<string | null>(null);
  const [value, setValue] = useState<number | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('PIX');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!expense) return;
    setPaidAt(todayInSaoPaulo());
    setValue(expense.valueCents);
    setMethod('PIX');
    setError(null);
  }, [expense]);

  async function confirm() {
    if (!expense) return;
    const parsed = ExpensePaySchema.safeParse({ paidAt: paidAt ?? undefined, paidValueCents: value ?? undefined, paymentMethod: method });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Dados inválidos');
    try {
      await pay.mutateAsync({ id: expense.id, input: parsed.data });
      toast.success(`${expense.description} marcada como paga.`);
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Dialog open={expense !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Marcar como paga</DialogTitle>
          <DialogDescription>
            {expense?.description} · previsto {expense ? formatBRL(expense.valueCents) : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FormField id="pay-date" label="Data do pagamento">
            <DatePicker id="pay-date" value={paidAt} onChange={setPaidAt} max={todayInSaoPaulo()} />
          </FormField>
          <FormField id="pay-value" label="Valor pago">
            <MoneyInput id="pay-value" value={value} onChange={setValue} />
          </FormField>
          <FormField id="pay-method" label="Forma de pagamento">
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger id="pay-method" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{paymentMethodLabels[m]}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormField>
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={confirm} disabled={pay.isPending}>
            {pay.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
            Confirmar pagamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────── Nova recorrência ─────────

interface RecurrenceValues {
  description: string;
  categoryId: string;
  supplier: string;
  valueCents: number | null;
  dayOfMonth: number;
  startMonth: string;
  endMonth: string;
}

const recurrencePayload = (v: RecurrenceValues) => ({
  ...v,
  valueCents: v.valueCents ?? 0,
  dayOfMonth: Number(v.dayOfMonth),
  endMonth: v.endMonth || null,
});

export function RecurrenceFormSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void; recurrence?: RecurrenceDto }) {
  const { createRecurrence } = useExpenseMutations();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<RecurrenceValues>({ resolver: zodFormResolver<RecurrenceValues>(RecurrenceCreateSchema, recurrencePayload) });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    const today = todayInSaoPaulo();
    form.reset({ description: '', categoryId: '', supplier: '', valueCents: null, dayOfMonth: Number(today.slice(8, 10)), startMonth: today.slice(0, 7), endMonth: '' });
  }, [open, form]);

  async function onSubmit(v: RecurrenceValues) {
    setFormError(null);
    try {
      await createRecurrence.mutateAsync(RecurrenceCreateSchema.parse(recurrencePayload(v)));
      toast.success('Recorrência criada. A despesa do mês já foi lançada.');
      onOpenChange(false);
    } catch (error) {
      if (!applyApiError(error, form.setError, ['description', 'categoryId', 'valueCents', 'dayOfMonth', 'startMonth', 'endMonth'])) setFormError(errorMessage(error));
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>Nova despesa recorrente</SheetTitle>
          <SheetDescription>Gera a despesa automaticamente todo mês. Dia 29–31 vira o último dia em meses mais curtos.</SheetDescription>
        </SheetHeader>
        <form id="recurrence-form" noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex-1 space-y-4 overflow-y-auto p-4">
          <FormField id="rec-description" label="Descrição" error={errors.description?.message}>
            <Input {...fieldAria('rec-description', errors.description?.message)} {...form.register('description')} />
          </FormField>
          <FormField id="rec-category" label="Categoria" error={errors.categoryId?.message}>
            <Controller control={form.control} name="categoryId" render={({ field }) => (
              <CategorySelect id="rec-category" value={field.value} onChange={field.onChange} error={errors.categoryId?.message} />
            )} />
          </FormField>
          <FormField id="rec-supplier" label="Fornecedor">
            <Input id="rec-supplier" {...form.register('supplier')} />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField id="rec-value" label="Valor" error={errors.valueCents?.message}>
              <Controller control={form.control} name="valueCents" render={({ field }) => (
                <MoneyInput {...fieldAria('rec-value', errors.valueCents?.message)} value={field.value} onChange={field.onChange} />
              )} />
            </FormField>
            <FormField id="rec-day" label="Dia do vencimento" error={errors.dayOfMonth?.message}>
              <Input {...fieldAria('rec-day', errors.dayOfMonth?.message)} type="number" min={1} max={31} {...form.register('dayOfMonth', { valueAsNumber: true })} />
            </FormField>
            <FormField id="rec-start" label="Mês inicial" error={errors.startMonth?.message}>
              <Input {...fieldAria('rec-start', errors.startMonth?.message)} type="month" {...form.register('startMonth')} />
            </FormField>
            <FormField id="rec-end" label="Mês final (opcional)" error={errors.endMonth?.message}>
              <Input {...fieldAria('rec-end', errors.endMonth?.message)} type="month" {...form.register('endMonth')} />
            </FormField>
          </div>
          <FormError message={formError} />
        </form>
        <SheetFooter className="flex-row justify-end border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="submit" form="recurrence-form" disabled={isSubmitting}>
            {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden />}
            Criar recorrência
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
