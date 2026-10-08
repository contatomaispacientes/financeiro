import { useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ChevronDown, CodeXml, LoaderCircle, Plus, TriangleAlert, X } from 'lucide-react';
import {
  addDays,
  calculatePlan,
  ChargePlanSchema,
  todayInSaoPaulo,
  type BillingType,
  type ChargeCreateFailureDetails,
  type ChargeType,
  type Cycle,
  type ChargeCreateRequest,
  type ChargeDetailDto,
  type ChargePlan,
  type ChargePlanInput,
  type ServiceListItemDto,
  type SettingsDto,
} from '@financeiro/shared';
import { DatePicker } from '@/components/date-picker';
import { useEnvironment } from '@/components/environment-badge';
import { FormField, fieldAria } from '@/components/form-field';
import { MoneyInput } from '@/components/money-input';
import { PageHeader } from '@/components/page-header';
import { ErrorState, TableSkeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/http';
import { errorMessage } from '@/lib/form-errors';
import { formatBRL, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useSettings } from '@/features/settings/api';
import {
  useActiveServices,
  useChargeAction,
  useChargePreview,
  useCreateCharge,
  usePreselectedCustomer,
} from './api';
import { ChargeCreated } from './ChargeCreated';
import { CustomerPicker, type PickedCustomer } from './CustomerPicker';
import { billingTypeLabels, cycleLabels } from './labels';
import { useDebouncedValue } from './use-debounced-value';

interface ItemValues {
  serviceId: string | null;
  description: string;
  quantity: number;
  unitPriceCents: number | null;
}

interface FormValues {
  items: ItemValues[];
  type: ChargeType;
  installmentCount: number;
  cycle: Cycle;
  endDate: string | null;
  billingType: BillingType;
  dueDate: string | null;
  discountCents: number | null;
  finePct: number;
  interestPct: number;
}

const BILLING_TYPES: BillingType[] = ['PIX', 'BOLETO', 'CREDIT_CARD', 'UNDEFINED'];

const billingHelp: Record<BillingType, string> = {
  PIX: 'QR Code e Pix copia-e-cola na fatura.',
  BOLETO: 'Linha digitável e PDF; compensa em até 3 dias úteis.',
  CREDIT_CARD: 'O cliente paga com cartão de crédito pela fatura.',
  UNDEFINED: 'Na fatura, o cliente escolhe Pix, boleto ou cartão.',
};

const MAX_QUANTITY = 999;
const safeNumber = (n: number) => (Number.isFinite(n) ? n : 0);

function toPlan(v: FormValues): ChargePlanInput {
  return {
    items: v.items.map((i) => ({
      ...(i.serviceId ? { serviceId: i.serviceId } : {}),
      description: i.description,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents ?? 0,
    })),
    type: v.type,
    ...(v.type === 'INSTALLMENT' && { installmentCount: v.installmentCount }),
    ...(v.type === 'RECURRING' && { cycle: v.cycle, ...(v.endDate && { endDate: v.endDate }) }),
    billingType: v.billingType,
    dueDate: { mode: 'FIXED_DATE', date: v.dueDate ?? '' },
    discountCents: v.discountCents ?? 0,
    finePct: v.finePct,
    interestPct: v.interestPct,
  };
}

interface Problem {
  field: string;
  message: string;
  summary: string;
}

/** Leva o problema do zod ao campo do formulário, com mensagem que faz sentido para quem digita. */
function describeIssue(issue: { path: PropertyKey[]; code: string; message: string }): Problem {
  const [head, index, key] = issue.path;
  const notANumber = issue.code === 'invalid_type';
  if (head === 'items' && typeof index === 'number') {
    const message = key === 'quantity' && notANumber ? 'Quantidade de 1 a 999' : issue.message;
    return { field: `items.${index}.${String(key)}`, message, summary: `Item ${index + 1}: ${message}` };
  }
  if (head === 'dueDate') return { field: 'dueDate', message: 'Informe o vencimento', summary: 'Informe o vencimento' };
  if (head === 'installmentCount') return { field: 'installmentCount', message: 'De 2 a 12 parcelas', summary: 'Parcelas: de 2 a 12' };
  const message = notANumber ? 'Informe um valor de 0 a 10' : issue.message;
  return { field: String(head), message, summary: message };
}

export function NewChargePage() {
  const [params, setParams] = useSearchParams();
  const preselectId = params.get('cliente');
  const settings = useSettings();
  const environment = useEnvironment();
  const preselected = usePreselectedCustomer(preselectId);
  const [created, setCreated] = useState<ChargeDetailDto | null>(null);
  const [formKey, setFormKey] = useState(0);

  if (created) {
    return (
      <ChargeCreated
        charge={created}
        onCreateAnother={() => {
          setCreated(null);
          setFormKey((k) => k + 1);
          setParams({}, { replace: true });
        }}
      />
    );
  }

  const header = (
    <PageHeader title="Nova cobrança" description="Monte a cobrança, confira o resumo e gere no Asaas. O cliente recebe o link da fatura." />
  );

  if (settings.isPending || environment.isPending || (preselectId && preselected.isPending)) {
    return (
      <>
        {header}
        <TableSkeleton rows={8} />
      </>
    );
  }
  if (settings.isError || environment.isError) {
    const failed = settings.isError ? settings : environment;
    return (
      <>
        {header}
        <ErrorState error={failed.error} onRetry={() => failed.refetch()} />
      </>
    );
  }

  let initialCustomer: PickedCustomer | null = null;
  let customerNotice: string | null = null;
  if (preselectId) {
    if (preselected.data?.archivedAt) customerNotice = `${preselected.data.name} está arquivado e não pode receber cobranças.`;
    else if (preselected.data) initialCustomer = preselected.data;
    else customerNotice = 'O cliente do link não foi encontrado. Escolha outro.';
  }

  return (
    <>
      {header}
      <ChargeForm
        key={formKey}
        settings={settings.data}
        minChargeCents={environment.data.minChargeCents}
        sandbox={environment.data.asaasEnv !== 'production'}
        initialCustomer={initialCustomer}
        customerNotice={customerNotice}
        onCreated={setCreated}
      />
    </>
  );
}

function ChargeForm({
  settings,
  minChargeCents,
  sandbox,
  initialCustomer,
  customerNotice,
  onCreated,
}: {
  settings: SettingsDto;
  minChargeCents: number;
  sandbox: boolean;
  initialCustomer: PickedCustomer | null;
  customerNotice: string | null;
  onCreated: (charge: ChargeDetailDto) => void;
}) {
  const [today] = useState(todayInSaoPaulo);
  const [customer, setCustomer] = useState(initialCustomer);
  const [draft, setDraft] = useState<{ chargeId: string; message: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const create = useCreateCharge();
  const action = useChargeAction();
  const services = useActiveServices();

  // COB-01.3: vencimento, multa e juros vêm dos padrões das Configurações.
  const form = useForm<FormValues>({
    defaultValues: {
      items: [],
      type: 'SINGLE',
      installmentCount: 3,
      cycle: 'MONTHLY',
      endDate: null,
      billingType: 'PIX',
      dueDate: addDays(today, settings.defaultDueDays),
      discountCents: null,
      finePct: settings.defaultFinePct,
      interestPct: settings.defaultInterestPct,
    },
  });
  const items = useFieldArray({ control: form.control, name: 'items' });
  const values = form.watch();
  const touched = form.formState.touchedFields;

  const plan = toPlan(values);
  const parsed = ChargePlanSchema.safeParse(plan);
  const calc = calculatePlan(
    parsed.success
      ? parsed.data
      : ({ ...plan, items: plan.items.map((i) => ({ ...i, quantity: safeNumber(i.quantity) })) } as ChargePlan),
    { today, minChargeCents },
  );

  const problems = parsed.success ? [] : parsed.error.issues.map(describeIssue);
  const fieldErrors = new Map<string, string>();
  for (const p of problems) if (!fieldErrors.has(p.field)) fieldErrors.set(p.field, p.message);
  if (!calc.ok && calc.error.code === 'DUE_DATE_IN_PAST' && values.dueDate) fieldErrors.set('dueDate', calc.error.message);
  if (!calc.ok && calc.error.code === 'DISCOUNT_EXCEEDS_SUBTOTAL') fieldErrors.set('discountCents', calc.error.message);
  if (!calc.ok && calc.error.code === 'END_DATE_BEFORE_FIRST_DUE') fieldErrors.set('endDate', calc.error.message);

  const subtotalCents = values.items.reduce((sum, i) => sum + safeNumber(i.quantity) * (i.unitPriceCents ?? 0), 0);
  const discountCents = values.discountCents ?? 0;
  const totals = calc.ok ? calc.value : { subtotalCents, discountCents, totalCents: Math.max(0, subtotalCents - discountCents) };

  const status: { tone: 'hint' | 'error'; message: string } | null =
    parsed.success && !calc.ok
      ? { tone: 'error', message: calc.error.message }
      : !customer
        ? { tone: 'hint', message: 'Selecione o cliente para gerar a cobrança.' }
        : problems[0]
          ? { tone: 'hint', message: problems[0].summary }
          : null;

  const request: ChargeCreateRequest | null =
    customer && parsed.success && calc.ok ? { customerId: customer.id, plan: parsed.data } : null;
  const locked = draft !== null || create.isPending;

  /** COB-01.2: preço padrão editável; o mesmo serviço de novo soma na quantidade. */
  function addService(service: ServiceListItemDto) {
    const index = form.getValues('items').findIndex((i) => i.serviceId === service.id);
    if (index >= 0) {
      const quantity = safeNumber(form.getValues(`items.${index}.quantity`));
      form.setValue(`items.${index}.quantity`, Math.min(MAX_QUANTITY, quantity + 1), { shouldDirty: true });
    } else {
      items.append(
        { serviceId: service.id, description: service.name, quantity: 1, unitPriceCents: service.defaultPriceCents },
        { shouldFocus: false },
      );
    }
  }

  async function generate() {
    if (!request) return;
    setSubmitError(null);
    try {
      const { charges } = await create.mutateAsync(request);
      if (charges[0]) onCreated(charges[0]);
      else toast.success('Recorrência criada. As cobranças aparecem conforme o Asaas gerar.');
    } catch (error) {
      // COB-12.1: o Asaas falhou e o rascunho ficou em DRAFT; o usuário decide tentar de novo ou descartar.
      const details = error instanceof ApiError ? (error.details as Partial<ChargeCreateFailureDetails> | undefined) : undefined;
      const chargeId = details?.chargeIds?.[0];
      if (error instanceof ApiError && chargeId) setDraft({ chargeId, message: error.message });
      else if (details?.subscriptionId) {
        setSubmitError(`${errorMessage(error)} A recorrência ficou salva em Recorrências: dá para tentar de novo por lá, sem duplicar.`);
      } else setSubmitError(errorMessage(error));
    }
  }

  async function retry() {
    if (!draft) return;
    try {
      const charge = await action.mutateAsync({ id: draft.chargeId, action: 'retry' });
      if (charge.status === 'DRAFT') setDraft({ ...draft, message: charge.lastError ?? draft.message });
      else onCreated(charge);
    } catch (error) {
      setDraft({ ...draft, message: errorMessage(error) });
    }
  }

  async function discard() {
    if (!draft) return;
    try {
      await action.mutateAsync({ id: draft.chargeId, action: 'discard' });
      setDraft(null);
      toast.success('Rascunho descartado. Ajuste o que precisar e gere de novo.');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  const fieldError = (name: string) => fieldErrors.get(name);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <fieldset disabled={locked} className="m-0 min-w-0 space-y-6 border-0 p-0">
        <Section step={1} title="Cliente">
          {customerNotice && !customer && (
            <p role="status" className="mb-3 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200 ring-inset">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {customerNotice}
            </p>
          )}
          <CustomerPicker value={customer} onChange={setCustomer} />
        </Section>

        <Section step={2} title="Serviços" description="Toque num serviço do catálogo para adicionar; preço e quantidade são editáveis.">
          <ServiceChips services={services} onAdd={addService} />

          <div className="mt-4">
            <div
              aria-hidden
              className="hidden gap-2 border-b pb-2 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1fr)_4.5rem_8.5rem_6.5rem_2rem]"
            >
              <span>Descrição</span>
              <span>Qtd</span>
              <span>Preço unit.</span>
              <span className="text-right">Total</span>
            </div>
            {items.fields.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nenhum item ainda. Escolha um serviço acima ou adicione um item livre.
              </p>
            ) : (
              <ul className="divide-y">
                {items.fields.map((field, index) => {
                  const item = values.items[index];
                  const n = index + 1;
                  const descriptionError = touched.items?.[index]?.description ? fieldError(`items.${index}.description`) : undefined;
                  const quantityError = fieldError(`items.${index}.quantity`);
                  const priceError = fieldError(`items.${index}.unitPriceCents`);
                  return (
                    <li
                      key={field.id}
                      className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-start gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_4.5rem_8.5rem_6.5rem_2rem]"
                    >
                      <div className="col-span-2 sm:col-span-1">
                        <label htmlFor={`item-${index}-description`} className="sr-only">
                          Descrição do item {n}
                        </label>
                        <Input
                          {...fieldAria(`item-${index}-description`, descriptionError)}
                          placeholder="Descrição"
                          maxLength={120}
                          {...form.register(`items.${index}.description`)}
                        />
                        {descriptionError && (
                          <p id={`item-${index}-description-error`} className="mt-1 text-xs text-destructive">
                            {descriptionError}
                          </p>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="col-start-3 row-start-1 justify-self-end text-muted-foreground hover:text-destructive sm:col-start-5"
                        aria-label={`Remover item ${n}`}
                        onClick={() => items.remove(index)}
                      >
                        <X aria-hidden />
                      </Button>
                      <div className="sm:col-start-2 sm:row-start-1">
                        <label htmlFor={`item-${index}-quantity`} className="text-xs text-muted-foreground sm:sr-only">
                          Quantidade<span className="sr-only"> do item {n}</span>
                        </label>
                        <Input
                          {...fieldAria(`item-${index}-quantity`, quantityError)}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={MAX_QUANTITY}
                          step={1}
                          className="tabular"
                          {...form.register(`items.${index}.quantity`, { valueAsNumber: true })}
                        />
                      </div>
                      <div className="sm:col-start-3 sm:row-start-1">
                        <label htmlFor={`item-${index}-price`} className="text-xs text-muted-foreground sm:sr-only">
                          Preço unitário<span className="sr-only"> do item {n}</span>
                        </label>
                        <Controller
                          control={form.control}
                          name={`items.${index}.unitPriceCents`}
                          render={({ field: price }) => (
                            <MoneyInput
                              {...fieldAria(`item-${index}-price`, priceError)}
                              value={price.value}
                              onChange={price.onChange}
                              onBlur={price.onBlur}
                              placeholder="R$ 0,00"
                            />
                          )}
                        />
                      </div>
                      <p className="self-end text-right sm:col-start-4 sm:row-start-1 sm:self-start">
                        <span className="text-xs text-muted-foreground sm:sr-only">Total </span>
                        <span className="tabular block text-sm leading-8 font-medium">
                          {formatBRL(safeNumber(item?.quantity ?? 0) * (item?.unitPriceCents ?? 0))}
                        </span>
                      </p>
                      {quantityError && (
                        <p className="col-span-3 text-xs text-destructive sm:col-span-5">{quantityError}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() =>
                items.append(
                  { serviceId: null, description: '', quantity: 1, unitPriceCents: null },
                  { focusName: `items.${items.fields.length}.description` },
                )
              }
            >
              <Plus aria-hidden />
              Item livre
            </Button>
          </div>
        </Section>

        <Section step={3} title="Condições">
          <div className="space-y-5">
            <Segmented label="Tipo">
              <SegmentOption value="SINGLE" label="Avulsa" {...form.register('type')} />
              <SegmentOption value="INSTALLMENT" label="Parcelada" {...form.register('type')} />
              <SegmentOption value="RECURRING" label="Recorrente" {...form.register('type')} />
            </Segmented>

            {values.type === 'INSTALLMENT' && (
              <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
                <FormField id="charge-installments" label="Parcelas" error={fieldError('installmentCount')} description="De 2 a 12, mensais.">
                  <Input
                    {...fieldAria('charge-installments', fieldError('installmentCount'))}
                    type="number"
                    inputMode="numeric"
                    min={2}
                    max={12}
                    step={1}
                    className="tabular"
                    {...form.register('installmentCount', { valueAsNumber: true })}
                  />
                </FormField>
                {calc.ok && (
                  <ol aria-label="Parcelas" className="tabular grid content-start gap-x-4 text-sm sm:grid-cols-2">
                    {calc.value.installments.map((p) => (
                      <li key={p.number} className="flex justify-between gap-3 border-b py-1">
                        <span className="text-muted-foreground">
                          {p.number}ª · {formatDate(p.dueDate)}
                        </span>
                        <span>{formatBRL(p.valueCents)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}

            {values.type === 'RECURRING' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField id="charge-cycle" label="Ciclo">
                  <select
                    id="charge-cycle"
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    {...form.register('cycle')}
                  >
                    {Object.entries(cycleLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField id="charge-end-date" label="Data final (opcional)" error={fieldError('endDate')} description="Sem data final, segue até ser cancelada.">
                  <Controller
                    control={form.control}
                    name="endDate"
                    render={({ field }) => (
                      <DatePicker
                        {...fieldAria('charge-end-date', fieldError('endDate'))}
                        min={values.dueDate ?? today}
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                      />
                    )}
                  />
                </FormField>
              </div>
            )}

            <Segmented label="Forma de pagamento" description={billingHelp[values.billingType]} columns="grid-cols-2 sm:grid-cols-4">
              {BILLING_TYPES.map((type) => (
                <SegmentOption key={type} value={type} label={billingTypeLabels[type]} {...form.register('billingType')} />
              ))}
            </Segmented>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                id="charge-due-date"
                label="Vencimento"
                error={fieldError('dueDate')}
                description={`Padrão: ${settings.defaultDueDays} ${settings.defaultDueDays === 1 ? 'dia' : 'dias'} após hoje.`}
              >
                <Controller
                  control={form.control}
                  name="dueDate"
                  render={({ field }) => (
                    <DatePicker
                      {...fieldAria('charge-due-date', fieldError('dueDate'), true)}
                      min={today}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                    />
                  )}
                />
              </FormField>
              <FormField id="charge-discount" label="Desconto" error={fieldError('discountCents')}>
                <Controller
                  control={form.control}
                  name="discountCents"
                  render={({ field }) => (
                    <MoneyInput
                      {...fieldAria('charge-discount', fieldError('discountCents'))}
                      placeholder="R$ 0,00"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                    />
                  )}
                />
              </FormField>
              <FormField id="charge-fine" label="Multa por atraso" error={fieldError('finePct')}>
                <Suffixed suffix="%">
                  <Input
                    {...fieldAria('charge-fine', fieldError('finePct'))}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min={0}
                    max={10}
                    className="tabular pr-8"
                    {...form.register('finePct', { valueAsNumber: true })}
                  />
                </Suffixed>
              </FormField>
              <FormField id="charge-interest" label="Juros ao mês" error={fieldError('interestPct')}>
                <Suffixed suffix="%">
                  <Input
                    {...fieldAria('charge-interest', fieldError('interestPct'))}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min={0}
                    max={10}
                    className="tabular pr-8"
                    {...form.register('interestPct', { valueAsNumber: true })}
                  />
                </Suffixed>
              </FormField>
            </div>
          </div>
        </Section>
      </fieldset>

      <aside className="space-y-4 lg:sticky lg:top-6">
        <section aria-labelledby="charge-summary" className="rounded-lg border bg-card p-4 sm:p-5">
          <h2 id="charge-summary" className="font-medium">
            Resumo
          </h2>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">{customer ? customer.name : 'Nenhum cliente selecionado'}</p>

          <dl className="mt-4 space-y-2 text-sm">
            <SummaryRow label="Subtotal">{formatBRL(totals.subtotalCents)}</SummaryRow>
            <SummaryRow label="Desconto">{totals.discountCents > 0 ? `− ${formatBRL(totals.discountCents)}` : formatBRL(0)}</SummaryRow>
            <div className="flex items-baseline justify-between gap-3 border-t pt-3">
              <dt className="font-medium">Total</dt>
              <dd className="tabular text-2xl font-semibold">{formatBRL(totals.totalCents)}</dd>
            </div>
            {values.type === 'INSTALLMENT' && calc.ok && (
              <SummaryRow label="Parcelas">
                {calc.value.installments.length}× de {formatBRL(calc.value.installments[0]!.valueCents)}
              </SummaryRow>
            )}
            {values.type === 'RECURRING' && (
              <SummaryRow label="Repete">
                <span className="font-sans">{cycleLabels[values.cycle]}</span>
              </SummaryRow>
            )}
            <SummaryRow label={values.type === 'SINGLE' ? 'Vencimento' : '1º vencimento'}>
              {values.dueDate ? formatDate(values.dueDate) : '—'}
            </SummaryRow>
            <SummaryRow label="Forma">
              <span className="font-sans">{billingTypeLabels[values.billingType]}</span>
            </SummaryRow>
          </dl>

          <p
            aria-live="polite"
            className={cn('text-sm', status && 'mt-4', status?.tone === 'error' ? 'text-destructive' : 'text-muted-foreground')}
          >
            {status?.message}
          </p>

          {draft ? (
            <div role="alert" className="mt-4 space-y-3 rounded-md bg-destructive/10 p-3 text-sm">
              <p className="font-medium text-destructive">O Asaas não aceitou a cobrança</p>
              <p className="text-destructive">{draft.message}</p>
              <p className="text-muted-foreground">O rascunho ficou guardado. Tentar de novo não duplica a cobrança no Asaas.</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={retry} disabled={action.isPending}>
                  {action.isPending && action.variables?.action === 'retry' && <LoaderCircle aria-hidden className="animate-spin" />}
                  Tentar de novo
                </Button>
                <Button type="button" variant="outline" onClick={discard} disabled={action.isPending}>
                  Descartar
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Button type="button" size="lg" className="mt-4 w-full" disabled={!request || create.isPending} onClick={generate}>
                {create.isPending && <LoaderCircle aria-hidden className="animate-spin" />}
                {create.isPending ? 'Gerando no Asaas…' : values.type === 'RECURRING' ? 'Criar recorrência no Asaas' : 'Gerar cobrança no Asaas'}
              </Button>
              {submitError && (
                <p role="alert" className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {submitError}
                </p>
              )}
            </>
          )}
          {sandbox && <p className="mt-3 text-center text-xs text-muted-foreground">Asaas de teste: nada é cobrado de verdade.</p>}
        </section>

        <ApiPreview request={request} />
      </aside>
    </div>
  );
}

function Section({ step, title, description, children }: { step: number; title: string; description?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`charge-step-${step}`} className="rounded-lg border bg-card p-4 sm:p-5">
      <header className="mb-4 flex items-start gap-3">
        <span aria-hidden className="tabular grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
          {step}
        </span>
        <div className="min-w-0">
          <h2 id={`charge-step-${step}`} className="leading-6 font-medium">
            {title}
          </h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular text-right">{children}</dd>
    </div>
  );
}

function Suffixed({ suffix, children }: { suffix: string; children: ReactNode }) {
  return (
    <div className="relative">
      {children}
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-sm text-muted-foreground">
        {suffix}
      </span>
    </div>
  );
}

function Segmented({
  label,
  description,
  columns = 'grid-cols-3',
  children,
}: {
  label: string;
  description?: string;
  columns?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className={cn('grid gap-1 rounded-lg bg-muted p-1', columns)}>{children}</div>
      {description && <p className="mt-2 text-sm text-muted-foreground">{description}</p>}
    </fieldset>
  );
}

/** Rádio nativo com cara de botão segmentado: setas do teclado e leitor de tela funcionam de graça. */
function SegmentOption({ label, note, ...input }: { label: string; note?: string } & ComponentProps<'input'>) {
  return (
    <label
      className={cn(
        'relative flex min-h-9 cursor-pointer flex-col items-center justify-center rounded-md px-2 py-1 text-center text-sm text-muted-foreground transition-colors',
        'hover:text-foreground has-checked:bg-card has-checked:font-medium has-checked:text-foreground has-checked:shadow-sm',
        'has-focus-visible:ring-3 has-focus-visible:ring-ring/50 has-disabled:cursor-not-allowed has-disabled:opacity-60 has-disabled:hover:text-muted-foreground',
      )}
    >
      <input type="radio" className="sr-only" {...input} />
      <span>{label}</span>
      {note && <span className="text-[0.6875rem] leading-tight">{note}</span>}
    </label>
  );
}

function ServiceChips({
  services,
  onAdd,
}: {
  services: ReturnType<typeof useActiveServices>;
  onAdd: (service: ServiceListItemDto) => void;
}) {
  if (services.isPending) {
    return (
      <div className="flex flex-wrap gap-2" role="status" aria-label="Carregando catálogo">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-8 w-36 rounded-full" />
        ))}
      </div>
    );
  }
  if (services.isError) {
    return (
      <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        Não foi possível carregar o catálogo. Dá para seguir com item livre.
        <Button type="button" variant="outline" size="sm" onClick={() => services.refetch()}>
          Tentar de novo
        </Button>
      </p>
    );
  }
  if (services.data.data.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum serviço ativo no catálogo. Use um item livre.</p>;
  }
  return (
    <div role="group" aria-label="Catálogo de serviços" className="flex flex-wrap gap-2">
      {services.data.data.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onAdd(s)}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-background py-1 pr-3 pl-2 text-sm transition-colors outline-none hover:border-primary/40 hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
        >
          <Plus aria-hidden className="size-3.5 shrink-0 text-primary" />
          <span className="truncate">{s.name}</span>
          <span className="tabular shrink-0 text-xs text-muted-foreground">{formatBRL(s.defaultPriceCents)}</span>
        </button>
      ))}
    </div>
  );
}

/** Bloco "Chamada à API" (COB-01.4): o que será enviado ao Asaas, pela prévia com debounce de 500 ms. */
function ApiPreview({ request }: { request: ChargeCreateRequest | null }) {
  const key = request ? JSON.stringify(request) : null;
  const debouncedKey = useDebouncedValue(key, 500);
  const debounced = useMemo(() => (debouncedKey ? (JSON.parse(debouncedKey) as ChargeCreateRequest) : null), [debouncedKey]);
  const preview = useChargePreview(debounced);
  const updating = key !== debouncedKey || preview.isFetching;

  return (
    <details className="group rounded-lg border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <CodeXml aria-hidden className="size-4 text-muted-foreground" />
          Chamada à API
        </span>
        <ChevronDown aria-hidden className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-3 border-t px-4 py-3 text-sm">
        {!request ? (
          <p className="text-muted-foreground">Complete cliente, itens e condições para ver o que será enviado ao Asaas.</p>
        ) : preview.isError ? (
          <p role="alert" className="text-destructive">
            {errorMessage(preview.error)}
          </p>
        ) : !preview.data ? (
          <p className="text-muted-foreground">Calculando…</p>
        ) : (
          <>
            {updating && <p className="text-xs text-muted-foreground">Atualizando…</p>}
            {preview.data.customerWillBeCreated && (
              <p className="text-xs text-muted-foreground">Inclui o cadastro do cliente no Asaas.</p>
            )}
            {preview.data.asaasRequests.map((r, i) => (
              <div key={i}>
                <p className="tabular text-xs font-semibold">
                  <span className="text-primary">{r.method}</span> {r.path}
                </p>
                {r.body !== undefined && (
                  <pre className="tabular mt-1 max-h-72 overflow-auto rounded-md bg-muted p-2 text-[0.6875rem] leading-relaxed">
                    {JSON.stringify(r.body, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </details>
  );
}
