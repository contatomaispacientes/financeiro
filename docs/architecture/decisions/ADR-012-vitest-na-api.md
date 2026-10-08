# ADR-012 — Vitest na API (no lugar do Jest) e dependências do scaffold

**Status:** Aceito · 07/10/2026 · Altera o ADR-001 e o `stack.md` (testes da API)

## Contexto
No scaffold da fundação (FND tarefa 1) foram fixadas as versões estáveis atuais: NestJS 12, Prisma 7, BullMQ 6. O NestJS 12 é publicado como ESM e usa `import.meta` internamente. Com isso:

1. O Jest 29 com `ts-jest` em modo CommonJS não carrega `@nestjs/common` (`Cannot use import statement outside a module` / `import.meta`).
2. O modo ESM do Jest (`--experimental-vm-modules` + `useESM`) quebra os próprios arquivos de teste (`exports is not defined`) e é experimental.
3. O Vitest roda ESM nativamente, tem a mesma API de testes (`describe/it/expect`, `vi` no lugar de `jest`) e já é usado no `shared` e no `web`.
4. O transformador padrão do Vitest (esbuild) não emite `emitDecoratorMetadata`, do qual o DI do NestJS depende. O `@swc/core` resolveria, mas nesta máquina o binário nativo se recusa a carregar porque `C:\Users` concede `FullControl` ao grupo **Todos** (checagem de segurança do SWC).

## Decisão
- A API usa **Vitest + Supertest** (unitário e integração). Testcontainers e `nock` continuam como no `stack.md`.
- O `vitest.config.ts` da API transforma `.ts` com `typescript.transpileModule` (`experimentalDecorators` + `emitDecoratorMetadata`) num plugin de ~20 linhas, sem dependência nova. Se o SWC voltar a carregar, pode substituir o plugin por `unplugin-swc` sem mudar os testes.
- Dependências do scaffold registradas aqui:
  - `dotenv` — exigido pelo `prisma.config.ts` do Prisma 7, que não carrega `.env` sozinho.
  - `pino-pretty` — formatação dos logs só fora de produção (em produção o log é JSON puro).
  - `@types/express` — tipos de `Request`/`Response` nos filtros e controllers.
  - `ioredis` — no BullMQ 6 o cliente Redis virou dependência opcional (o BullMQ passou a aceitar outros backends); sem ele nenhuma fila conecta.
- `engines.node` passa a `>=22.12.0`: a API compila para CommonJS e importa o `shared` (ESM) via `require()`, suportado sem flag a partir do Node 22.12. (Depois elevado para Node 24 LTS — ADR-014.)

## Consequências
- `pnpm --filter api test` = `vitest run`; `test:e2e` = `vitest run --config vitest.e2e.config.ts`.
- Testes da API usam `vi.fn()` no lugar de `jest.fn()`.
- O transformador TS é mais lento que esbuild/SWC; aceitável no tamanho atual do projeto. Reavaliar se a suíte passar de alguns minutos.
- Pendência de máquina (fora do repositório): a ACL de `C:\Users` com `FullControl` para Todos é insegura e não é o padrão do Windows.
