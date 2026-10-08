# Financeiro

[![CI](https://github.com/contatomaispacientes/financeiro/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/contatomaispacientes/financeiro/actions/workflows/ci.yml)

Plataforma interna de gestão financeira: clientes, serviços, cobranças no Asaas (avulsa, parcelada, recorrente), contratos assinados no Clicksign que geram a cobrança, contas a pagar e fluxo de caixa.

> Fase atual: **M0 — Fundação** (spec `00-fundacao`): monorepo, API com autenticação, usuários, configurações e auditoria, e o front com login e telas de administração. Status de cada spec em [`docs/specs/README.md`](docs/specs/README.md).

## Rodando localmente

Pré-requisitos: Node 24 (`.nvmrc`), pnpm 12 e Docker.

```bash
pnpm install                         # também compila o packages/shared e gera o client do Prisma
cp apps/api/.env.example apps/api/.env
docker compose up -d                 # Postgres, Redis e Mailpit
pnpm db:migrate                      # migrations
pnpm db:seed                         # admin@financeiro.local / SEED_ADMIN_PASSWORD do .env
pnpm dev                             # API em :3000, web em :5173
```

- Web: http://localhost:5173 · Documentação da API: http://localhost:3000/api/docs · E-mails de teste (Mailpit): http://localhost:8025
- Qualidade: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` (integração com Postgres e Redis reais via Testcontainers; precisa do Docker).

## Como o trabalho é feito

O projeto segue **Spec-Driven Development** com o Claude Code: nada é implementado sem spec aprovada.

1. Status das specs: peça "leia o CLAUDE.md e me dê o status das specs" ou rode `/spec-status`.
2. Implemente tarefa por tarefa: `/spec-implementar <módulo>`.
3. Ao terminar um módulo: `/spec-revisar <módulo>`.

## Mapa da documentação

| Arquivo | Conteúdo |
| --- | --- |
| `CLAUDE.md` | Regras do projeto para o Claude Code (lido automaticamente) |
| `docs/product/visao.md` | Problema, objetivos, usuários, escopo, glossário |
| `docs/product/telas.md` | Telas e padrões de interface |
| `docs/architecture/stack.md` | Stack, estrutura de pastas, convenções, variáveis de ambiente |
| `docs/architecture/overview.md` | Módulos, filas, fluxos (cobrança, contrato, webhook, reconciliação), estados |
| `docs/architecture/data-model.md` | Schema Prisma alvo e regras de integridade |
| `docs/architecture/decisions/` | ADRs |
| `docs/integrations/asaas.md` | Contrato com a API do Asaas, webhook, runbook |
| `docs/integrations/contratos-provider.md` | Interface do provedor de assinatura e FakeProvider |
| `docs/integrations/contratos-clicksign.md` | Clicksign API v3: envelopes, modelos, webhook HMAC, runbook |
| `docs/specs/` | Uma pasta por módulo com `requirements.md`, `design.md`, `tasks.md` |
| `docs/reference/` | Mapeamento original da AvanceAI |
