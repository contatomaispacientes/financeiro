import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { inject } from 'vitest';

// Migrations SQL manuais que o schema.prisma não expressa podem fazer o próximo `migrate dev`
// gerar DROP silencioso (data-model.md, "Objetos criados por SQL"). O banco migrado e o schema devem bater.
describe('schema.prisma × migrations', () => {
  it('o banco depois de todas as migrations não diverge do schema.prisma', () => {
    let output = '';
    let exitCode = 0;
    try {
      output = execSync('pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script --exit-code', {
        cwd: resolve(__dirname, '../..'),
        env: { ...process.env, DATABASE_URL: inject('databaseUrl') },
        stdio: 'pipe',
        encoding: 'utf8',
      });
    } catch (error) {
      const failure = error as { status: number; stdout: string; stderr: string };
      exitCode = failure.status;
      output = `${failure.stdout}\n${failure.stderr}`;
    }

    // --exit-code: 0 = sem diferença, 2 = há diferença, 1 = erro.
    expect(exitCode, `O Prisma geraria esta migration:\n${output}`).toBe(0);
  });
});
