import { z } from '../zod.js';
import { isValidCpfOrCnpj, onlyDigits } from '../document.js';
import type {
  BillingType,
  ChargeStatus,
  ChargeType,
  ContractStatus,
  Cycle,
  PersonType,
  SubscriptionStatus,
} from '../enums.js';

export const BRAZILIAN_STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

/** Texto opcional: espaços aparados; vazio vira `null` (no PATCH, `null` apaga o valor). */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const AddressSchema = z.object({
  postalCode: z
    .string()
    .transform(onlyDigits)
    .pipe(z.string().regex(/^\d{8}$/, { error: 'CEP com 8 dígitos' })),
  street: z.string().trim().min(2, { error: 'Informe o logradouro' }).max(120),
  number: z.string().trim().min(1, { error: 'Informe o número (ou "S/N")' }).max(20),
  complement: optionalText(60),
  district: z.string().trim().min(2, { error: 'Informe o bairro' }).max(80),
  city: z.string().trim().min(2, { error: 'Informe a cidade' }).max(80),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.enum(BRAZILIAN_STATES, { error: 'UF inválida' })),
});
export type Address = z.infer<typeof AddressSchema>;

// Sem defaults: o CustomerUpdateSchema (= base.partial()) não pode reaplicar default num PATCH.
const CustomerBaseSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { error: 'Informe o nome (mínimo 2 caracteres)' })
    .max(120, { error: 'Nome com no máximo 120 caracteres' }),
  // CLI-01.4: aceita com máscara, guarda só dígitos.
  document: z
    .string()
    .transform(onlyDigits)
    .refine(isValidCpfOrCnpj, { error: 'CPF ou CNPJ inválido' }),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.union([z.literal('').transform(() => null), z.email({ error: 'E-mail inválido' })]))
    .nullable()
    .optional(),
  phone: z
    .string()
    .transform(onlyDigits)
    .pipe(
      z.union([
        z.literal('').transform(() => null),
        z.string().regex(/^\d{10,11}$/, { error: 'Celular com DDD (10 ou 11 dígitos)' }),
      ]),
    )
    .nullable()
    .optional(),
  address: AddressSchema.nullable().optional(),
  notes: optionalText(2000),
  remindersEnabled: z.boolean(), // régua e notificações do Asaas (spec 08, REG-05.1)
});

export const CustomerCreateSchema = CustomerBaseSchema.extend({
  remindersEnabled: z.boolean().default(true),
});
export type CustomerCreateInput = z.infer<typeof CustomerCreateSchema>;

export const CustomerUpdateSchema = CustomerBaseSchema.partial();
export type CustomerUpdateInput = z.infer<typeof CustomerUpdateSchema>;

/** Endereço de cobrança completo: obrigatório para contrato (CLI-01.5 / CTR-02.9). */
export function isAddressComplete(address: unknown): boolean {
  return address != null && AddressSchema.safeParse(address).success;
}

/** CLI-01.1: o tipo vem do tamanho do documento (11 dígitos = PF, 14 = PJ). */
export function personTypeFromDocument(document: string): PersonType {
  return onlyDigits(document).length === 14 ? 'PJ' : 'PF';
}

export const CustomerLookupQuerySchema = z.object({
  document: z
    .string()
    .transform(onlyDigits)
    .refine(isValidCpfOrCnpj, { error: 'CPF ou CNPJ inválido' }),
});

export interface CustomerDto {
  id: string;
  name: string;
  personType: PersonType;
  /** Só dígitos; para o papel LEITURA vem mascarado (ex.: "***.982.247-**", CLI-02.4). */
  document: string;
  email: string | null;
  phone: string | null;
  address: Address | null;
  notes: string | null;
  remindersEnabled: boolean;
  asaasCustomerId: string | null;
  asaasSyncError: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Totais do cliente (CLI-02.2, CLI-03.1):
 * pago = PAID/CONFIRMED/PARTIALLY_REFUNDED pelo valor menos o estornado;
 * em aberto = PENDING + OVERDUE (inclui o vencido); vencido = OVERDUE;
 * cobranças = todas exceto DRAFT e CANCELED.
 */
export interface CustomerTotals {
  chargesCount: number;
  paidCents: number;
  openCents: number;
  overdueCents: number;
}

export interface CustomerChargeSummary {
  id: string;
  description: string;
  type: ChargeType;
  status: ChargeStatus;
  billingType: BillingType;
  valueCents: number;
  dueDate: string;
  paidAt: string | null;
  installmentNumber: number | null;
  installmentCount: number | null;
  asaasPaymentId: string | null;
}

export interface CustomerSubscriptionSummary {
  id: string;
  description: string;
  status: SubscriptionStatus;
  cycle: Cycle;
  valueCents: number;
  nextDueDate: string;
}

export interface CustomerContractSummary {
  id: string;
  title: string;
  status: ContractStatus;
  totalCents: number;
  sentAt: string | null;
  signedAt: string | null;
  createdAt: string;
}

export interface CustomerDetailDto extends CustomerDto {
  totals: CustomerTotals;
  /** 20 mais recentes. */
  recentCharges: CustomerChargeSummary[];
  /** Só as ativas. */
  subscriptions: CustomerSubscriptionSummary[];
  /** 20 mais recentes. */
  contracts: CustomerContractSummary[];
}

export type CustomerLookupDto =
  | { exists: false }
  | { exists: true; customerId: string; name: string; archived: boolean };
