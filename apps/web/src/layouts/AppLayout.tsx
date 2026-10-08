import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { LogOut } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { logout, useSession } from '@/lib/auth';
import { roleLabels } from '@/lib/format';
import { cn } from '@/lib/utils';
import { EnvironmentBadge } from '@/components/environment-badge';
import { navigationFor } from './navigation';

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function AppLayout() {
  const { user } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const groups = navigationFor(user?.role);
  const navRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();

  // No celular o menu é uma barra horizontal: traz o item da tela atual para a vista.
  useEffect(() => {
    const active = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    active?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [pathname]);

  async function handleLogout() {
    await logout();
    queryClient.clear();
    navigate('/login', { replace: true });
  }

  const userBlock = user && (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-accent text-xs font-semibold"
      >
        {initials(user.name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-sidebar-accent-foreground">{user.name}</p>
        <p className="truncate text-xs text-sidebar-muted">{roleLabels[user.role]}</p>
      </div>
      <button
        type="button"
        onClick={handleLogout}
        className="grid size-8 place-items-center rounded-md text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-sidebar-ring"
        aria-label="Sair"
        title="Sair"
      >
        <LogOut className="size-4" />
      </button>
    </div>
  );

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <a
        href="#conteudo"
        className="sr-only z-50 rounded-md bg-card px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Pular para o conteúdo
      </a>

      {/* Menu lateral (desktop) e barra superior (celular) — telas.md */}
      <aside className="bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:flex md:h-dvh md:flex-col">
        <div className="flex items-center gap-3 px-4 py-3 md:block md:px-5 md:pt-6 md:pb-4">
          <p className="flex-1 text-base font-semibold tracking-tight text-sidebar-accent-foreground">
            Financeiro
          </p>
          <EnvironmentBadge className="md:hidden" />
          {user && (
            <button
              type="button"
              onClick={handleLogout}
              className="grid size-8 place-items-center rounded-md text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-sidebar-ring md:hidden"
              aria-label={`Sair (${user.name})`}
              title={`Sair (${user.name})`}
            >
              <LogOut aria-hidden className="size-4" />
            </button>
          )}
        </div>

        <nav
          ref={navRef}
          aria-label="Menu principal"
          className="flex gap-1 overflow-x-auto border-t border-sidebar-border px-2 py-2 [scrollbar-width:none] md:flex-1 md:flex-col md:gap-5 md:overflow-y-auto md:border-0 md:px-3 md:py-2"
        >
          {groups.map((group) => (
            <div key={group.label} className="flex shrink-0 gap-1 md:flex-col md:gap-0.5">
              <p className="hidden px-3 pb-1 text-[0.6875rem] font-medium tracking-wider text-sidebar-muted uppercase md:block">
                {group.label}
              </p>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      'flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors',
                      'focus-visible:outline-2 focus-visible:outline-sidebar-ring',
                      isActive
                        ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon
                        aria-hidden
                        className={cn('size-4', isActive ? 'text-emerald-300' : 'text-sidebar-muted')}
                      />
                      {item.label}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="hidden space-y-4 border-t border-sidebar-border px-4 py-4 md:block">
          <EnvironmentBadge />
          {userBlock}
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <main id="conteudo" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
