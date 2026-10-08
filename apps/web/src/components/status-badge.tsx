import type {
  ChargeStatus,
  ContractStatus,
  ExpenseStatus,
  SubscriptionStatus,
} from '@financeiro/shared';
import { cn } from '@/lib/utils';

type Tone = 'amber' | 'blue' | 'green' | 'red' | 'gray' | 'purple';

// telas.md: Pendente âmbar, Confirmado azul, Pago verde, Vencido vermelho, Cancelado cinza, Estornado roxo.
const tones: Record<Tone, string> = {
  amber: 'bg-amber-100 text-amber-900 ring-amber-300',
  blue: 'bg-sky-100 text-sky-900 ring-sky-300',
  green: 'bg-emerald-100 text-emerald-900 ring-emerald-300',
  red: 'bg-red-100 text-red-900 ring-red-300',
  gray: 'bg-zinc-100 text-zinc-700 ring-zinc-300',
  purple: 'bg-violet-100 text-violet-900 ring-violet-300',
};

const dots: Record<Tone, string> = {
  amber: 'bg-amber-500',
  blue: 'bg-sky-500',
  green: 'bg-emerald-600',
  red: 'bg-red-600',
  gray: 'bg-zinc-400',
  purple: 'bg-violet-500',
};

type Entry = readonly [label: string, tone: Tone];

const statuses = {
  charge: {
    DRAFT: ['Rascunho', 'gray'],
    PENDING: ['Pendente', 'amber'],
    CONFIRMED: ['Confirmado', 'blue'],
    PAID: ['Pago', 'green'],
    OVERDUE: ['Vencido', 'red'],
    CANCELED: ['Cancelado', 'gray'],
    REFUNDED: ['Estornado', 'purple'],
    PARTIALLY_REFUNDED: ['Estornado parcial', 'purple'],
    CHARGEBACK: ['Chargeback', 'red'],
  } satisfies Record<ChargeStatus, Entry>,
  contract: {
    DRAFT: ['Rascunho', 'gray'],
    SENT: ['Enviado', 'blue'],
    PARTIALLY_SIGNED: ['Parcialmente assinado', 'amber'],
    SIGNED: ['Assinado', 'green'],
    REFUSED: ['Recusado', 'red'],
    EXPIRED: ['Expirado', 'gray'],
    CANCELED: ['Cancelado', 'gray'],
  } satisfies Record<ContractStatus, Entry>,
  // OVERDUE da despesa é derivado (OPEN com vencimento passado), não existe no banco.
  expense: {
    OPEN: ['Em aberto', 'amber'],
    OVERDUE: ['Atrasada', 'red'],
    PAID: ['Paga', 'green'],
    CANCELED: ['Cancelada', 'gray'],
  } satisfies Record<ExpenseStatus | 'OVERDUE', Entry>,
  subscription: {
    ACTIVE: ['Ativa', 'green'],
    INACTIVE: ['Inativa', 'gray'],
    CANCELED: ['Cancelada', 'gray'],
  } satisfies Record<SubscriptionStatus, Entry>,
};

export type StatusKind = keyof typeof statuses;
type StatusOf<K extends StatusKind> = keyof (typeof statuses)[K];

export function statusLabel<K extends StatusKind>(kind: K, status: StatusOf<K>): string {
  return (statuses[kind][status] as Entry)[0];
}

/** Status sempre com texto + cor, nunca só cor (telas.md). */
export function StatusBadge<K extends StatusKind>({
  kind,
  status,
  className,
}: {
  kind: K;
  status: StatusOf<K>;
  className?: string;
}) {
  const [label, tone] = statuses[kind][status] as Entry;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        tones[tone],
        className,
      )}
    >
      <span aria-hidden className={cn('size-1.5 rounded-full', dots[tone])} />
      {label}
    </span>
  );
}
