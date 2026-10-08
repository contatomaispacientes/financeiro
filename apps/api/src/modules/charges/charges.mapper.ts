import type { ChargeDetailDto, ChargeStatus, Role } from '@financeiro/shared';
import type { Charge, ChargeItem, Customer, WebhookEvent } from '../../generated/prisma/client.js';
import { documentFor, toDateOnly } from '../customers/customers.mapper';

export type ChargeWithRelations = Charge & { customer: Customer; items: ChargeItem[] };

/** "AAAA-MM-DD" → valor de coluna DATE (meia-noite UTC, sem fuso). */
export const fromDateOnly = (date: string) => new Date(`${date}T00:00:00Z`);

// Status do Asaas logo após uma ação nossa (criação/retomada); o resto chega pelo webhook (spec 04).
const STATUS_FROM_ASAAS: Record<string, ChargeStatus> = {
  PENDING: 'PENDING',
  RECEIVED: 'PAID',
  RECEIVED_IN_CASH: 'PAID',
  CONFIRMED: 'CONFIRMED',
  OVERDUE: 'OVERDUE',
};

export const statusFromAsaas = (status: string): ChargeStatus => STATUS_FROM_ASAAS[status] ?? 'PENDING';

export function toChargeDetailDto(
  row: ChargeWithRelations,
  events: Array<Pick<WebhookEvent, 'id' | 'event' | 'receivedAt' | 'processedAt' | 'result'>>,
  role: Role,
): ChargeDetailDto {
  return {
    id: row.id,
    customer: { id: row.customer.id, name: row.customer.name, document: documentFor(row.customer.document, role) },
    origin: row.origin,
    type: row.type,
    status: row.status,
    billingType: row.billingType,
    valueCents: row.valueCents,
    netValueCents: row.netValueCents,
    refundedCents: row.refundedCents,
    discountCents: row.discountCents,
    finePct: row.finePct.toNumber(),
    interestPct: row.interestPct.toNumber(),
    dueDate: toDateOnly(row.dueDate),
    paidAt: row.paidAt ? toDateOnly(row.paidAt) : null,
    description: row.description,
    installmentNumber: row.installmentNumber,
    installmentCount: row.installmentCount,
    groupKey: row.groupKey,
    asaasPaymentId: row.asaasPaymentId,
    asaasInstallmentId: row.asaasInstallmentId,
    invoiceUrl: row.invoiceUrl,
    bankSlipUrl: row.bankSlipUrl,
    pixPayload: row.pixPayload,
    identificationField: row.identificationField,
    lastError: row.lastError,
    contractId: row.contractId,
    subscriptionId: row.subscriptionId,
    items: row.items.map((i) => ({
      id: i.id,
      serviceId: i.serviceId,
      description: i.description,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents,
      totalCents: i.totalCents,
    })),
    events: events.map((e) => ({
      id: e.id,
      event: e.event,
      receivedAt: e.receivedAt.toISOString(),
      processedAt: e.processedAt?.toISOString() ?? null,
      result: e.result,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
