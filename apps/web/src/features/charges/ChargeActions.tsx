import { useState } from 'react';
import { toast } from 'sonner';
import { LoaderCircle } from 'lucide-react';
import { can, type ChargeDetailDto } from '@financeiro/shared';
import { MoneyInput } from '@/components/money-input';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/form-errors';
import { formatBRL } from '@/lib/format';
import { useChargeMutations } from './api';

const OPEN = ['PENDING', 'OVERDUE'];
const REFUNDABLE = ['PAID', 'CONFIRMED', 'PARTIALLY_REFUNDED'];

/** Botões do detalhe conforme estado e papel: cancelar (COB-08) e estornar (COB-09). */
export function ChargeActions({ charge }: { charge: ChargeDetailDto }) {
  const { user } = useSession();
  const [dialog, setDialog] = useState<'cancel' | 'refund' | null>(null);
  const canCancel = can(user?.role, 'MANAGE_CHARGES') && OPEN.includes(charge.status);
  const canRefund = can(user?.role, 'REFUND_CHARGE') && REFUNDABLE.includes(charge.status) && !!charge.asaasPaymentId;
  if (!canCancel && !canRefund) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {canCancel && (
        <Button variant="outline" onClick={() => setDialog('cancel')}>
          Cancelar cobrança
        </Button>
      )}
      {canRefund && (
        <Button variant="outline" onClick={() => setDialog('refund')}>
          Estornar
        </Button>
      )}
      {dialog === 'cancel' && <CancelDialog charge={charge} onClose={() => setDialog(null)} />}
      {dialog === 'refund' && <RefundDialog charge={charge} onClose={() => setDialog(null)} />}
    </div>
  );
}

function CancelDialog({ charge, onClose }: { charge: ChargeDetailDto; onClose: () => void }) {
  const { cancel } = useChargeMutations();
  const openParcels = charge.installments.filter((p) => OPEN.includes(p.status));
  const [scope, setScope] = useState<'SINGLE' | 'REMAINING_INSTALLMENTS'>('SINGLE');

  async function confirm() {
    try {
      const done = await cancel.mutateAsync({ id: charge.id, scope });
      toast.success(done.length > 1 ? `${done.length} parcelas canceladas.` : 'Cobrança cancelada.');
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar a cobrança de {charge.customer.name}?</DialogTitle>
          <DialogDescription>
            {formatBRL(charge.valueCents)}. Ela é removida no Asaas e o link da fatura deixa de funcionar. Não dá para desfazer.
          </DialogDescription>
        </DialogHeader>
        {openParcels.length > 1 && (
          <fieldset className="space-y-2 text-sm">
            <legend className="mb-1 font-medium">O que cancelar</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="scope" checked={scope === 'SINGLE'} onChange={() => setScope('SINGLE')} />
              Só esta parcela ({charge.installmentNumber}/{charge.installmentCount})
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="scope" checked={scope === 'REMAINING_INSTALLMENTS'} onChange={() => setScope('REMAINING_INSTALLMENTS')} />
              Todas as {openParcels.length} parcelas em aberto ({formatBRL(openParcels.reduce((s, p) => s + p.valueCents, 0))})
            </label>
          </fieldset>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Voltar</Button>
          <Button variant="destructive" onClick={confirm} disabled={cancel.isPending}>
            {cancel.isPending && <LoaderCircle aria-hidden className="animate-spin" />}
            Cancelar cobrança
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RefundDialog({ charge, onClose }: { charge: ChargeDetailDto; onClose: () => void }) {
  const { refund } = useChargeMutations();
  const balance = charge.valueCents - charge.refundedCents;
  const [value, setValue] = useState<number | null>(balance);
  const invalid = !value || value <= 0 || value > balance;

  async function confirm() {
    if (invalid) return;
    try {
      await refund.mutateAsync({ id: charge.id, valueCents: value });
      toast.success('Estorno solicitado ao Asaas. O status muda quando ele confirmar.');
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Estornar pagamento de {charge.customer.name}?</DialogTitle>
          <DialogDescription>
            O dinheiro volta ao cliente pelo Asaas. Pode ser o total ({formatBRL(balance)}) ou parte dele.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <label htmlFor="refund-value" className="text-sm font-medium">Valor do estorno</label>
          <MoneyInput id="refund-value" value={value} onChange={setValue} aria-invalid={invalid} aria-describedby="refund-help" />
          <p id="refund-help" className={invalid ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
            {invalid ? `Informe de R$ 0,01 até ${formatBRL(balance)}.` : `Saldo estornável: ${formatBRL(balance)}.`}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Voltar</Button>
          <Button variant="destructive" onClick={confirm} disabled={invalid || refund.isPending}>
            {refund.isPending && <LoaderCircle aria-hidden className="animate-spin" />}
            Estornar {value ? formatBRL(value) : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
