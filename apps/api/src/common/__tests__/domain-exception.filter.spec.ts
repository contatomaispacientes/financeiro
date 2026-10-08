import { ForbiddenException, HttpStatus, Logger, UnauthorizedException } from '@nestjs/common';
import {
  DomainException,
  DomainExceptionFilter,
} from '../filters/domain-exception.filter';

describe('DomainExceptionFilter', () => {
  const filter = new DomainExceptionFilter();
  Logger.overrideLogger(false);

  const mockResponse = () => {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    return res;
  };

  const mockHost = (res: ReturnType<typeof mockResponse>) =>
    ({
      switchToHttp: () => ({
        getResponse: () => res,
        getRequest: () => ({}),
      }),
    }) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  it('formats DomainException as { error: { code, message } }', () => {
    const exception = new DomainException(
      'CHARGE_ALREADY_PAID',
      'Cobrança já está paga',
      HttpStatus.CONFLICT,
    );
    const res = mockResponse();

    filter.catch(exception, mockHost(res));

    expect(res.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'CHARGE_ALREADY_PAID',
        message: 'Cobrança já está paga',
      },
    });
  });

  it('includes details when provided', () => {
    const exception = new DomainException(
      'VALIDATION_ERROR',
      'Dados inválidos',
      HttpStatus.BAD_REQUEST,
      [{ path: 'email', message: 'required' }],
    );
    const res = mockResponse();

    filter.catch(exception, mockHost(res));

    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Dados inválidos',
        details: [{ path: 'email', message: 'required' }],
      },
    });
  });

  it('maps a plain HttpException to the standard error body', () => {
    const res = mockResponse();
    filter.catch(new UnauthorizedException(), mockHost(res));
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'UNAUTHORIZED', message: 'Não autenticado' },
    });
  });

  it('keeps an HttpException body that already has error.code', () => {
    const res = mockResponse();
    const body = { error: { code: 'FORBIDDEN', message: 'Sem permissão para esta ação' } };
    filter.catch(new ForbiddenException(body), mockHost(res));
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(body);
  });

  it('hides unexpected errors behind 500 INTERNAL_ERROR', () => {
    const res = mockResponse();
    filter.catch(new Error('db password leaked in message'), mockHost(res));
    expect(res.status).toHaveBeenCalledWith(500);
    const sent = JSON.stringify(res.json.mock.calls[0]?.[0]);
    expect(sent).toContain('INTERNAL_ERROR');
    expect(sent).not.toContain('password');
  });

  it('defaults to 422 HTTP status', () => {
    const exception = new DomainException('SOME_ERROR', 'msg');
    const res = mockResponse();

    filter.catch(exception, mockHost(res));

    expect(res.status).toHaveBeenCalledWith(HttpStatus.UNPROCESSABLE_ENTITY);
  });
});
