import { z } from '../zod.js';
import type { ReminderKind } from '../enums.js';

export const REMINDER_KINDS = ['CREATED', 'BEFORE_DUE', 'ON_DUE', 'AFTER_DUE', 'MANUAL', 'PAID', 'REFUNDED', 'CANCELED'] as const;
// Mesmo conjunto do enum ReminderKind (enums.ts), em ordem de exibição.
export type ReminderChannelName = 'ASAAS' | 'EMAIL' | 'WHATSAPP';
export type ReminderStatusName = 'SENT' | 'FAILED' | 'SKIPPED';

export const reminderKindLabels: Record<ReminderKind, string> = {
  CREATED: 'Cobrança emitida',
  BEFORE_DUE: 'Lembrete antes do vencimento',
  ON_DUE: 'Vence hoje',
  AFTER_DUE: 'Cobrança em atraso',
  MANUAL: 'Envio manual',
  PAID: 'Pagamento confirmado',
  REFUNDED: 'Estorno',
  CANCELED: 'Cobrança cancelada',
};

/** REG-01.2 */
export const REMINDER_VARIABLES = [
  'cliente',
  'valor',
  'vencimento',
  'link',
  'pix',
  'linha_digitavel',
  'empresa',
  'servicos',
  'parcela',
  'dias_para_vencer',
  'dias_atraso',
  'data_pagamento',
  'valor_estornado',
] as const;
export type ReminderVariable = (typeof REMINDER_VARIABLES)[number];

const COMMON: ReminderVariable[] = ['cliente', 'valor', 'vencimento', 'link', 'empresa', 'servicos', 'parcela'];
const PAYMENT: ReminderVariable[] = ['pix', 'linha_digitavel'];

/** Design da spec 08, "Variáveis por tipo" (REG-01.4). */
export const VARIABLES_BY_KIND: Record<ReminderKind, ReminderVariable[]> = {
  CREATED: [...COMMON, ...PAYMENT],
  BEFORE_DUE: [...COMMON, ...PAYMENT, 'dias_para_vencer'],
  ON_DUE: [...COMMON, ...PAYMENT],
  AFTER_DUE: [...COMMON, ...PAYMENT, 'dias_atraso'],
  MANUAL: [...COMMON, ...PAYMENT],
  PAID: [...COMMON, 'data_pagamento'],
  REFUNDED: [...COMMON, 'valor_estornado'],
  CANCELED: COMMON,
};

const VARIABLE_PATTERN = /\{([a-z_]+)\}/g;

export type TemplateCheck =
  | { ok: true }
  | { ok: false; code: 'REMINDER_UNKNOWN_VARIABLE' | 'REMINDER_VARIABLE_NOT_AVAILABLE'; variable: string };

/** REG-01.4: variável fora do catálogo ou não disponível no tipo. */
export function checkTemplateVariables(kind: ReminderKind, ...texts: Array<string | null | undefined>): TemplateCheck {
  for (const text of texts) {
    for (const [, name] of (text ?? '').matchAll(VARIABLE_PATTERN)) {
      if (!(REMINDER_VARIABLES as readonly string[]).includes(name!)) return { ok: false, code: 'REMINDER_UNKNOWN_VARIABLE', variable: name! };
      if (!VARIABLES_BY_KIND[kind].includes(name as ReminderVariable)) return { ok: false, code: 'REMINDER_VARIABLE_NOT_AVAILABLE', variable: name! };
    }
  }
  return { ok: true };
}

/** Substitui `{variavel}`; vazia some e espaços duplos se juntam (ex.: `{parcela}` em cobrança avulsa). */
export function renderReminderText(text: string, values: Partial<Record<ReminderVariable, string | null>>): string {
  return text
    .replace(VARIABLE_PATTERN, (_, name: string) => values[name as ReminderVariable] ?? '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
    .trim();
}

/** REG-08.5: textos padrão (seed e "Restaurar padrão"). PAID, REFUNDED e CANCELED começam desativados. */
export const DEFAULT_REMINDER_TEMPLATES: Record<ReminderKind, { subject: string; body: string; active: boolean }> = {
  CREATED: {
    subject: 'Sua cobrança de {valor}',
    body: 'Olá, {cliente}!\n\nSegue a cobrança de {servicos} {parcela}, no valor de {valor}, com vencimento em {vencimento}.\n\nPague por aqui: {link}\n\nPix copia e cola: {pix}\n\n{empresa}',
    active: true,
  },
  BEFORE_DUE: {
    subject: 'Lembrete: {valor} vence em {vencimento}',
    body: 'Olá, {cliente}!\n\nFaltam {dias_para_vencer} dias para o vencimento da sua cobrança de {valor} ({vencimento}).\n\nPague por aqui: {link}\n\n{empresa}',
    active: true,
  },
  ON_DUE: {
    subject: 'Sua cobrança vence hoje',
    body: 'Olá, {cliente}!\n\nSua cobrança de {valor} vence hoje, {vencimento}.\n\nPague por aqui: {link}\n\nPix copia e cola: {pix}\n\n{empresa}',
    active: true,
  },
  AFTER_DUE: {
    subject: 'Cobrança em aberto há {dias_atraso} dias',
    body: 'Olá, {cliente}!\n\nNão identificamos o pagamento de {valor}, vencido em {vencimento}. Se já pagou, desconsidere esta mensagem.\n\nPague por aqui: {link}\n\n{empresa}',
    active: true,
  },
  MANUAL: {
    subject: 'Cobrança {empresa} — {valor}',
    body: 'Olá, {cliente}!\n\nSegue o link da sua cobrança de {valor}, com vencimento em {vencimento}: {link}\n\nPix copia e cola: {pix}\nLinha digitável: {linha_digitavel}\n\n{empresa}',
    active: true,
  },
  PAID: {
    subject: 'Pagamento confirmado',
    body: 'Olá, {cliente}!\n\nRecebemos o pagamento de {valor} em {data_pagamento}. Obrigado!\n\n{empresa}',
    active: false,
  },
  REFUNDED: {
    subject: 'Estorno realizado',
    body: 'Olá, {cliente}!\n\nEstornamos {valor_estornado} da cobrança de {valor}. O valor volta pelo mesmo meio de pagamento.\n\n{empresa}',
    active: false,
  },
  CANCELED: {
    subject: 'Cobrança cancelada',
    body: 'Olá, {cliente}!\n\nA cobrança de {valor} com vencimento em {vencimento} foi cancelada. Nada precisa ser pago.\n\n{empresa}',
    active: false,
  },
};

// ───────── API ─────────

export const ReminderTemplateUpsertSchema = z.object({
  kind: z.enum(REMINDER_KINDS),
  channel: z.enum(['EMAIL', 'WHATSAPP']),
  offsetDays: z.number().int().min(-30).max(60).nullable().default(null),
  subject: z.string().trim().max(200).nullable().default(null),
  body: z.string().trim().min(1, { error: 'Escreva a mensagem' }).max(5000),
  active: z.boolean().default(true),
});
export type ReminderTemplateUpsertInput = z.infer<typeof ReminderTemplateUpsertSchema>;

export const ReminderPreviewSchema = z.object({
  chargeId: z.uuid().optional(),
  kind: z.enum(REMINDER_KINDS),
  offsetDays: z.number().int().nullable().optional(),
  subject: z.string().nullable().optional(),
  body: z.string(),
});
export type ReminderPreviewInput = z.infer<typeof ReminderPreviewSchema>;

export const ReminderListQuerySchema = z.object({
  chargeId: z.uuid().optional(),
  status: z.enum(['SENT', 'FAILED', 'SKIPPED']).optional(),
  days: z.coerce.number().int().min(1).max(90).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ReminderListQuery = z.infer<typeof ReminderListQuerySchema>;

export const ChargeSendSchema = z.object({ channel: z.enum(['EMAIL']).default('EMAIL') });

export interface ReminderTemplateDto {
  id: string;
  kind: ReminderKind;
  channel: 'EMAIL' | 'WHATSAPP';
  offsetDays: number | null;
  subject: string | null;
  body: string;
  active: boolean;
  /** Texto igual ao padrão (REG-08.4). */
  isDefault: boolean;
  updatedAt: string;
}

export interface ReminderLogDto {
  id: string;
  charge: { id: string; customerName: string; valueCents: number };
  kind: ReminderKind;
  channel: ReminderChannelName;
  offsetDays: number;
  referenceDate: string;
  status: ReminderStatusName;
  error: string | null;
  sentAt: string;
}

export interface ReminderListDto {
  data: ReminderLogDto[];
  meta: { page: number; pageSize: number; total: number };
  summary: Record<ReminderStatusName, number>;
}

export interface ReminderPreviewDto {
  subject: string;
  text: string;
  html: string;
}
