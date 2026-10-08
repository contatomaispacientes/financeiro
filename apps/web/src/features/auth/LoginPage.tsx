import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { LoginSchema, type LoginInput } from '@financeiro/shared';
import type { z } from 'zod';
import { login, useSession } from '@/lib/auth';
import { applyApiError, errorMessage } from '@/lib/form-errors';
import { FormField, fieldAria } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

/** Só caminhos internos: `?redirect=//outro-site` não pode tirar o usuário do app. */
export function safeRedirect(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  if (value === '/login' || value.startsWith('/login?')) return '/';
  return value;
}

export function LoginPage() {
  const { status, expired } = useSession();
  const [params] = useSearchParams();
  const target = safeRedirect(params.get('redirect'));
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<z.input<typeof LoginSchema>, unknown, LoginInput>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: LoginInput) {
    setFormError(null);
    try {
      await login(values.email, values.password);
      // A troca de status para "authenticated" renderiza o <Navigate> abaixo.
    } catch (error) {
      if (!applyApiError(error, form.setError, ['email', 'password'])) setFormError(errorMessage(error));
    }
  }

  if (status === 'authenticated') return <Navigate to={target} replace />;

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-9" />
          <div>
            <p className="text-lg font-semibold tracking-tight">Financeiro</p>
            <p className="text-sm text-muted-foreground">Cobranças, contratos e caixa</p>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h1 className="text-xl font-semibold tracking-tight">Entrar</h1>
          <p className="mt-1 text-sm text-muted-foreground">Use o e-mail e a senha cadastrados pelo administrador.</p>

          {expired && !formError && (
            <p role="status" className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200 ring-inset">
              Sua sessão expirou. Entre novamente para continuar de onde parou.
            </p>
          )}

          {status === 'loading' ? (
            <div className="mt-6 space-y-3" role="status" aria-live="polite">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <span className="sr-only">Verificando sessão…</span>
            </div>
          ) : (
            <form className="mt-6 space-y-4" noValidate onSubmit={form.handleSubmit(onSubmit)}>
              <FormField id="email" label="E-mail" error={errors.email?.message}>
                <Input
                  {...fieldAria('email', errors.email?.message)}
                  type="email"
                  autoComplete="username"
                  autoFocus
                  {...form.register('email')}
                />
              </FormField>

              <FormField id="password" label="Senha" error={errors.password?.message}>
                <div className="relative">
                  <Input
                    {...fieldAria('password', errors.password?.message)}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    className="pr-10"
                    {...form.register('password')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                  </button>
                </div>
              </FormField>

              {formError && (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {formError}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden />}
                {isSubmitting ? 'Entrando…' : 'Entrar'}
              </Button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Esqueceu a senha? Peça a um administrador para redefinir.
        </p>
      </div>
    </main>
  );
}
