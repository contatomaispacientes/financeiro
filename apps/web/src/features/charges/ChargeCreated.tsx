import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { CircleCheck, Plus } from 'lucide-react';
import type { ChargeDetailDto } from '@financeiro/shared';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { formatBRL, formatDate } from '@/lib/format';
import { billingTypeLabels, cycleLabels } from './labels';
import { PaymentData } from './PaymentData';

/** Resultado da Nova cobrança: o que mandar ao cliente, já pronto para copiar (O1, COB-05.3). */
export function ChargeCreated({ charge, onCreateAnother }: { charge: ChargeDetailDto; onCreateAnother: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  return (
    <div className="mx-auto max-w-2xl rounded-lg border bg-card">
      <div className="flex flex-col items-center gap-2 border-b px-4 py-8 text-center sm:px-6">
        <span className="grid size-11 place-items-center rounded-full bg-emerald-100 text-inflow">
          <CircleCheck aria-hidden className="size-6" />
        </span>
        <h1 ref={headingRef} tabIndex={-1} className="mt-1 text-xl font-semibold tracking-tight outline-none">
          {charge.subscription
            ? 'Recorrência criada no Asaas'
            : charge.installments.length
              ? 'Parcelamento gerado no Asaas'
              : 'Cobrança gerada no Asaas'}
        </h1>
        <p className="text-sm text-muted-foreground">{charge.customer.name}</p>
        <p className="tabular mt-2 text-3xl font-semibold">{formatBRL(charge.valueCents)}</p>
        <p className="text-sm text-muted-foreground">
          Vence em <span className="tabular text-foreground">{formatDate(charge.dueDate)}</span> ·{' '}
          {billingTypeLabels[charge.billingType]}
        </p>
        <StatusBadge kind="charge" status={charge.status} className="mt-1" />
      </div>

      <dl className="grid gap-1 border-b px-4 py-4 text-sm sm:grid-cols-[9rem_1fr] sm:px-6">
        <dt className="text-muted-foreground">ID Asaas</dt>
        <dd className="tabular">{charge.asaasPaymentId ?? '—'}</dd>
        {charge.subscription && (
          <>
            <dt className="text-muted-foreground">Recorrência</dt>
            <dd>
              {formatBRL(charge.subscription.valueCents)} · {cycleLabels[charge.subscription.cycle].toLowerCase()}
              {charge.subscription.endDate ? `, até ${formatDate(charge.subscription.endDate)}` : ', sem data final'}
            </dd>
          </>
        )}
      </dl>

      {charge.installments.length > 0 && (
        <section aria-labelledby="installments" className="border-b px-4 py-4 sm:px-6">
          <h2 id="installments" className="mb-2 text-sm font-medium">
            {charge.installments.length} parcelas
          </h2>
          <ol className="tabular grid gap-x-6 text-sm sm:grid-cols-2">
            {charge.installments.map((p) => (
              <li key={p.id} className="flex justify-between gap-3 border-b py-1">
                <span className="text-muted-foreground">
                  {p.installmentNumber}ª · {formatDate(p.dueDate)}
                </span>
                <span>{formatBRL(p.valueCents)}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-muted-foreground">Abaixo, os dados de pagamento da 1ª parcela.</p>
        </section>
      )}

      <section aria-labelledby="payment-data" className="px-4 py-5 sm:px-6">
        <h2 id="payment-data" className="mb-3 text-sm font-medium">
          Para enviar ao cliente
        </h2>
        <PaymentData charge={charge} />
      </section>

      <div className="flex flex-col-reverse gap-2 border-t px-4 py-4 sm:flex-row sm:justify-end sm:px-6">
        <Button type="button" variant="outline" onClick={onCreateAnother}>
          <Plus aria-hidden />
          Criar outra
        </Button>
        <Button asChild>
          <Link to={`/cobrancas/${charge.id}`}>Ver cobrança</Link>
        </Button>
      </div>
    </div>
  );
}
