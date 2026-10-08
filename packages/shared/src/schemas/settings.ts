import { z } from 'zod';
import { isValidCpfOrCnpj, onlyDigits } from '../document.js';

export const ReminderChannelEnum = z.enum(['ASAAS', 'EMAIL', 'WHATSAPP']);

export const SettingsUpdateSchema = z
  .object({
    companyName: z.string().trim().max(120).nullable(),
    companyDocument: z
      .string()
      .refine(isValidCpfOrCnpj, 'CPF ou CNPJ inválido')
      .transform(onlyDigits)
      .nullable(),
    companyCity: z.string().trim().max(80).nullable(),
    defaultDueDays: z.number().int().min(0).max(60),
    defaultFinePct: z.number().min(0).max(10),
    defaultInterestPct: z.number().min(0).max(10),
    contractChargeDueDays: z.number().int().min(0).max(60),
    reminderDaysBefore: z.number().int().min(0).max(30),
    reminderOnDueDate: z.boolean(),
    reminderDaysAfter: z.array(z.number().int().min(1).max(60)).max(5),
    reminderChannels: z.array(ReminderChannelEnum).min(1),
    companySignerName: z.string().trim().min(2).max(120).nullable(),
    companySignerEmail: z.string().trim().toLowerCase().email().nullable(),
    companySignerPhone: z
      .string()
      .regex(/^\d{10,11}$/, 'Telefone com DDD, só números')
      .nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Informe ao menos um campo' });
export type SettingsUpdateInput = z.infer<typeof SettingsUpdateSchema>;

export interface SettingsDto {
  companyName: string | null;
  companyDocument: string | null;
  companyCity: string | null;
  defaultDueDays: number;
  defaultFinePct: number;
  defaultInterestPct: number;
  contractChargeDueDays: number;
  reminderDaysBefore: number;
  reminderOnDueDate: boolean;
  reminderDaysAfter: number[];
  reminderChannels: Array<z.infer<typeof ReminderChannelEnum>>;
  companySignerName: string | null;
  companySignerEmail: string | null;
  companySignerPhone: string | null;
  updatedAt: string;
}

export interface EnvironmentDto {
  asaasEnv: 'sandbox' | 'production';
}

export interface ConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  error: { code: string; message: string } | null;
  testedAt: string;
}

export interface IntegrationsStatusDto {
  asaas: {
    env: 'sandbox' | 'production';
    apiKeyConfigured: boolean;
    webhookTokenConfigured: boolean;
    webhookPath: string;
    lastTest: (ConnectionTestResult & { testedBy: string | null }) | null;
  };
  contracts: {
    provider: 'fake' | 'clicksign';
    env: 'sandbox' | 'production';
    accessTokenConfigured: boolean;
    hmacSecretConfigured: boolean;
    webhookPath: string;
  };
  mail: {
    configured: boolean;
    host: string;
    port: number;
    from: string;
  };
}
