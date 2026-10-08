import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import {
  ASAAS_BASE_URLS,
  type AsaasClient,
  type AsaasErrorCode,
  type AsaasPingResult,
} from './asaas.client';

const TIMEOUT_MS = 15_000;
const USER_AGENT = 'financeiro/0.1.0';

const MESSAGES: Record<AsaasErrorCode, string> = {
  ASAAS_AUTH: 'Chave de API recusada pelo Asaas. Confira ASAAS_API_KEY e o ambiente.',
  ASAAS_RATE_LIMITED: 'O Asaas limitou as requisições. Tente de novo em instantes.',
  ASAAS_UNAVAILABLE: 'O Asaas não respondeu. Tente de novo em instantes.',
  ASAAS_UNEXPECTED: 'Resposta inesperada do Asaas.',
};

function codeForStatus(status: number): AsaasErrorCode {
  if (status === 401 || status === 403) return 'ASAAS_AUTH';
  if (status === 429) return 'ASAAS_RATE_LIMITED';
  if (status >= 500) return 'ASAAS_UNAVAILABLE';
  return 'ASAAS_UNEXPECTED';
}

@Injectable()
export class HttpAsaasClient implements AsaasClient {
  private readonly logger = new Logger(HttpAsaasClient.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  timeoutMs = TIMEOUT_MS;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = ASAAS_BASE_URLS[config.get('ASAAS_ENV', { infer: true })];
    this.apiKey = config.get('ASAAS_API_KEY', { infer: true });
  }

  /** Diagnóstico: sem retry, para o usuário ver o resultado na hora. */
  async ping(): Promise<AsaasPingResult> {
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);

    try {
      const res = await fetch(`${this.baseUrl}/finance/balance`, {
        method: 'GET',
        headers: {
          access_token: this.apiKey,
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      await res.body?.cancel();

      if (res.ok) return { ok: true, latencyMs: elapsed(), error: null };

      const code = codeForStatus(res.status);
      this.logger.warn(`Asaas ping falhou: HTTP ${res.status} (${code})`);
      return { ok: false, latencyMs: elapsed(), error: { code, message: MESSAGES[code] } };
    } catch (error) {
      this.logger.warn(`Asaas ping sem resposta: ${(error as Error).name}`);
      return {
        ok: false,
        latencyMs: elapsed(),
        error: { code: 'ASAAS_UNAVAILABLE', message: MESSAGES.ASAAS_UNAVAILABLE },
      };
    }
  }
}
