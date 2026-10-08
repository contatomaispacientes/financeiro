import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { nextCpf } from '../fixtures/documents';
import { createTestApp } from './test-app';

/** Expressão de busca da migration 20261008120000: precisa ser idêntica para usar o índice. */
const SEARCH = `public.f_unaccent(lower(name)) LIKE '%' || public.f_unaccent(lower($1)) || '%'`;

describe('[CLI-NF1] busca de clientes por nome', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = `T${Date.now()}`;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const names = ['José da Conceição', 'Comércio Rápido ME', 'ANA OLIVEIRA', 'São João Padaria', 'Pedro Álvares'];
    await prisma.customer.createMany({
      data: names.map((name) => ({ name: `${name} ${tag}`, personType: 'PF' as const, document: nextCpf() })),
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  async function search(term: string): Promise<string[]> {
    const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM customers WHERE ${SEARCH} AND name LIKE $2 ORDER BY name`,
      term,
      `%${tag}`,
    );
    return rows.map((r) => r.name.replace(` ${tag}`, ''));
  }

  it.each([
    ['sem acento acha com acento', 'jose', ['José da Conceição']],
    ['com acento acha com acento', 'conceição', ['José da Conceição']],
    ['ignora maiúsculas', 'COMERCIO rapido', ['Comércio Rápido ME']],
    ['trecho no meio do nome', 'liveir', ['ANA OLIVEIRA']],
    ['acento só na busca', 'Sâo jóão', ['São João Padaria']],
    ['vários resultados', 'ão', ['José da Conceição', 'São João Padaria']],
    ['nada encontrado', 'inexistente', []],
  ])('%s: "%s"', async (_label, term, expected) => {
    expect(await search(term)).toEqual(expected);
  });

  it('o índice trigram é usado pela consulta', async () => {
    // Com poucas linhas o planejador prefere varrer a tabela; desligando o seq scan vemos se o índice serve.
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      return tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
        `EXPLAIN SELECT id FROM customers WHERE ${SEARCH}`,
        'oliveira',
      );
    });
    expect(plan.map((row) => row['QUERY PLAN']).join('\n')).toContain('customers_name_search_idx');
  });
});
