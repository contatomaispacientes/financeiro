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

/** Contrato interno com o Asaas (docs/integrations/asaas.md). Valores em centavos. */
export interface AsaasClient {
  ping(): Promise<AsaasPingResult>;
  findCustomerByDocument(cpfCnpj: string): Promise<AsaasCustomer | null>;
  createCustomer(input: AsaasCustomerInput): Promise<AsaasCustomer>;
  updateCustomer(id: string, input: AsaasCustomerInput): Promise<AsaasCustomer>;
}

export const ASAAS_BASE_URLS = {
  sandbox: 'https://api-sandbox.asaas.com/v3',
  production: 'https://api.asaas.com/v3',
} as const;
