# ADR-014 — Versões fixadas e exceções à "última estável"

**Status:** Aceito · 07/10/2026 · Complementa o `stack.md` ("fixar a última estável/LTS; não use beta")

## Contexto
O scaffold da fundação (tarefas 1–9) ficou com várias majors atrasadas (Vite 6, Vitest 3, zod 3, ESLint 9, React Router 7, msw 2, nock 14, Node 22). Na atualização, nem toda "última versão" do npm podia ser adotada.

## Decisão
Atualizado para a última estável: Node **24 LTS** (`.nvmrc` e `engines`), Vite 8, `@vitejs/plugin-react` 6, Vitest 5, zod 4, ESLint 10, React Router 8, msw 3, nock 15, jest-dom 7, ioredis 6, `@types/node` 24.

Exceções:

| Pacote | Fica em | Motivo |
| --- | --- | --- |
| `typescript` | **6.0.x** (não 7.0) | O TypeScript 7 é o compilador nativo e ainda não é aceito pelo `typescript-eslint` (`<6.1.0`) nem pelo `@nestjs/swagger` (`^5.5 \|\| ^6`). Reavaliar quando os dois suportarem. |
| `prisma`, `@prisma/client` | **7.x** | A tag `latest` do npm aponta para `8.0.0-rc` — release candidate, proibido pelo `stack.md`. |
| `@types/node` | **24.x** (não 26) | Acompanha a major do Node em uso. |

Consequências da atualização:
- **TypeScript 6** deprecia `moduleResolution: node` e `baseUrl`: a API passou a `module`/`moduleResolution: NodeNext` (continua emitindo CommonJS e importa o `shared`, ESM, via `require()` do Node 22.12+); o web dispensou `baseUrl`.
- **zod 4**: APIs atuais (`z.email()`, `z.url()`, `z.uuid()`, `{ error }` em `refine`, `ZodType`). As mensagens de validação passam a sair em **pt-BR** com `z.config(z.locales.ptBR())` em `packages/shared/src/zod.ts`, carregado pelo `shared` (vale para API e web).
- **Vitest 4+**: `poolOptions` foi removido (a integração da API usa `fileParallelism: false`) e `dist/` deixou de ser excluído por padrão (cada pacote declara `include` em `src/`; o build do `shared` não compila testes).
- **nock 15**: `.delay()` atrasa só o corpo; timeouts são simulados com `reply` assíncrono.
- **msw 3**: `onUnhandledRequest` virou `onUnhandledFrame`.

Uma checagem pontual com `@typescript-eslint/no-deprecated` (lint com tipos) não encontrou uso de API depreciada após a atualização.

## Consequências
- `pnpm outdated -r` deve listar só as exceções acima. Ao atualizar de novo, conferir os peers (`npm view <pacote> peerDependencies`) antes de subir major.
