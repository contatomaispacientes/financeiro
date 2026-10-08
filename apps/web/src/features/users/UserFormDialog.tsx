import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { LoaderCircle } from 'lucide-react';
import { z } from 'zod';
import { RoleEnum, UserCreateSchema, type Role, type UserDto } from '@financeiro/shared';
import { FormField, fieldAria } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { applyApiError, errorMessage } from '@/lib/form-errors';
import { roleLabels } from '@/lib/format';
import { useCreateUser, useUpdateUser } from './api';

export const roleDescriptions: Record<Role, string> = {
  ADMIN: 'Tudo, inclusive configurações, usuários e estornos.',
  FINANCEIRO: 'Clientes, serviços, cobranças, contratos e despesas. Sem configurações nem estorno.',
  LEITURA: 'Só consulta: painel, relatórios e listas (documentos mascarados).',
};

// Na edição a senha não aparece no formulário (troca de senha é "Redefinir senha").
const EditSchema = UserCreateSchema.extend({ password: z.string() });
type CreateForm = z.input<typeof UserCreateSchema>;

/** Criar (sem `user`) ou editar (com `user`) um usuário. */
export function UserFormDialog({
  user,
  open,
  onOpenChange,
}: {
  user?: UserDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const editing = Boolean(user);
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<CreateForm>({
    resolver: zodResolver(editing ? EditSchema : UserCreateSchema),
    defaultValues: { name: '', email: '', role: 'FINANCEIRO', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    form.reset({
      name: user?.name ?? '',
      email: user?.email ?? '',
      role: user?.role ?? 'FINANCEIRO',
      password: '',
    });
  }, [open, user, form]);

  async function onSubmit(values: CreateForm) {
    setFormError(null);
    try {
      if (user) {
        const { name, email, role } = EditSchema.parse(values);
        await updateUser.mutateAsync({ id: user.id, input: { name, email, role } });
        toast.success('Usuário atualizado.');
      } else {
        const created = await createUser.mutateAsync(UserCreateSchema.parse(values));
        toast.success(`${created.name} já pode entrar com o e-mail ${created.email}.`);
      }
      onOpenChange(false);
    } catch (error) {
      if (!applyApiError(error, form.setError, ['name', 'email', 'role', 'password'])) {
        setFormError(errorMessage(error));
      }
    }
  }

  const role = form.watch('role') as Role;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar usuário' : 'Novo usuário'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Trocar o papel encerra as sessões abertas da pessoa.'
              : 'Combine a senha inicial com a pessoa; ela poderá pedir uma nova ao administrador.'}
          </DialogDescription>
        </DialogHeader>

        <form id="user-form" className="space-y-4" noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FormField id="user-name" label="Nome" error={errors.name?.message}>
            <Input {...fieldAria('user-name', errors.name?.message)} autoComplete="off" {...form.register('name')} />
          </FormField>

          <FormField id="user-email" label="E-mail" error={errors.email?.message}>
            <Input
              {...fieldAria('user-email', errors.email?.message)}
              type="email"
              autoComplete="off"
              {...form.register('email')}
            />
          </FormField>

          <FormField id="user-role" label="Papel" error={errors.role?.message} description={roleDescriptions[role]}>
            <Controller
              control={form.control}
              name="role"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    {...fieldAria('user-role', errors.role?.message, true)}
                    className="w-full"
                    onBlur={field.onBlur}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RoleEnum.options.map((option) => (
                      <SelectItem key={option} value={option}>
                        {roleLabels[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>

          {!editing && (
            <FormField
              id="user-password"
              label="Senha inicial"
              error={errors.password?.message}
              description="Mínimo de 10 caracteres."
            >
              <Input
                {...fieldAria('user-password', errors.password?.message, true)}
                type="password"
                autoComplete="new-password"
                {...form.register('password')}
              />
            </FormField>
          )}

          {formError && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {formError}
            </p>
          )}
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="user-form" disabled={isSubmitting}>
            {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden />}
            {editing ? 'Salvar' : 'Criar usuário'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
