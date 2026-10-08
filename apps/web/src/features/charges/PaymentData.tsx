import type { ReactNode } from 'react';
import { ExternalLink, LoaderCircle } from 'lucide-react';
import type { ChargeDetailDto } from '@financeiro/shared';
import { CopyButton } from '@/components/copy-button';
import { Button } from '@/components/ui/button';
import { usePaymentInfo } from './api';

function Row({ label, children, action }: { label: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid gap-1.5 py-3 first:pt-0 last:pb-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">{children}</div>
        {action}
      </dd>
    </div>
  );
}

const code = 'tabular block truncate rounded-md bg-muted px-2.5 py-1.5 text-xs';

/**
 * Link da fatura, Pix copia-e-cola e linha digitável (COB-05.1). O que faltou na criação é buscado
 * sob demanda em `/payment-info` (COB-05.2); cada dado copia com um clique (COB-05.3).
 */
export function PaymentData({ charge }: { charge: ChargeDetailDto }) {
  const open = charge.status === 'PENDING' || charge.status === 'OVERDUE';
  const wantsPix = open && (charge.billingType === 'PIX' || charge.billingType === 'UNDEFINED');
  const wantsSlip = open && (charge.billingType === 'BOLETO' || charge.billingType === 'UNDEFINED');
  const missing =
    charge.asaasPaymentId !== null &&
    (!charge.invoiceUrl || (wantsPix && !charge.pixPayload) || (wantsSlip && !charge.identificationField));
  const info = usePaymentInfo(charge.id, missing);

  const invoiceUrl = charge.invoiceUrl ?? info.data?.invoiceUrl ?? null;
  const bankSlipUrl = charge.bankSlipUrl ?? info.data?.bankSlipUrl ?? null;
  const pixPayload = wantsPix ? (charge.pixPayload ?? info.data?.pixPayload ?? null) : null;
  const pixQrCode = wantsPix ? (info.data?.pixQrCodeBase64 ?? null) : null;
  const identificationField = wantsSlip ? (charge.identificationField ?? info.data?.identificationField ?? null) : null;

  if (!charge.asaasPaymentId) {
    return <p className="text-sm text-muted-foreground">A cobrança ainda não existe no Asaas.</p>;
  }

  return (
    <div className="space-y-3">
      <dl className="divide-y">
        {invoiceUrl && (
          <Row label="Link da fatura" action={<CopyButton value={invoiceUrl} label="link da fatura" />}>
            <a
              href={invoiceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-full items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              <span className="truncate">{invoiceUrl.replace(/^https?:\/\//, '')}</span>
              <ExternalLink aria-hidden className="size-3.5 shrink-0" />
            </a>
          </Row>
        )}
        {pixPayload && (
          <Row label="Pix copia-e-cola" action={<CopyButton value={pixPayload} label="Pix copia-e-cola" />}>
            <code className={code} title={pixPayload}>
              {pixPayload}
            </code>
            {pixQrCode && (
              <img
                src={`data:image/png;base64,${pixQrCode}`}
                alt="QR Code do Pix"
                className="mt-3 size-40 rounded-md border bg-white p-1"
              />
            )}
          </Row>
        )}
        {identificationField && (
          <Row label="Linha digitável" action={<CopyButton value={identificationField} label="linha digitável" />}>
            <code className={code} title={identificationField}>
              {identificationField}
            </code>
          </Row>
        )}
        {bankSlipUrl && wantsSlip && (
          <Row label="Boleto">
            <a
              href={bankSlipUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              Abrir boleto em PDF
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
          </Row>
        )}
      </dl>

      {missing && info.isFetching && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
          Buscando dados de pagamento no Asaas…
        </p>
      )}
      {missing && info.isError && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          Não foi possível buscar {wantsPix ? 'o Pix' : wantsSlip ? 'a linha digitável' : 'o link'} agora.
          <Button type="button" size="sm" variant="outline" onClick={() => info.refetch()}>
            Tentar de novo
          </Button>
        </p>
      )}
      {!open && !invoiceUrl && <p className="text-sm text-muted-foreground">Sem dados de pagamento para esta cobrança.</p>}
    </div>
  );
}
