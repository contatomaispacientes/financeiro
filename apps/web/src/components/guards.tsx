import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { ShieldAlert } from 'lucide-react';
import { can, type Permission } from '@financeiro/shared';
import { useSession } from '@/lib/auth';
import { Skeleton } from '@/components/ui/skeleton';

/** Exige sessão; sem ela, vai ao login guardando a rota de destino (FND-06.2). */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { status } = useSession();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="grid min-h-dvh place-items-center" role="status" aria-live="polite">
        <div className="w-64 space-y-3">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <span className="sr-only">Carregando sessão…</span>
        </div>
      </div>
    );
  }

  if (status === 'anonymous') {
    const redirect = location.pathname + location.search;
    const to = redirect === '/' ? '/login' : `/login?redirect=${encodeURIComponent(redirect)}`;
    return <Navigate to={to} replace />;
  }

  return children ?? <Outlet />;
}

/** Bloqueia a tela para quem não tem a permissão (FND-06.3). A API também recusa (403). */
export function RequireRole({ permission, children }: { permission: Permission; children?: ReactNode }) {
  const { user } = useSession();
  if (!can(user?.role, permission)) return <Forbidden />;
  return children ?? <Outlet />;
}

export function Forbidden() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <ShieldAlert aria-hidden className="mx-auto size-10 text-muted-foreground" />
      <h1 className="mt-4 text-lg font-semibold">Sem permissão</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Seu papel não dá acesso a esta tela. Se precisar, peça a um administrador.
      </p>
    </div>
  );
}
