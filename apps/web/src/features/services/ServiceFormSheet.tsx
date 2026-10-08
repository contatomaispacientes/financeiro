import { useEffect, useState } from 'react';
import { Controller, useForm, type FieldErrors, type Resolver } from 'react-hook-form';
import { toast } from 'sonner';
import { LoaderCircle } from 'lucide-react';
import { ServiceCreateSchema, ServiceUpdateSchema, type ServiceDto } from '@financeiro/shared';
import { FormField, fieldAria } from '@/components/form-field';
import { MoneyInput } from '@/components/money-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { applyApiError, errorMessage } from '@/lib/form-errors';
import { ApiError } from '@/lib/http';
import { useCreateService, useUpdateService } from './api';

interface FormValues {
  name: string;
  description: string;
  defaultPriceCents: number | null;
  active: boolean;
}

const FIELDS = ['name', 'description', 'defaultPriceCents'] as const;

function toForm(s?: ServiceDto): FormValues {
  return {
    name: s?.name ?? '',
    description: s?.description ?? '',
    defaultPriceCents: s?.defaultPriceCents ?? null,
    active: s?.active ?? true,
  };
}

// Campo vazio vira 0 para cair na mensagem "Informe um preço maior que zero".
const toPayload = (v: FormValues) => ({ ...v, defaultPriceCents: v.defaultPriceCents ?? 0 });

function resolverFor(editing: boolean): Resolver<FormValues> {
  const schema = editing ? ServiceUpdateSchema : ServiceCreateSchema;
  return async (values) => {
    const result = schema.safeParse(toPayload(values));
    if (result.success) return { values, errors: {} };
    const errors: FieldErrors<FormValues> = {};
    for (const issue of result.error.issues) {
      const field = issue.path[0] as keyof FormValues | undefined;
      if (field && !errors[field]) errors[field] = { type: issue.code, message: issue.message };
    }
    return { values: {}, errors };
  };
}

export function ServiceFormSheet({
  service,
  open,
  onOpenChange,
}: {
  service?: ServiceDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const editing = Boolean(service);
  const create = useCreateService();
  const update = useUpdateService(service?.id ?? '');
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<FormValues>({ resolver: resolverFor(editing), defaultValues: toForm(service) });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    if (!open) return;
    form.reset(toForm(service));
    setFormError(null);
  }, [open, service, form]);

  async function onSubmit(values: FormValues) {
    setFormError(null);
    const payload = toPayload(values);
    try {
      if (service) {
        await update.mutateAsync(ServiceUpdateSchema.parse(payload));
        toast.success('Serviço atualizado.');
      } else {
        const created = await create.mutateAsync(ServiceCreateSchema.parse(payload));
        toast.success(`${created.name} cadastrado.`);
      }
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'SERVICE_DUPLICATE') {
        form.setError('name', { type: 'server', message: error.message }, { shouldFocus: true });
      } else if (!applyApiError(error, form.setError, FIELDS)) {
        setFormError(errorMessage(error));
      }
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>{editing ? 'Editar serviço' : 'Novo serviço'}</SheetTitle>
          <SheetDescription>
            O preço é só o padrão: dá para ajustar em cada cobrança, e cobranças já emitidas não mudam.
          </SheetDescription>
        </SheetHeader>

        <form id="service-form" noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex-1 space-y-5 overflow-y-auto p-4">
          <FormField id="service-name" label="Nome" error={errors.name?.message}>
            <Input {...fieldAria('service-name', errors.name?.message)} autoComplete="off" {...form.register('name')} />
          </FormField>

          <FormField id="service-description" label="Descrição (opcional)" error={errors.description?.message}>
            <Textarea {...fieldAria('service-description', errors.description?.message)} rows={3} {...form.register('description')} />
          </FormField>

          <Controller
            control={form.control}
            name="defaultPriceCents"
            render={({ field }) => (
              <FormField id="service-price" label="Preço padrão" error={errors.defaultPriceCents?.message} className="sm:max-w-48">
                <MoneyInput
                  {...fieldAria('service-price', errors.defaultPriceCents?.message)}
                  ref={field.ref}
                  name={field.name}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  placeholder="R$ 0,00"
                />
              </FormField>
            )}
          />

          <Controller
            control={form.control}
            name="active"
            render={({ field }) => (
              <label className="flex items-start gap-3 text-sm">
                <Switch checked={field.value} onCheckedChange={field.onChange} className="mt-0.5" />
                <span>
                  <span className="font-medium">Ativo</span>
                  <span className="block text-muted-foreground">Inativo, não aparece na Nova cobrança nem no Novo contrato.</span>
                </span>
              </label>
            )}
          />

          {formError && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {formError}
            </p>
          )}
        </form>

        <SheetFooter className="flex-row justify-end border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="service-form" disabled={isSubmitting}>
            {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden />}
            {editing ? 'Salvar' : 'Cadastrar serviço'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
