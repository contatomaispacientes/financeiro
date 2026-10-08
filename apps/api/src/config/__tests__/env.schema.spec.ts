import { validateEnv } from '../env.schema';

describe('validateEnv', () => {
  const validEnv = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    ASAAS_API_KEY: '$aact_sandbox_key',
    ASAAS_WEBHOOK_TOKEN: 'c'.repeat(32),
  };

  it('[FND-01.4] accepts valid environment', () => {
    const result = validateEnv(validEnv);
    expect(result.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(result.NODE_ENV).toBe('development');
    expect(result.PORT).toBe(3000);
  });

  it('[FND-01.4] rejects missing DATABASE_URL and lists the variable', () => {
    const { DATABASE_URL: _, ...env } = validEnv;
    expect(() => validateEnv(env)).toThrow('DATABASE_URL');
  });

  it('[FND-01.4] rejects short JWT_ACCESS_SECRET', () => {
    expect(() => validateEnv({ ...validEnv, JWT_ACCESS_SECRET: 'short' })).toThrow(
      'JWT_ACCESS_SECRET',
    );
  });

  it('[FND-01.4] rejects missing ASAAS_API_KEY', () => {
    const { ASAAS_API_KEY: _, ...env } = validEnv;
    expect(() => validateEnv(env)).toThrow('ASAAS_API_KEY');
  });

  it('[FND-01.4] lists multiple missing variables at once', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
    try {
      validateEnv({});
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('DATABASE_URL');
      expect(msg).toContain('JWT_ACCESS_SECRET');
      expect(msg).toContain('JWT_REFRESH_SECRET');
      expect(msg).toContain('ASAAS_API_KEY');
      expect(msg).toContain('ASAAS_WEBHOOK_TOKEN');
    }
  });

  it('[FND-01.4] rejects invalid NODE_ENV', () => {
    expect(() => validateEnv({ ...validEnv, NODE_ENV: 'staging' })).toThrow('NODE_ENV');
  });

  it('applies defaults for optional fields', () => {
    const result = validateEnv(validEnv);
    expect(result.ASAAS_ENV).toBe('sandbox');
    expect(result.CONTRACT_PROVIDER).toBe('fake');
    expect(result.STORAGE_DRIVER).toBe('local');
    expect(result.SMTP_PORT).toBe(1025);
  });
});
