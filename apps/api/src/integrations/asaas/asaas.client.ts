export const ASAAS_CLIENT = Symbol('ASAAS_CLIENT');

export interface AsaasPingResult {
  ok: boolean;
  latencyMs: number;
  error: { code: AsaasErrorCode; message: string } | null;
}

export type AsaasErrorCode = 'ASAAS_AUTH' | 'ASAAS_RATE_LIMITED' | 'ASAAS_UNAVAILABLE' | 'ASAAS_UNEXPECTED';

/** Contrato interno com o Asaas (docs/integrations/asaas.md). Valores em centavos. Os demais métodos chegam na spec 03. */
export interface AsaasClient {
  ping(): Promise<AsaasPingResult>;
}

export const ASAAS_BASE_URLS = {
  sandbox: 'https://api-sandbox.asaas.com/v3',
  production: 'https://api.asaas.com/v3',
} as const;
