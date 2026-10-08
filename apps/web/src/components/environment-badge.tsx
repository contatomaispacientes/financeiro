import { useQuery } from '@tanstack/react-query';
import type { EnvironmentDto } from '@financeiro/shared';
import { get } from '@/lib/api';
import { cn } from '@/lib/utils';

export function useEnvironment() {
  return useQuery({
    queryKey: ['settings', 'environment'],
    queryFn: () => get<EnvironmentDto>('/settings/environment'),
    staleTime: Infinity,
  });
}

/** Selo do ambiente do Asaas (FND-06.1). Em sandbox nada é cobrado de verdade. */
export function EnvironmentBadge({ className }: { className?: string }) {
  const { data } = useEnvironment();
  if (!data) return null;

  const production = data.asaasEnv === 'production';
  const label = { production: 'Produção', sandbox: 'Sandbox', mock: 'Simulado' }[data.asaasEnv];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        production ? 'bg-primary/20 text-emerald-200' : 'bg-amber-400/15 text-amber-200',
        className,
      )}
      title={production ? 'Cobranças reais' : data.asaasEnv === 'mock' ? 'Asaas simulado no próprio sistema: nada sai daqui' : 'Ambiente de testes do Asaas: nada é cobrado de verdade'}
    >
      <span
        aria-hidden
        className={cn('size-1.5 rounded-full', production ? 'bg-emerald-400' : 'bg-amber-400')}
      />
      Asaas {label}
    </span>
  );
}
