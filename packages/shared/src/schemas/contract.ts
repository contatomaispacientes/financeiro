import { z } from '../zod.js';
import { onlyDigits } from '../document.js';
import { ContractStatus } from '../enums.js';
import type { ChargeType, SignerRole, SignerStatus } from '../enums.js';
import { ChargePlanSchema, type ChargePlan, type PlanCalculation } from './charge-plan.js';
import type { ChargeListItemDto, SubscriptionListItemDto } from './charges.js';

/** Catálogo de variáveis dos modelos (docs/integrations/contratos-provider.md). */
export const VARIABLE_CATALOG = [
  'cliente.nome',
  'cliente.documento',
  'cliente.tipo',
  'cliente.email',
  'cliente.telefone',
  'cliente.endereco',
  'empresa.nome',
  'empresa.documento',
  'servicos.lista',
  'servicos.total',
  'cobranca.desconto',
  'cobranca.valor_total',
  'cobranca.forma',
  'cobranca.condicao',
  'cobranca.vencimento',
  'cobranca.multa',
  'cobranca.juros',
  'contrato.data',
  'contrato.cidade',
] as const;
export type ContractVariable = (typeof VARIABLE_CATALOG)[number];

export const variableLabels: Record<ContractVariable, string> = {
  'cliente.nome': 'Nome do cliente',
  'cliente.documento': 'CPF/CNPJ do cliente',
  'cliente.tipo': 'Pessoa física ou jurídica',
  'cliente.email': 'E-mail do cliente',
  'cliente.telefone': 'Telefone do cliente',
  'cliente.endereco': 'Endereço do cliente',
  'empresa.nome': 'Nome da empresa',
  'empresa.documento': 'CNPJ da empresa',
  'servicos.lista': 'Lista de serviços',
  'servicos.total': 'Total dos serviços',
  'cobranca.desconto': 'Desconto',
  'cobranca.valor_total': 'Valor total',
  'cobranca.forma': 'Forma de pagamento',
  'cobranca.condicao': 'Condição (parcelas/recorrência)',
  'cobranca.vencimento': 'Vencimento',
  'cobranca.multa': 'Multa',
  'cobranca.juros': 'Juros',
  'contrato.data': 'Data do contrato',
  'contrato.cidade': 'Cidade do contrato',
};

export const CONTRACT_PROVIDERS = ['fake', 'clicksign'] as const;
export type ContractProviderName = (typeof CONTRACT_PROVIDERS)[number];

// ───────── Modelos (CTR-01) ─────────

export const TemplateUpsertSchema = z.object({
  name: z.string().trim().min(2, { error: 'Nome com ao menos 2 caracteres' }).max(120),
  provider: z.enum(CONTRACT_PROVIDERS),
  providerTemplateId: z.string().trim().min(1, { error: 'Informe o ID do modelo no provedor' }).max(200),
  /** Campo do provedor → variável do catálogo. Variável fora do catálogo: TEMPLATE_UNKNOWN_VARIABLE (CTR-01.3). */
  variableMap: z.record(z.string().trim().min(1).max(100), z.string()),
  active: z.boolean().default(true),
});
export type TemplateUpsertInput = z.infer<typeof TemplateUpsertSchema>;
export const TemplateUpdateSchema = TemplateUpsertSchema.partial();
export type TemplateUpdateInput = z.infer<typeof TemplateUpdateSchema>;

export interface ContractTemplateDto {
  id: string;
  name: string;
  provider: ContractProviderName;
  providerTemplateId: string;
  variableMap: Record<string, ContractVariable>;
  active: boolean;
  createdAt: string;
}

// ───────── Contratos (CTR-02) ─────────

export const AUTH_METHODS = ['email', 'whatsapp', 'sms'] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];
export const authMethodLabels: Record<AuthMethod, string> = { email: 'E-mail', whatsapp: 'WhatsApp', sms: 'SMS' };

export const SignerInputSchema = z
  .object({
    role: z.enum(['CLIENT', 'COMPANY']),
    name: z.string().trim().min(2, { error: 'Informe o nome' }).max(120),
    email: z.string().trim().toLowerCase().pipe(z.email({ error: 'E-mail inválido' })),
    phone: z
      .string()
      .transform(onlyDigits)
      .optional()
      .transform((v) => v || undefined),
    document: z.string().transform(onlyDigits).optional(),
    signOrder: z.number().int().min(1).max(6).default(1),
    authMethod: z.enum(AUTH_METHODS).default('email'),
  })
  .refine((s) => s.authMethod === 'email' || (s.phone && /^\d{10,11}$/.test(s.phone)), {
    path: ['phone'],
    error: 'Celular obrigatório para WhatsApp ou SMS',
  });
export type SignerInput = z.input<typeof SignerInputSchema>;

const signersSchema = z
  .array(SignerInputSchema)
  .min(2, { error: 'Inclua o cliente e ao menos um signatário da empresa' })
  .max(6, { error: 'No máximo 6 signatários' })
  .refine((s) => s.filter((x) => x.role === 'CLIENT').length === 1, { error: 'Inclua o cliente como signatário (uma vez)' })
  .refine((s) => s.some((x) => x.role === 'COMPANY'), { error: 'Inclua ao menos um signatário da empresa' });

export const ContractDraftSchema = z.object({
  customerId: z.uuid(),
  templateId: z.uuid({ error: 'Escolha o modelo' }),
  title: z.string().trim().min(3, { error: 'Título com ao menos 3 caracteres' }).max(150),
  chargePlan: ChargePlanSchema,
  signers: signersSchema,
  validDays: z.number().int().min(1).max(90).default(15),
});
export type ContractDraftInput = z.input<typeof ContractDraftSchema>;
export type ContractDraft = z.infer<typeof ContractDraftSchema>;

/** Rascunho editável (CTR-02.7): tudo menos o cliente. */
export const ContractUpdateSchema = ContractDraftSchema.omit({ customerId: true }).partial();
export type ContractUpdateInput = z.infer<typeof ContractUpdateSchema>;

export const ContractListQuerySchema = z.object({
  status: z.enum(ContractStatus).optional(),
  customerId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ContractListQuery = z.infer<typeof ContractListQuerySchema>;

export const ContractCancelSchema = z.object({ reason: z.string().trim().max(200).optional() });

export interface ContractListItemDto {
  id: string;
  title: string;
  customer: { id: string; name: string };
  status: ContractStatus;
  totalCents: number;
  planType: ChargeType;
  sentAt: string | null;
  signedAt: string | null;
  expiresAt: string | null;
  chargeGeneratedAt: string | null;
  chargeError: string | null;
  createdAt: string;
}

export interface ContractSignerDto {
  id: string;
  role: SignerRole;
  name: string;
  email: string;
  phone: string | null;
  signOrder: number;
  authMethod: AuthMethod;
  status: SignerStatus;
  signUrl: string | null;
  signedAt: string | null;
}

export interface ContractEventDto {
  id: string;
  event: string;
  receivedAt: string;
  processedAt: string | null;
  result: string | null;
}

export interface ContractDetailDto extends ContractListItemDto {
  template: { id: string; name: string };
  provider: ContractProviderName;
  providerError: string | null;
  chargePlan: ChargePlan;
  validDays: number;
  /** Snapshot enviado ao provedor (vazio enquanto rascunho). */
  variables: Record<string, string>;
  hasSignedFile: boolean;
  signers: ContractSignerDto[];
  charges: ChargeListItemDto[];
  subscription: SubscriptionListItemDto | null;
  events: ContractEventDto[];
}

/** `POST /contracts/:id/preview` e prévia de modelo (CTR-01.4, CTR-02.5, CTR-02.6). */
export interface ContractPreviewDto {
  /** Valor de cada variável do catálogo (null = não dá para preencher). */
  variables: Record<ContractVariable, string | null>;
  /** Campos do modelo → valor resolvido. */
  fields: Record<string, string | null>;
  /** Variáveis usadas pelo modelo e vazias, e campos do endereço que faltam. */
  missing: ContractVariable[];
  addressComplete: boolean;
  plan: PlanCalculation | null;
  planError: string | null;
}
