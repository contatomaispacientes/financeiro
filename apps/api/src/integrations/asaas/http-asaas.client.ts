import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { DomainException } from '../../common/filters/domain-exception.filter';
import {
  ASAAS_BASE_URLS,
  type AsaasClient,
  type AsaasCustomer,
  type AsaasCustomerInput,
  type AsaasErrorCode,
  type AsaasPingResult,
} from './asaas.client';

const USER_AGENT = 'financeiro/0.1.0';

const MESSAGES: Record<AsaasErrorCode, string> = {
  ASAAS_VALIDATION: 'O Asaas recusou os dados enviados.',
  ASAAS_AUTH: 'Chave de API recusada pelo Asaas. Confira ASAAS_API_KEY e o ambiente.',
  ASAAS_NOT_FOUND: 'Registro não encontrado no Asaas.',
  ASAAS_RATE_LIMITED: 'O Asaas limitou as requisições. Tente de novo em instantes.',
  ASAAS_UNAVAILABLE: 'O Asaas não respondeu. Tente de novo em instantes.',
  ASAAS_UNEXPECTED: 'Resposta inesperada do Asaas.',
};

// docs/integrations/asaas.md, "Erros do Asaas → erros de domínio"
const HTTP_FOR: Record<AsaasErrorCode, number> = {
  ASAAS_VALIDATION: HttpStatus.UNPROCESSABLE_ENTITY,
  ASAAS_AUTH: HttpStatus.BAD_GATEWAY,
  ASAAS_NOT_FOUND: HttpStatus.NOT_FOUND,
  ASAAS_RATE_LIMITED: HttpStatus.SERVICE_UNAVAILABLE,
  ASAAS_UNAVAILABLE: HttpStatus.BAD_GATEWAY,
  ASAAS_UNEXPECTED: HttpStatus.BAD_GATEWAY,
};

function codeForStatus(status: number): AsaasErrorCode {
  if (status === 400) return 'ASAAS_VALIDATION';
  if (status === 401 || status === 403) return 'ASAAS_AUTH';
  if (status === 404) return 'ASAAS_NOT_FOUND';
  if (status === 429) return 'ASAAS_RATE_LIMITED';
  if (status >= 500) return 'ASAAS_UNAVAILABLE';
  return 'ASAAS_UNEXPECTED';
}

export class AsaasError extends DomainException {
  constructor(
    readonly asaasCode: AsaasErrorCode,
    readonly retryable: boolean,
    details?: unknown,
  ) {
    const errors = (details as { errors?: Array<{ description?: string }> } | undefined)?.errors;
    const message = asaasCode === 'ASAAS_VALIDATION' && errors?.[0]?.description
      ? `Asaas: ${errors.map((e) => e.description).join('; ')}`
      : MESSAGES[asaasCode];
    super(asaasCode, message, HTTP_FOR[asaasCode], details);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

@Injectable()
export class HttpAsaasClient implements AsaasClient {
  private readonly logger = new Logger(HttpAsaasClient.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  timeoutMs = 15_000;
  /** Espera entre tentativas (asaas.md: 3×, 1s/3s/9s). Só GET/PUT/DELETE repetem: POST pode duplicar. */
  retryDelaysMs = [1_000, 3_000, 9_000];

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = ASAAS_BASE_URLS[config.get('ASAAS_ENV', { infer: true })];
    this.apiKey = config.get('ASAAS_API_KEY', { infer: true });
  }

  /** Diagnóstico: sem retry, para o usuário ver o resultado na hora. */
  async ping(): Promise<AsaasPingResult> {
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    try {
      await this.request('GET', '/finance/balance', undefined, false);
      return { ok: true, latencyMs: elapsed(), error: null };
    } catch (error) {
      const code = error instanceof AsaasError ? error.asaasCode : 'ASAAS_UNAVAILABLE';
      return { ok: false, latencyMs: elapsed(), error: { code, message: MESSAGES[code] } };
    }
  }

  async findCustomerByDocument(cpfCnpj: string): Promise<AsaasCustomer | null> {
    const page = await this.request<{ data: AsaasCustomer[] }>('GET', `/customers?cpfCnpj=${encodeURIComponent(cpfCnpj)}`);
    return page.data.find((c) => !c.deleted) ?? null;
  }

  createCustomer(input: AsaasCustomerInput): Promise<AsaasCustomer> {
    return this.request('POST', '/customers', input);
  }

  updateCustomer(id: string, input: AsaasCustomerInput): Promise<AsaasCustomer> {
    return this.request('PUT', `/customers/${encodeURIComponent(id)}`, input);
  }

  private async request<T>(method: Method, path: string, body?: unknown, retry = method !== 'POST'): Promise<T> {
    const delays = retry ? this.retryDelaysMs : [];
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once<T>(method, path, body);
      } catch (error) {
        const retryable = error instanceof AsaasError && error.retryable;
        if (!retryable || attempt >= delays.length) throw error;
        this.logger.warn(`Asaas ${method} ${path.split('?')[0]} falhou (${(error as AsaasError).asaasCode}); nova tentativa`);
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      }
    }
  }

  private async once<T>(method: Method, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers: { access_token: this.apiKey, 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new AsaasError('ASAAS_UNAVAILABLE', true);
    }

    const text = await res.text();
    const json: unknown = text ? safeJson(text) : undefined;
    if (res.ok) return json as T;

    const code = codeForStatus(res.status);
    // Nunca logar o corpo: pode ter dados do cliente.
    this.logger.warn(`Asaas ${method} ${path.split('?')[0]} → HTTP ${res.status} (${code})`);
    throw new AsaasError(code, code === 'ASAAS_UNAVAILABLE' || code === 'ASAAS_RATE_LIMITED', json);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
