import { Controller, ExecutionContext, ForbiddenException, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';

@Controller()
class FakeController {
  @Roles('ADMIN')
  adminOnly() {}

  @Get()
  open() {}
}

function contextFor(handler: () => void, role?: string): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => FakeController,
    switchToHttp: () => ({
      getRequest: () => ({ user: role ? { sub: 'u1', email: 'a@b.c', role } : undefined }),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ providers: [RolesGuard] }).compile();
    guard = moduleRef.get(RolesGuard);
  });

  it('allows routes without @Roles', () => {
    expect(guard.canActivate(contextFor(FakeController.prototype.open, 'LEITURA'))).toBe(true);
  });

  it('allows a user whose role is listed', () => {
    expect(guard.canActivate(contextFor(FakeController.prototype.adminOnly, 'ADMIN'))).toBe(true);
  });

  it('[FND-03.3] rejects a role outside the allowed list with 403 FORBIDDEN', () => {
    let caught: unknown;
    try {
      guard.canActivate(contextFor(FakeController.prototype.adminOnly, 'FINANCEIRO'));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ForbiddenException);
    const body = (caught as ForbiddenException).getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('[FND-03.3] rejects when there is no authenticated user', () => {
    expect(() => guard.canActivate(contextFor(FakeController.prototype.adminOnly))).toThrow(
      ForbiddenException,
    );
  });
});
