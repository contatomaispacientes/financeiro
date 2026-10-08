# ADR-001 — Monorepo pnpm com NestJS, React e pacote shared

**Status:** Aceito · 07/10/2026

## Contexto
Backend e frontend compartilham regras de validação (CPF/CNPJ, plano de cobrança, valores) e enums de status. Um time pequeno precisa de um repositório só, com tipagem de ponta a ponta.

## Decisão
pnpm workspaces com `apps/api` (NestJS), `apps/web` (React + Vite) e `packages/shared` (zod + utilitários). Sem Turborepo/Nx no início; scripts na raiz com `pnpm -r`/`--filter`. Prisma como ORM.

## Consequências
- Schemas zod são a fonte única de validação; a API não usa class-validator.
- Mudança em `shared` exige rodar typecheck de todos os workspaces (CI faz).
- Se o build ficar lento, adicionar Turborepo (novo ADR).
