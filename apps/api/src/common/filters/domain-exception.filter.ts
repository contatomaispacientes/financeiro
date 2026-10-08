import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

export class DomainException extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number = HttpStatus.UNPROCESSABLE_ENTITY,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainException';
  }
}

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

const DEFAULT_ERRORS: Record<number, { code: string; message: string }> = {
  400: { code: 'VALIDATION_ERROR', message: 'Dados inválidos' },
  401: { code: 'UNAUTHORIZED', message: 'Não autenticado' },
  403: { code: 'FORBIDDEN', message: 'Sem permissão para esta ação' },
  404: { code: 'NOT_FOUND', message: 'Recurso não encontrado' },
  409: { code: 'CONFLICT', message: 'Conflito de estado' },
  429: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Aguarde um minuto.' },
};

function isErrorBody(value: unknown): value is ErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as ErrorBody).error?.code === 'string'
  );
}

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const [status, body] = this.toResponse(exception);
    response.status(status).json(body);
  }

  private toResponse(exception: unknown): [number, ErrorBody] {
    if (exception instanceof DomainException) {
      return [
        exception.httpStatus,
        {
          error: {
            code: exception.code,
            message: exception.message,
            ...(exception.details ? { details: exception.details } : {}),
          },
        },
      ];
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      if (isErrorBody(payload)) return [status, payload];
      const fallback = DEFAULT_ERRORS[status] ?? { code: 'HTTP_ERROR', message: 'Erro na requisição' };
      return [status, { error: fallback }];
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    return [
      HttpStatus.INTERNAL_SERVER_ERROR,
      { error: { code: 'INTERNAL_ERROR', message: 'Erro interno. Tente novamente.' } },
    ];
  }
}
