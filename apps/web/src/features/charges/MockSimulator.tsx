import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FlaskConical } from 'lucide-react';
import type { ChargeDetailDto } from '@financeiro/shared';
import { useEnvironment } from '@/components/environment-badge';
import { Button } from '@/components/ui/button';
import { post } from '@/lib/api';
import { errorMessage } from '@/lib/form-errors';

type Action = 'RECEIVE' | 'OVERDUE';

/** ADR-016: com o Asaas simulado, permite pagar ou vencer a cobrança sem sair do sistema. */
export function MockSimulator({ charge }: { charge: ChargeDetailDto }) {
  const environment = useEnvironment();
  const queryClient = useQueryClient();
  const simulate = useMutation({
    mutationFn: (action: Action) => post(`/asaas-mock/charges/${charge.id}/simulate`, { action }),
    onSuccess: (_data, action) => {
      toast.success(action === 'RECEIVE' ? 'Pagamento simulado. O status muda em instantes.' : 'Vencimento simulado.');
      // O status chega pelo webhook simulado, processado na fila: recarrega agora e de novo em seguida.
      const refresh = () =>
        Promise.all(
          [['charge', charge.id], ['charges'], ['dashboard'], ['cashflow']].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
        );
      void refresh();
      setTimeout(() => void refresh(), 1500);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (environment.data?.asaasEnv !== 'mock' || !charge.asaasPaymentId) return null;
  if (charge.status !== 'PENDING' && charge.status !== 'OVERDUE') return null;

  return (
    <section className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="mb-2 flex items-center gap-2 font-medium">
        <FlaskConical aria-hidden className="size-4" />
        Asaas simulado
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => simulate.mutate('RECEIVE')} disabled={simulate.isPending}>
          Simular pagamento
        </Button>
        {charge.status === 'PENDING' && (
          <Button size="sm" variant="outline" onClick={() => simulate.mutate('OVERDUE')} disabled={simulate.isPending}>
            Simular vencimento
          </Button>
        )}
      </div>
    </section>
  );
}
