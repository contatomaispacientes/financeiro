import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { LoaderCircle } from 'lucide-react';
import { ResetPasswordSchema, type ResetPasswordInput, type UserDto } from '@financeiro/shared';
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
import { applyApiError, errorMessage } from '@/lib/form-errors';
import { useResetPassword } from './api';

export function ResetPasswordDialog({
  user,
  onOpenChange,
}: {
  user: UserDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  const reset = useResetPassword();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(ResetPasswordSchema),
    defaultValues: { newPassword: '' },
  });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    if (user) {
      form.reset({ newPassword: '' });
      setFormError(null);
    }
  }, [user, form]);

  async function onSubmit(values: ResetPasswordInput) {
    if (!user) return;
    setFormError(null);
    try {
      await reset.mutateAsync({ id: user.id, newPassword: values.newPassword });
      toast.success(`Senha de ${user.name} redefinida. As sessões abertas foram encerradas.`);
      onOpenChange(false);
    } catch (error) {
      if (!applyApiError(error, form.setError, ['newPassword'])) setFormError(errorMessage(error));
    }
  }

  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Redefinir senha</DialogTitle>
          <DialogDescription>
            {user?.name} vai precisar entrar de novo com a senha nova em todos os dispositivos.
          </DialogDescription>
        </DialogHeader>

        <form id="reset-form" className="space-y-4" noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FormField
            id="new-password"
            label="Nova senha"
            error={errors.newPassword?.message}
            description="Mínimo de 10 caracteres."
          >
            <Input
              {...fieldAria('new-password', errors.newPassword?.message, true)}
              type="password"
              autoComplete="new-password"
              {...form.register('newPassword')}
            />
          </FormField>
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
          <Button type="submit" form="reset-form" disabled={isSubmitting}>
            {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden />}
            Redefinir senha
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
