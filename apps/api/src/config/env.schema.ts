import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
  APP_TIMEZONE: z.string().default('America/Sao_Paulo'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Redis
  REDIS_URL: z.string().min(1, 'REDIS_URL is required').default('redis://localhost:6379'),
  // Prefixo das chaves do BullMQ. Os testes usam um por arquivo para não herdar jobs de outro arquivo.
  QUEUE_PREFIX: z.string().min(1).default('bull'),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),

  // Asaas
  // mock = Asaas simulado, sem conta (ADR-016)
  ASAAS_ENV: z.enum(['sandbox', 'production', 'mock']).default('sandbox'),
  ASAAS_API_KEY: z.string().default(''),
  ASAAS_WEBHOOK_TOKEN: z.string().min(32, 'ASAAS_WEBHOOK_TOKEN must be at least 32 characters'),
  ASAAS_MIN_CHARGE_CENTS: z.coerce.number().int().positive().default(500),

  // Contracts
  CONTRACT_PROVIDER: z.enum(['fake', 'clicksign']).default('fake'),
  CLICKSIGN_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  CLICKSIGN_ACCESS_TOKEN: z.string().optional(),
  CLICKSIGN_HMAC_SECRET: z.string().optional(),
  FAKE_CONTRACT_WEBHOOK_SECRET: z.string().optional(),

  // Storage
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),

  // Mail
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('financeiro@local.test'),

  // Seed
  SEED_ADMIN_EMAIL: z.email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(10).optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validates environment variables and returns typed config.
 * Throws with a list of issues if invalid.
 */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  const issues = result.success ? [] : result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
  // Fora do schema para aparecer junto com os demais erros: a chave só é dispensada no Asaas simulado (ADR-016).
  if (config['ASAAS_ENV'] !== 'mock' && !config['ASAAS_API_KEY']) {
    issues.push('  - ASAAS_API_KEY: required (or use ASAAS_ENV=mock)');
  }
  if (!result.success || issues.length > 0) {
    throw new Error(`Invalid environment variables:\n${issues.join('\n')}`);
  }

  return result.data;
}
