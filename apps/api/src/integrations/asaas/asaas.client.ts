import { fromCents, type Cycle } from '@financeiro/shared';

export const ASAAS_CLIENT = Symbol('ASAAS_CLIENT');

export type AsaasErrorCode =
  | 'ASAAS_VALIDATION'
  | 'ASAAS_AUTH'
  | 'ASAAS_NOT_FOUND'
  | 'ASAAS_RATE_LIMITED'
  | 'ASAAS_UNAVAILABLE'
  | 'ASAAS_UNEXPECTED';

export interface AsaasPingResult {
  ok: boolean;
  latencyMs: number;
  error: { code: AsaasErrorCode; message: string } | null;
}

/** Campos do cliente no Asaas (POST/PUT /customers). */
export interface AsaasCustomerInput {
  name: string;
  cpfCnpj: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  postalCode?: string;
  address?: string;
  addressNumber?: string;
  complement?: string;
  province?: string;
  externalReference?: string;
  notificationDisabled?: boolean;
}

export interface AsaasCustomer {
  id: string;
  name: string;
  cpfCnpj: string;
  deleted?: boolean;
}

export type AsaasBillingType = 'PIX' | 'BOLETO' | 'CREDIT_CARD' | 'UNDEFINED';

/** POST /payments (avulsa). Centavos e percentuais; `asaasPaymentBody` converte para o formato do Asaas. */
export interface AsaasPaymentInput {
  customer: string;
  billingType: AsaasBillingType;
  valueCents: number;
  dueDate: string;
  description: string;
  externalReference: string;
  finePct: number;
  interestPct: number;
  /** Parcelada: o Asaas cria o parcelamento e divide `totalValueCents` (COB-03). */
  installmentCount?: number;
  totalValueCents?: number;
}

export interface AsaasPayment {
  id: string;
  customer: string;
  /** Status do Asaas (PENDING, RECEIVED, CONFIRMED, OVERDUE, REFUNDED…). */
  status: string;
  billingType: AsaasBillingType;
  valueCents: number;
  netValueCents: number | null;
  dueDate: string;
  paymentDate: string | null;
  description: string | null;
  externalReference: string | null;
  installment: string | null;
  installmentNumber: number | null;
  subscription: string | null;
  invoiceUrl: string | null;
  bankSlipUrl: string | null;
  deleted: boolean;
}

export interface AsaasPaymentFilter {
  externalReference?: string;
  installment?: string;
  subscription?: string;
  offset?: number;
  limit?: number;
}

/** POST /subscriptions (COB-04). */
export interface AsaasSubscriptionInput {
  customer: string;
  billingType: AsaasBillingType;
  valueCents: number;
  nextDueDate: string;
  cycle: Cycle;
  endDate?: string | null;
  description: string;
  externalReference: string;
  finePct: number;
  interestPct: number;
}

export interface AsaasSubscription {
  id: string;
  customer: string;
  /** ACTIVE, INACTIVE, EXPIRED. */
  status: string;
  billingType: AsaasBillingType;
  valueCents: number;
  nextDueDate: string;
  cycle: Cycle;
  endDate: string | null;
  description: string | null;
  externalReference: string | null;
  deleted: boolean;
}

export interface AsaasPage<T> {
  data: T[];
  hasMore: boolean;
  totalCount: number;
}

export interface AsaasPixQrCode {
  encodedImage: string;
  payload: string;
  expirationDate: string | null;
}

export interface AsaasIdentificationField {
  identificationField: string;
  barCode: string;
}

/** Contrato interno com o Asaas (docs/integrations/asaas.md). Valores em centavos. */
export interface AsaasClient {
  ping(): Promise<AsaasPingResult>;
  findCustomerByDocument(cpfCnpj: string): Promise<AsaasCustomer | null>;
  createCustomer(input: AsaasCustomerInput): Promise<AsaasCustomer>;
  updateCustomer(id: string, input: AsaasCustomerInput): Promise<AsaasCustomer>;

  /** Nunca repete sozinho: antes de criar de novo, busque por `externalReference` (COB-12.2). */
  createPayment(input: AsaasPaymentInput): Promise<AsaasPayment>;
  getPayment(id: string): Promise<AsaasPayment>;
  listPayments(filter: AsaasPaymentFilter): Promise<AsaasPage<AsaasPayment>>;
  deletePayment(id: string): Promise<void>;
  getPixQrCode(id: string): Promise<AsaasPixQrCode>;
  getIdentificationField(id: string): Promise<AsaasIdentificationField>;
  /** Estorno total (sem valor) ou parcial; o status muda pelo webhook (COB-09). */
  refundPayment(id: string, valueCents?: number, description?: string): Promise<AsaasPayment>;

  createSubscription(input: AsaasSubscriptionInput): Promise<AsaasSubscription>;
  getSubscription(id: string): Promise<AsaasSubscription>;
  listSubscriptions(filter: { externalReference?: string }): Promise<AsaasPage<AsaasSubscription>>;
  deleteSubscription(id: string): Promise<void>;
}

/**
 * Corpo de POST /payments (asaas.md, "Mapeamento ChargePlan → Asaas"): valor já com o desconto
 * abatido, multa e juros nos campos próprios. Também exibido na prévia (COB-01.4).
 */
export function asaasPaymentBody(input: AsaasPaymentInput) {
  return {
    customer: input.customer,
    billingType: input.billingType,
    ...(input.installmentCount
      ? { installmentCount: input.installmentCount, totalValue: fromCents(input.totalValueCents ?? input.valueCents) }
      : { value: fromCents(input.valueCents) }),
    dueDate: input.dueDate,
    description: input.description,
    externalReference: input.externalReference,
    ...(input.finePct > 0 && { fine: { value: input.finePct, type: 'PERCENTAGE' as const } }),
    ...(input.interestPct > 0 && { interest: { value: input.interestPct } }),
  };
}

/** Corpo de POST /subscriptions. */
export function asaasSubscriptionBody(input: AsaasSubscriptionInput) {
  return {
    customer: input.customer,
    billingType: input.billingType,
    value: fromCents(input.valueCents),
    nextDueDate: input.nextDueDate,
    cycle: input.cycle,
    ...(input.endDate && { endDate: input.endDate }),
    description: input.description,
    externalReference: input.externalReference,
    ...(input.finePct > 0 && { fine: { value: input.finePct, type: 'PERCENTAGE' as const } }),
    ...(input.interestPct > 0 && { interest: { value: input.interestPct } }),
  };
}

export const ASAAS_BASE_URLS = {
  sandbox: 'https://api-sandbox.asaas.com/v3',
  production: 'https://api.asaas.com/v3',
} as const;
