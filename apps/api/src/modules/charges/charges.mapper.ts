import type {
  ChargeDetailDto,
  ChargeListItemDto,
  ChargeStatus,
  Role,
  SubscriptionDetailDto,
  SubscriptionListItemDto,
} from '@financeiro/shared';
import type {
  Charge,
  ChargeItem,
  Customer,
  Subscription,
  SubscriptionItem,
  WebhookEvent,
} from '../../generated/prisma/client.js';
import { documentFor, toDateOnly } from '../customers/customers.mapper';

export type ChargeWithRelations = Charge & { customer: Customer; items: ChargeItem[] };
export type ChargeListRow = Charge & {
  customer: Pick<Customer, 'id' | 'name'>;
  subscription: Pick<Subscription, 'cycle'> | null;
};
export type SubscriptionRow = Subscription & { customer: Pick<Customer, 'id' | 'name'> };

/** "AAAA-MM-DD" → valor de coluna DATE (meia-noite UTC, sem fuso). */
export const fromDateOnly = (date: string) => new Date(`${date}T00:00:00Z`);

// Status do Asaas logo após uma ação nossa (criação/retomada); o resto chega pelo webhook (spec 04).
const STATUS_FROM_ASAAS: Record<string, ChargeStatus> = {
  PENDING: 'PENDING',
  RECEIVED: 'PAID',
  RECEIVED_IN_CASH: 'PAID',
  CONFIRMED: 'CONFIRMED',
  OVERDUE: 'OVERDUE',
  REFUNDED: 'REFUNDED',
};

export const statusFromAsaas = (status: string): ChargeStatus => STATUS_FROM_ASAAS[status] ?? 'PENDING';

export function toChargeListItemDto(row: ChargeListRow): ChargeListItemDto {
  return {
    id: row.id,
    customer: { id: row.customer.id, name: row.customer.name },
    description: row.description,
    type: row.type,
    origin: row.origin,
    installmentNumber: row.installmentNumber,
    installmentCount: row.installmentCount,
    cycle: row.subscription?.cycle ?? null,
    billingType: row.billingType,
    dueDate: toDateOnly(row.dueDate),
    paidAt: row.paidAt ? toDateOnly(row.paidAt) : null,
    valueCents: row.valueCents,
    status: row.status,
    asaasPaymentId: row.asaasPaymentId,
    refundRequestedAt: row.refundRequestedAt?.toISOString() ?? null,
  };
}

export function toSubscriptionListItemDto(row: SubscriptionRow): SubscriptionListItemDto {
  return {
    id: row.id,
    customer: { id: row.customer.id, name: row.customer.name },
    description: row.description,
    valueCents: row.valueCents,
    billingType: row.billingType,
    cycle: row.cycle,
    nextDueDate: toDateOnly(row.nextDueDate),
    endDate: row.endDate ? toDateOnly(row.endDate) : null,
    status: row.status,
    asaasSubscriptionId: row.asaasSubscriptionId,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toSubscriptionDetailDto(
  row: SubscriptionRow & { items: SubscriptionItem[] },
  charges: ChargeListRow[],
): SubscriptionDetailDto {
  return {
    ...toSubscriptionListItemDto(row),
    finePct: row.finePct.toNumber(),
    interestPct: row.interestPct.toNumber(),
    contractId: row.contractId,
    items: row.items.map((i) => ({
      id: i.id,
      description: i.description,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents,
      totalCents: i.totalCents,
    })),
    charges: charges.map(toChargeListItemDto),
  };
}

export function toChargeDetailDto(
  row: ChargeWithRelations,
  events: Array<Pick<WebhookEvent, 'id' | 'event' | 'receivedAt' | 'processedAt' | 'result'>>,
  role: Role,
  extra: { installments: ChargeListRow[]; subscription: SubscriptionRow | null } = { installments: [], subscription: null },
): ChargeDetailDto {
  return {
    id: row.id,
    customer: {
      id: row.customer.id,
      name: row.customer.name,
      document: documentFor(row.customer.document, role),
      email: row.customer.email,
    },
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
    refundRequestedAt: row.refundRequestedAt?.toISOString() ?? null,
    contractId: row.contractId,
    subscriptionId: row.subscriptionId,
    installments: extra.installments.map(toChargeListItemDto),
    subscription: extra.subscription ? toSubscriptionListItemDto(extra.subscription) : null,
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
