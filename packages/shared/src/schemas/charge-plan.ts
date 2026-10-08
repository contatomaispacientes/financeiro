import { z } from '../zod.js';
import { BillingType, ChargeType, Cycle } from '../enums.js';
import type { ChargeOrigin, ChargeStatus } from '../enums.js';

const IsoDateSchema = z.iso.date({ error: 'Data inválida' });

export const ChargeItemInputSchema = z.object({
  serviceId: z.uuid().optional(),
  description: z
    .string()
    .trim()
    .min(1, { error: 'Descreva o item' })
    .max(120, { error: 'Descrição com no máximo 120 caracteres' }),
  quantity: z
    .number()
    .int()
    .min(1, { error: 'Quantidade mínima é 1' })
    .max(999, { error: 'Quantidade máxima é 999' }),
  unitPriceCents: z.number().int().min(0, { error: 'Preço não pode ser negativo' }),
});
export type ChargeItemInput = z.infer<typeof ChargeItemInputSchema>;

export const DueDateRuleSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('FIXED_DATE'), date: IsoDateSchema }),
  // Só contratos (spec 07): vencimento N dias após a assinatura.
  z.object({ mode: z.literal('DAYS_AFTER_SIGNATURE'), days: z.number().int().min(0).max(60) }),
]);
export type DueDateRule = z.infer<typeof DueDateRuleSchema>;

export const ChargePlanSchema = z
  .object({
    items: z.array(ChargeItemInputSchema).min(1, { error: 'Adicione ao menos um item' }).max(30),
    type: z.enum([ChargeType.SINGLE, ChargeType.INSTALLMENT, ChargeType.RECURRING]),
    billingType: z.enum([BillingType.PIX, BillingType.BOLETO, BillingType.CREDIT_CARD, BillingType.UNDEFINED]),
    installmentCount: z.number().int().min(2).max(12).optional(),
    cycle: z.enum(Object.values(Cycle) as [Cycle, ...Cycle[]]).optional(),
    endDate: IsoDateSchema.optional(),
    dueDate: DueDateRuleSchema,
    discountCents: z.number().int().min(0, { error: 'Desconto não pode ser negativo' }).default(0),
    finePct: z.number().min(0).max(10, { error: 'Multa de no máximo 10%' }),
    interestPct: z.number().min(0).max(10, { error: 'Juros de no máximo 10% ao mês' }),
  })
  .superRefine((p, ctx) => {
    if (p.type === 'INSTALLMENT' && !p.installmentCount)
      ctx.addIssue({ code: 'custom', path: ['installmentCount'], message: 'Informe o número de parcelas' });
    if (p.type === 'RECURRING' && !p.cycle)
      ctx.addIssue({ code: 'custom', path: ['cycle'], message: 'Informe o ciclo' });
    if (p.type !== 'INSTALLMENT' && p.installmentCount)
      ctx.addIssue({ code: 'custom', path: ['installmentCount'], message: 'Parcelas só em cobrança parcelada' });
    if (p.type !== 'RECURRING' && (p.cycle || p.endDate))
      ctx.addIssue({ code: 'custom', path: ['cycle'], message: 'Ciclo e data final só em cobrança recorrente' });
  });
export type ChargePlan = z.infer<typeof ChargePlanSchema>;
export type ChargePlanInput = z.input<typeof ChargePlanSchema>;

/** Corpo de `POST /charges/preview` e `POST /charges`. */
export const ChargeCreateRequestSchema = z.object({
  customerId: z.uuid({ error: 'Selecione o cliente' }),
  plan: ChargePlanSchema,
});
export type ChargeCreateRequest = z.infer<typeof ChargeCreateRequestSchema>;

// ───────── Cálculo (resultado de calculatePlan, ver plan.ts) ─────────

export interface PlanInstallment {
  number: number;
  dueDate: string;
  valueCents: number;
}

export interface PlanCalculation {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  firstDueDate: string;
  /** SINGLE e RECURRING: 1 item (a cobrança / o 1º ciclo). INSTALLMENT: N parcelas somando o total. */
  installments: PlanInstallment[];
  /** "Serviço A (2x) · Serviço B (1x)", até 500 caracteres (COB-02.2). */
  description: string;
}

export type PlanErrorCode =
  | 'CHARGE_TOTAL_ZERO'
  | 'DISCOUNT_EXCEEDS_SUBTOTAL'
  | 'DUE_DATE_IN_PAST'
  | 'CHARGE_BELOW_MINIMUM'
  | 'DUE_RULE_REQUIRES_SIGNATURE'
  | 'END_DATE_BEFORE_FIRST_DUE';

export type PlanResult =
  | { ok: true; value: PlanCalculation }
  | { ok: false; error: { code: PlanErrorCode; message: string } };

// ───────── DTOs da API de cobranças (spec 03) ─────────

/** Requisição que será enviada ao Asaas (bloco "Chamada à API" da prévia, COB-01.4). */
export interface AsaasRequestPreview {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
}

/** `POST /charges/preview` */
export interface ChargePreviewDto extends PlanCalculation {
  asaasRequests: AsaasRequestPreview[];
  /** true se o cliente ainda não tem `asaas_customer_id` (será criado ao gerar). */
  customerWillBeCreated: boolean;
}

export interface ChargeItemDto {
  id: string;
  serviceId: string | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
}

/** Evento recebido do Asaas para a cobrança (webhook_events com resource_id = asaas_payment_id). */
export interface ChargeEventDto {
  id: string;
  event: string;
  receivedAt: string;
  processedAt: string | null;
  result: string | null;
}

/** `GET /charges/:id` (COB-07.1). Datas puras em "YYYY-MM-DD"; instantes em ISO. */
export interface ChargeDetailDto {
  id: string;
  customer: { id: string; name: string; document: string };
  origin: ChargeOrigin;
  type: ChargeType;
  status: ChargeStatus;
  billingType: BillingType;
  valueCents: number;
  netValueCents: number | null;
  refundedCents: number;
  discountCents: number;
  finePct: number;
  interestPct: number;
  dueDate: string;
  paidAt: string | null;
  description: string;
  installmentNumber: number | null;
  installmentCount: number | null;
  groupKey: string | null;
  asaasPaymentId: string | null;
  asaasInstallmentId: string | null;
  invoiceUrl: string | null;
  bankSlipUrl: string | null;
  pixPayload: string | null;
  identificationField: string | null;
  /** Mensagem da última falha com o Asaas (cobrança em DRAFT: oferecer "Tentar de novo"/"Descartar"). */
  lastError: string | null;
  contractId: string | null;
  subscriptionId: string | null;
  items: ChargeItemDto[];
  events: ChargeEventDto[];
  createdAt: string;
  updatedAt: string;
}

/** `POST /charges` (201). Avulsa: 1 cobrança. */
export interface ChargeCreateResponseDto {
  charges: ChargeDetailDto[];
}

/**
 * Falha do Asaas ao criar (COB-12.1): erro `ASAAS_*` com estes `details`; o rascunho fica em DRAFT
 * e o front oferece `POST /charges/:id/retry` ou `/discard`.
 */
export interface ChargeCreateFailureDetails {
  chargeIds: string[];
}

/** `GET /charges/:id/payment-info` (COB-05). */
export interface PaymentInfoDto {
  invoiceUrl: string | null;
  bankSlipUrl: string | null;
  pixPayload: string | null;
  pixQrCodeBase64: string | null;
  identificationField: string | null;
}
