import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Controller, useForm, type FieldErrors, type Resolver } from 'react-hook-form';
import { toast } from 'sonner';
import { LoaderCircle } from 'lucide-react';
import {
  CustomerCreateSchema,
  CustomerUpdateSchema,
  formatDocument,
  formatPhone,
  formatPostalCode,
  isValidCpfOrCnpj,
  onlyDigits,
  type CustomerDto,
  type CustomerLookupDto,
} from '@financeiro/shared';
import { FormField, fieldAria } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { applyApiError, errorMessage } from '@/lib/form-errors';
import { maskDocumentInput, maskPhoneInput, maskPostalCodeInput } from '@/lib/masks';
import { lookupDocument, useCreateCustomer, useUpdateCustomer } from './api';

interface FormValues {
  name: string;
  document: string;
  email: string;
  phone: string;
  postalCode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  notes: string;
  remindersEnabled: boolean;
}

const ADDRESS_FIELDS = ['postalCode', 'street', 'number', 'complement', 'district', 'city', 'state'] as const;
const FIELDS = ['name', 'document', 'email', 'phone', ...ADDRESS_FIELDS, 'notes'] as const;

function toForm(c?: CustomerDto): FormValues {
  return {
    name: c?.name ?? '',
    document: c ? formatDocument(c.document) : '',
    email: c?.email ?? '',
    phone: c?.phone ? formatPhone(c.phone) : '',
    postalCode: c?.address ? formatPostalCode(c.address.postalCode) : '',
    street: c?.address?.street ?? '',
    number: c?.address?.number ?? '',
    complement: c?.address?.complement ?? '',
    district: c?.address?.district ?? '',
    city: c?.address?.city ?? '',
    state: c?.address?.state ?? '',
    notes: c?.notes ?? '',
    remindersEnabled: c?.remindersEnabled ?? true,
  };
}

/** Endereço é tudo ou nada: sem nenhum campo preenchido vira `null` (opcional no cadastro, CLI-01.2). */
function toPayload(v: FormValues) {
  const hasAddress = ADDRESS_FIELDS.some((f) => v[f].trim() !== '');
  return {
    name: v.name,
    document: v.document,
    email: v.email,
    phone: v.phone,
    address: hasAddress
      ? {
          postalCode: v.postalCode,
          street: v.street,
          number: v.number,
          complement: v.complement,
          district: v.district,
          city: v.city,
          state: v.state,
        }
      : null,
    notes: v.notes,
    remindersEnabled: v.remindersEnabled,
  };
}

function resolverFor(editing: boolean): Resolver<FormValues> {
  const schema = editing ? CustomerUpdateSchema : CustomerCreateSchema;
  return async (values) => {
    const result = schema.safeParse(toPayload(values));
    if (result.success) return { values, errors: {} };
    const errors: FieldErrors<FormValues> = {};
    for (const issue of result.error.issues) {
      // address.postalCode → postalCode
      const field = (issue.path[0] === 'address' ? issue.path[1] : issue.path[0]) as keyof FormValues | undefined;
      if (field && !errors[field]) errors[field] = { type: issue.code, message: issue.message };
    }
    return { values: {}, errors };
  };
}

export function CustomerFormSheet({
  customer,
  open,
  onOpenChange,
}: {
  customer?: CustomerDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const editing = Boolean(customer);
  const navigate = useNavigate();
  const create = useCreateCustomer();
  const update = useUpdateCustomer(customer?.id ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<Extract<CustomerLookupDto, { exists: true }> | null>(null);

  const form = useForm<FormValues>({ resolver: resolverFor(editing), defaultValues: toForm(customer) });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    if (!open) return;
    form.reset(toForm(customer));
    setFormError(null);
    setDuplicate(null);
  }, [open, customer, form]);

  /** CLI-01.3: avisa ao sair do campo se o documento já está cadastrado. */
  async function checkDuplicate(value: string) {
    const digits = onlyDigits(value);
    setDuplicate(null);
    if (!isValidCpfOrCnpj(digits) || digits === customer?.document) return;
    try {
      const result = await lookupDocument(digits);
      if (result.exists && result.customerId !== customer?.id) setDuplicate(result);
    } catch {
      // A checagem é só uma ajuda; o servidor valida de novo ao salvar.
    }
  }

  async function onSubmit(values: FormValues) {
    setFormError(null);
    const payload = toPayload(values);
    try {
      if (customer) {
        await update.mutateAsync(CustomerUpdateSchema.parse(payload));
        toast.success('Cliente atualizado.');
        onOpenChange(false);
      } else {
        const created = await create.mutateAsync(CustomerCreateSchema.parse(payload));
        toast.success(`${created.name} cadastrado.`);
        onOpenChange(false);
        navigate(`/clientes/${created.id}`);
      }
    } catch (error) {
      if (!applyApiError(error, form.setError, FIELDS)) setFormError(errorMessage(error));
    }
  }

  const masked = (name: 'document' | 'phone' | 'postalCode', mask: (v: string) => string) =>
    form.register(name, { onChange: (e) => form.setValue(name, mask(e.target.value)) });

  const text = (name: (typeof FIELDS)[number], label: string, props: Record<string, unknown> = {}, className?: string) => (
    <FormField id={`customer-${name}`} label={label} error={errors[name]?.message} className={className}>
      <Input {...fieldAria(`customer-${name}`, errors[name]?.message)} {...props} {...form.register(name)} />
    </FormField>
  );

  const documentRegister = masked('document', maskDocumentInput);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-lg">
        <SheetHeader className="border-b">
          <SheetTitle>{editing ? 'Editar cliente' : 'Novo cliente'}</SheetTitle>
          <SheetDescription>
            Nome e CPF/CNPJ bastam para cobrar. Endereço completo é exigido só para contrato.
          </SheetDescription>
        </SheetHeader>

        <form id="customer-form" noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex-1 space-y-5 overflow-y-auto p-4">
          {text('name', 'Nome ou razão social', { autoComplete: 'off' })}

          <FormField id="customer-document" label="CPF ou CNPJ" error={errors.document?.message}>
            <Input
              {...fieldAria('customer-document', errors.document?.message)}
              inputMode="numeric"
              autoComplete="off"
              {...documentRegister}
              onBlur={(e) => {
                void documentRegister.onBlur(e);
                void checkDuplicate(e.target.value);
              }}
            />
            {duplicate && (
              <p role="status" className="text-sm text-amber-800">
                Já existe {duplicate.archived ? 'um cliente arquivado' : 'um cliente'} com este documento:{' '}
                <Link to={`/clientes/${duplicate.customerId}`} className="font-medium underline" onClick={() => onOpenChange(false)}>
                  {duplicate.name}
                </Link>
              </p>
            )}
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            {text('email', 'E-mail', { type: 'email', autoComplete: 'off' })}
            <FormField id="customer-phone" label="Celular" error={errors.phone?.message}>
              <Input {...fieldAria('customer-phone', errors.phone?.message)} type="tel" {...masked('phone', maskPhoneInput)} />
            </FormField>
          </div>

          <fieldset className="space-y-4">
            <legend className="mb-2 text-sm font-medium">Endereço de cobrança</legend>
            <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
              <FormField id="customer-postalCode" label="CEP" error={errors.postalCode?.message}>
                <Input {...fieldAria('customer-postalCode', errors.postalCode?.message)} inputMode="numeric" {...masked('postalCode', maskPostalCodeInput)} />
              </FormField>
              {text('street', 'Logradouro')}
            </div>
            <div className="grid gap-4 sm:grid-cols-[7rem_1fr]">
              {text('number', 'Número')}
              {text('complement', 'Complemento')}
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_1fr_5rem]">
              {text('district', 'Bairro')}
              {text('city', 'Cidade')}
              {text('state', 'UF', { maxLength: 2, className: 'uppercase' })}
            </div>
          </fieldset>

          <FormField id="customer-notes" label="Observações" error={errors.notes?.message}>
            <Textarea {...fieldAria('customer-notes', errors.notes?.message)} rows={3} {...form.register('notes')} />
          </FormField>

          <Controller
            control={form.control}
            name="remindersEnabled"
            render={({ field }) => (
              <label className="flex items-start gap-3 text-sm">
                <Switch checked={field.value} onCheckedChange={field.onChange} className="mt-0.5" />
                <span>
                  <span className="font-medium">Enviar lembretes de cobrança</span>
                  <span className="block text-muted-foreground">Desligado, o cliente não recebe a régua nem as notificações do Asaas.</span>
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
          <Button type="submit" form="customer-form" disabled={isSubmitting}>
            {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden />}
            {editing ? 'Salvar' : 'Cadastrar cliente'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
