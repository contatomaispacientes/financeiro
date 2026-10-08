import { z } from '../zod.js';
import { BillingType, ChargeStatus, ChargeType, SubscriptionStatus } from '../enums.js';
import type { ChargeOrigin, Cycle } from '../enums.js';

const IsoDate = z.iso.date({ error: 'Data inválida' });
/** Aceita `?status=PAID` e `?status=PAID&status=OVERDUE`. */
const many = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === undefined || Array.isArray(v) ? v : [v]), z.array(schema).optional());

/** `GET /charges` (COB-06). */
export const ChargeListQuerySchema = z.object({
  status: many(z.enum(ChargeStatus)),
  customerId: z.uuid().optional(),
  type: z.enum(ChargeType).optional(),
  billingType: z.enum(BillingType).optional(),
  dueFrom: IsoDate.optional(),
  dueTo: IsoDate.optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['dueDate:desc', 'dueDate:asc', 'value:desc', 'value:asc']).default('dueDate:desc'),
});
export type ChargeListQuery = z.infer<typeof ChargeListQuerySchema>;

export interface ChargeListItemDto {
  id: string;
  customer: { id: string; name: string };
  description: string;
  type: ChargeType;
  origin: ChargeOrigin;
  installmentNumber: number | null;
  installmentCount: number | null;
  cycle: Cycle | null;
  billingType: BillingType;
  dueDate: string;
  paidAt: string | null;
  valueCents: number;
  status: ChargeStatus;
  asaasPaymentId: string | null;
  refundRequestedAt: string | null;
}

export interface ChargeListDto {
  data: ChargeListItemDto[];
  meta: { page: number; pageSize: number; total: number };
  /** Contagem por status ignora o filtro de status (chips); soma respeita todos os filtros. */
  summary: { countByStatus: Partial<Record<ChargeStatus, number>>; totalCents: number };
}

/** `POST /charges/:id/cancel` (COB-08). */
export const ChargeCancelSchema = z.object({
  scope: z.enum(['SINGLE', 'REMAINING_INSTALLMENTS']).default('SINGLE'),
});
export type ChargeCancelInput = z.infer<typeof ChargeCancelSchema>;

/** `POST /charges/:id/refund` (COB-09). Sem valor = estorno do saldo inteiro. */
export const ChargeRefundSchema = z.object({
  valueCents: z.number().int().min(1, { error: 'Informe o valor' }).optional(),
  description: z.string().trim().max(200).optional(),
});
export type ChargeRefundInput = z.infer<typeof ChargeRefundSchema>;

// ───────── Recorrências (COB-04.4, COB-11) ─────────

export const SubscriptionListQuerySchema = z.object({
  status: z.enum(SubscriptionStatus).optional(),
  customerId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type SubscriptionListQuery = z.infer<typeof SubscriptionListQuerySchema>;

export interface SubscriptionListItemDto {
  id: string;
  customer: { id: string; name: string };
  description: string;
  valueCents: number;
  billingType: BillingType;
  cycle: Cycle;
  nextDueDate: string;
  endDate: string | null;
  status: SubscriptionStatus;
  asaasSubscriptionId: string | null;
  /** Mensagem da falha ao criar no Asaas (sem `asaasSubscriptionId`: oferecer "Tentar de novo"). */
  lastError: string | null;
  createdAt: string;
}

export interface SubscriptionDetailDto extends SubscriptionListItemDto {
  finePct: number;
  interestPct: number;
  contractId: string | null;
  items: Array<{ id: string; description: string; quantity: number; unitPriceCents: number; totalCents: number }>;
  charges: ChargeListItemDto[];
}
