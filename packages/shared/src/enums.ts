/**
 * All enums mirroring the Prisma data model.
 * Single source of truth for API and web.
 */

export const Role = {
  ADMIN: 'ADMIN',
  FINANCEIRO: 'FINANCEIRO',
  LEITURA: 'LEITURA',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const PersonType = {
  PF: 'PF',
  PJ: 'PJ',
} as const;
export type PersonType = (typeof PersonType)[keyof typeof PersonType];

export const ChargeStatus = {
  DRAFT: 'DRAFT',
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  PAID: 'PAID',
  OVERDUE: 'OVERDUE',
  CANCELED: 'CANCELED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  CHARGEBACK: 'CHARGEBACK',
} as const;
export type ChargeStatus = (typeof ChargeStatus)[keyof typeof ChargeStatus];

export const ChargeType = {
  SINGLE: 'SINGLE',
  INSTALLMENT: 'INSTALLMENT',
  RECURRING: 'RECURRING',
} as const;
export type ChargeType = (typeof ChargeType)[keyof typeof ChargeType];

export const ChargeOrigin = {
  MANUAL: 'MANUAL',
  CONTRACT: 'CONTRACT',
  SUBSCRIPTION: 'SUBSCRIPTION',
} as const;
export type ChargeOrigin = (typeof ChargeOrigin)[keyof typeof ChargeOrigin];

export const BillingType = {
  PIX: 'PIX',
  BOLETO: 'BOLETO',
  CREDIT_CARD: 'CREDIT_CARD',
  UNDEFINED: 'UNDEFINED',
} as const;
export type BillingType = (typeof BillingType)[keyof typeof BillingType];

export const Cycle = {
  WEEKLY: 'WEEKLY',
  BIWEEKLY: 'BIWEEKLY',
  MONTHLY: 'MONTHLY',
  BIMONTHLY: 'BIMONTHLY',
  QUARTERLY: 'QUARTERLY',
  SEMIANNUALLY: 'SEMIANNUALLY',
  YEARLY: 'YEARLY',
} as const;
export type Cycle = (typeof Cycle)[keyof typeof Cycle];

export const SubscriptionStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  CANCELED: 'CANCELED',
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const EventSource = {
  ASAAS: 'ASAAS',
  CONTRACT: 'CONTRACT',
  RECONCILE: 'RECONCILE',
} as const;
export type EventSource = (typeof EventSource)[keyof typeof EventSource];

export const ContractStatus = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  PARTIALLY_SIGNED: 'PARTIALLY_SIGNED',
  SIGNED: 'SIGNED',
  REFUSED: 'REFUSED',
  EXPIRED: 'EXPIRED',
  CANCELED: 'CANCELED',
} as const;
export type ContractStatus = (typeof ContractStatus)[keyof typeof ContractStatus];

export const SignerRole = {
  CLIENT: 'CLIENT',
  COMPANY: 'COMPANY',
} as const;
export type SignerRole = (typeof SignerRole)[keyof typeof SignerRole];

export const SignerStatus = {
  PENDING: 'PENDING',
  SIGNED: 'SIGNED',
  REFUSED: 'REFUSED',
} as const;
export type SignerStatus = (typeof SignerStatus)[keyof typeof SignerStatus];

export const ExpenseStatus = {
  OPEN: 'OPEN',
  PAID: 'PAID',
  CANCELED: 'CANCELED',
} as const;
export type ExpenseStatus = (typeof ExpenseStatus)[keyof typeof ExpenseStatus];

export const ChargeRefundKind = {
  REFUND: 'REFUND',
  CHARGEBACK: 'CHARGEBACK',
  CHARGEBACK_REVERSAL: 'CHARGEBACK_REVERSAL',
} as const;
export type ChargeRefundKind = (typeof ChargeRefundKind)[keyof typeof ChargeRefundKind];

export const ReminderKind = {
  CREATED: 'CREATED',
  BEFORE_DUE: 'BEFORE_DUE',
  ON_DUE: 'ON_DUE',
  AFTER_DUE: 'AFTER_DUE',
  MANUAL: 'MANUAL',
  PAID: 'PAID',
  REFUNDED: 'REFUNDED',
  CANCELED: 'CANCELED',
} as const;
export type ReminderKind = (typeof ReminderKind)[keyof typeof ReminderKind];

export const ReminderChannel = {
  ASAAS: 'ASAAS',
  EMAIL: 'EMAIL',
  WHATSAPP: 'WHATSAPP',
} as const;
export type ReminderChannel = (typeof ReminderChannel)[keyof typeof ReminderChannel];

export const ReminderStatus = {
  SENT: 'SENT',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
} as const;
export type ReminderStatus = (typeof ReminderStatus)[keyof typeof ReminderStatus];
