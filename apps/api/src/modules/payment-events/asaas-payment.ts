import { z } from 'zod';
import { toCents } from '@financeiro/shared';

/** Campos do `payment` dos webhooks do Asaas que o espelho usa (valores em reais, datas "YYYY-MM-DD"). */
export const AsaasWebhookPaymentSchema = z.looseObject({
  id: z.string().min(1),
  status: z.string().nullish(),
  value: z.number().nullish(),
  netValue: z.number().nullish(),
  dueDate: z.string().nullish(),
  paymentDate: z.string().nullish(),
  clientPaymentDate: z.string().nullish(),
  confirmedDate: z.string().nullish(),
  billingType: z.string().nullish(),
  invoiceUrl: z.string().nullish(),
  bankSlipUrl: z.string().nullish(),
  externalReference: z.string().nullish(),
  installment: z.string().nullish(),
  installmentNumber: z.number().int().nullish(),
  subscription: z.string().nullish(),
  refunds: z.array(z.looseObject({ value: z.number(), status: z.string().nullish() })).nullish(),
});
export type AsaasWebhookPayment = z.infer<typeof AsaasWebhookPaymentSchema>;

const ASAAS_DATETIME = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/;

/** `dateCreated` do evento vem em horário de Brasília sem fuso ("2024-06-12 16:45:03"); Brasil sem horário de verão desde 2019. */
export function eventInstant(dateCreated: unknown, fallback: Date): Date {
  const match = typeof dateCreated === 'string' ? ASAAS_DATETIME.exec(dateCreated) : null;
  return match ? new Date(`${match[1]}T${match[2]}-03:00`) : fallback;
}

/** Coluna `@db.Date` a partir de "YYYY-MM-DD". */
export const dateOnly = (date: string) => new Date(`${date.slice(0, 10)}T00:00:00Z`);

/** Total já estornado segundo o Asaas (soma de `refunds`, exceto cancelados); `null` se o payload não traz a lista. */
export function refundedTotalCents(payment: AsaasWebhookPayment): number | null {
  if (!payment.refunds) return null;
  return payment.refunds.filter((r) => r.status !== 'CANCELLED').reduce((sum, r) => sum + toCents(r.value), 0);
}
