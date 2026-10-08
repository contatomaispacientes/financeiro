import { useEffect, useState, type ReactNode } from 'react';
import { useForm, type FieldErrors, type Resolver } from 'react-hook-form';
import { toast } from 'sonner';
import { LoaderCircle } from 'lucide-react';
import { onlyDigits, SettingsUpdateSchema, type SettingsDto } from '@financeiro/shared';
import { FormField, fieldAria } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { applyApiError, errorMessage } from '@/lib/form-errors';
import { useUpdateSettings } from './api';

interface FormValues {
  companyName: string;
  companyDocument: string;
  companyCity: string;
  defaultDueDays: number;
  defaultFinePct: number;
  defaultInterestPct: number;
  contractChargeDueDays: number;
  companySignerName: string;
  companySignerEmail: string;
  companySignerPhone: string;
}

const FIELDS = [
  'companyName',
  'companyDocument',
  'companyCity',
  'defaultDueDays',
  'defaultFinePct',
  'defaultInterestPct',
  'contractChargeDueDays',
  'companySignerName',
  'companySignerEmail',
  'companySignerPhone',
] as const satisfies readonly (keyof FormValues)[];

function toForm(s: SettingsDto): FormValues {
  return {
    companyName: s.companyName ?? '',
    companyDocument: s.companyDocument ?? '',
    companyCity: s.companyCity ?? '',
    defaultDueDays: s.defaultDueDays,
    defaultFinePct: s.defaultFinePct,
    defaultInterestPct: s.defaultInterestPct,
    contractChargeDueDays: s.contractChargeDueDays,
    companySignerName: s.companySignerName ?? '',
    companySignerEmail: s.companySignerEmail ?? '',
    companySignerPhone: s.companySignerPhone ?? '',
  };
}

/** Campo vazio vira `null` (apaga); telefone aceita máscara. Depois valida com o schema da API. */
function toPayload(v: FormValues) {
  const text = (value: string) => (value.trim() === '' ? null : value);
  return {
    companyName: text(v.companyName),
    companyDocument: text(v.companyDocument),
    companyCity: text(v.companyCity),
    defaultDueDays: v.defaultDueDays,
    defaultFinePct: v.defaultFinePct,
    defaultInterestPct: v.defaultInterestPct,
    contractChargeDueDays: v.contractChargeDueDays,
    companySignerName: text(v.companySignerName),
    companySignerEmail: text(v.companySignerEmail),
    companySignerPhone: text(onlyDigits(v.companySignerPhone)),
  };
}

const resolver: Resolver<FormValues> = async (values) => {
  const result = SettingsUpdateSchema.safeParse(toPayload(values));
  if (result.success) return { values, errors: {} };

  const errors: FieldErrors<FormValues> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as keyof FormValues | undefined;
    if (field && !errors[field]) errors[field] = { type: issue.code, message: issue.message };
  }
  return { values: {}, errors };
};

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="grid gap-6 border-b py-6 last:border-0 md:grid-cols-[16rem_1fr]">
      <div>
        <h2 className="font-medium">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
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

export function GeneralSettingsForm({ settings, canEdit }: { settings: SettingsDto; canEdit: boolean }) {
  const update = useUpdateSettings();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormValues>({ resolver, defaultValues: toForm(settings) });
  const { errors, isSubmitting, isDirty } = form.formState;

  useEffect(() => {
    form.reset(toForm(settings));
  }, [settings, form]);

  async function onSubmit(values: FormValues) {
    setFormError(null);
    try {
      const saved = await update.mutateAsync(SettingsUpdateSchema.parse(toPayload(values)));
      form.reset(toForm(saved));
      toast.success('Configurações salvas.');
    } catch (error) {
      if (!applyApiError(error, form.setError, FIELDS)) setFormError(errorMessage(error));
    }
  }

  const text = (name: (typeof FIELDS)[number], label: string, props: Record<string, unknown> = {}, description?: string) => (
    <FormField id={name} label={label} error={errors[name]?.message} description={description}>
      <Input {...fieldAria(name, errors[name]?.message, Boolean(description))} {...props} {...form.register(name)} />
    </FormField>
  );

  const number = (
    name: (typeof FIELDS)[number],
    label: string,
    suffix: string,
    step: string,
    description?: string,
  ) => (
    <FormField id={name} label={label} error={errors[name]?.message} description={description}>
      <Suffixed suffix={suffix}>
        <Input
          {...fieldAria(name, errors[name]?.message, Boolean(description))}
          type="number"
          inputMode="decimal"
          step={step}
          min={0}
          className="tabular pr-14"
          {...form.register(name, { valueAsNumber: true })}
        />
      </Suffixed>
    </FormField>
  );

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="rounded-lg border bg-card px-6">
      {!canEdit && (
        <p className="mt-6 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          Somente administradores alteram as configurações.
        </p>
      )}

      <fieldset disabled={!canEdit} className="contents">
        <Section title="Empresa" description="Aparece nos contratos e nas mensagens ao cliente.">
          {text('companyName', 'Nome da empresa', { autoComplete: 'organization' })}
          {text('companyDocument', 'CPF ou CNPJ', { inputMode: 'numeric' }, 'Pode digitar com pontos e traços.')}
          {text('companyCity', 'Cidade', {}, 'Usada como local de assinatura dos contratos.')}
        </Section>

        <Section
          title="Padrões de cobrança"
          description="Valores sugeridos na Nova cobrança; dá para mudar em cada cobrança."
        >
          {number('defaultDueDays', 'Vencimento padrão', 'dias', '1', 'Dias após a emissão.')}
          {number('defaultFinePct', 'Multa por atraso', '%', '0.01', 'Até 10%.')}
          {number('defaultInterestPct', 'Juros ao mês', '%', '0.01', 'Até 10% ao mês.')}
        </Section>

        <Section
          title="Contratos"
          description="Cobrança gerada na assinatura e quem assina pela empresa."
        >
          {number('contractChargeDueDays', 'Vencimento após a assinatura', 'dias', '1')}
          <div className="hidden sm:block" />
          {text('companySignerName', 'Signatário da empresa', { autoComplete: 'name' })}
          {text('companySignerEmail', 'E-mail do signatário', { type: 'email', autoComplete: 'email' })}
          {text('companySignerPhone', 'Celular do signatário', { type: 'tel', autoComplete: 'tel' }, 'Com DDD.')}
        </Section>
      </fieldset>

      {canEdit && (
        <div className="flex flex-col-reverse items-stretch gap-3 border-t py-4 sm:flex-row sm:items-center sm:justify-end">
          {formError && (
            <p role="alert" className="text-sm text-destructive sm:mr-auto">
              {formError}
            </p>
          )}
          <Button type="button" variant="outline" disabled={!isDirty || isSubmitting} onClick={() => form.reset(toForm(settings))}>
            Descartar
          </Button>
          <Button type="submit" disabled={!isDirty || isSubmitting}>
            {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden />}
            Salvar alterações
          </Button>
        </div>
      )}
    </form>
  );
}
