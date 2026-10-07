# CLAUDE.md — Financeiro

Plataforma interna de gestão financeira de uma única empresa: clientes, catálogo de serviços, cobranças no **Asaas** (avulsa, parcelada, recorrente), **contratos assinados no Clicksign** que disparam a cobrança, contas a pagar e fluxo de caixa.

Este projeto é feito com **Spec-Driven Development (SDD)**: nada é implementado sem uma spec aprovada.

## Leia antes de qualquer tarefa

- Visão e escopo: @docs/product/visao.md
- Stack e convenções: @docs/architecture/stack.md
- Arquitetura e fluxos: @docs/architecture/overview.md
- Modelo de dados (fonte da verdade): @docs/architecture/data-model.md
- Índice e status das specs: @docs/specs/README.md

Leia sob demanda (não carregue sempre):
- Integração Asaas: `docs/integrations/asaas.md`
- Provedor de contratos (interface/adapter): `docs/integrations/contratos-provider.md`
- Clicksign API v3 (mapeamento, webhook HMAC, runbook): `docs/integrations/contratos-clicksign.md`
- Decisões de arquitetura: `docs/architecture/decisions/`
- Telas: `docs/product/telas.md`
- Mapeamento original (referência histórica): `docs/reference/mapeamento-avanceai-asaas.md`

## Fluxo SDD (obrigatório)

Cada módulo vive em `docs/specs/NN-modulo/` com três arquivos, nesta ordem:

1. `requirements.md` — o QUÊ. Histórias + critérios de aceite em formato EARS, com IDs (`COB-03`, `COB-03.2`).
2. `design.md` — o COMO. Endpoints, DTOs, tabelas, estados, erros, jobs, decisões.
3. `tasks.md` — a SEQUÊNCIA. Checklist de tarefas pequenas, cada uma ligada a IDs de requisitos.

Regras:
- **Não escreva código de um módulo cujo `requirements.md` e `design.md` não estejam com status `Aprovado`.** Se o usuário pedir, avise e ofereça fechar a spec antes.
- Implemente **uma tarefa de `tasks.md` por vez**, na ordem. Ao terminar, marque `[x]` e informe os IDs cobertos.
- Se a implementação mostrar que a spec está errada ou incompleta, **pare, atualize a spec primeiro** (e o `Changelog` no fim do arquivo) e só então continue.
- O modelo de dados só muda via `docs/architecture/data-model.md` + migration Prisma no mesmo commit.
- Toda decisão relevante e não óbvia vira um ADR em `docs/architecture/decisions/`.
- Skills do projeto: `/spec-novo`, `/spec-design`, `/spec-tarefas`, `/spec-implementar`, `/spec-revisar`, `/spec-status`.

## Stack (resumo — detalhes em stack.md)

- Monorepo **pnpm workspaces**: `apps/api` (NestJS + TypeScript), `apps/web` (React + Vite + TypeScript), `packages/shared` (schemas zod, tipos, enums, utilitários de dinheiro/data).
- **PostgreSQL** + **Prisma** (migrations versionadas). **Redis** + **BullMQ** para filas e jobs agendados.
- Front: React Router, TanStack Query, react-hook-form + zod, Tailwind CSS + shadcn/ui, Recharts.
- Testes: Jest + Supertest + Testcontainers (api), Vitest (shared), Vitest + Testing Library (web), Playwright (e2e, a partir do M3).

## Regras de código que não se negociam

- **Dinheiro é inteiro em centavos** (`*_cents`, tipo `Int`/`BigInt`). Nunca `float`. Conversão só na borda (UI e payload do Asaas, que usa decimal) via `packages/shared/money.ts`.
- **Datas de vencimento são `DATE`** (sem hora). "Hoje" é sempre calculado em `America/Sao_Paulo` (`packages/shared/date.ts`). Timestamps em UTC (`timestamptz`).
- **A cobrança vive no Asaas**; a tabela `charges` é um espelho. Status de cobrança só muda por: (a) resposta síncrona de uma chamada nossa ao Asaas, (b) webhook, (c) job de reconciliação. Nunca por edição manual.
- **Webhooks são idempotentes**: persistir evento bruto → responder 200 → processar em fila. Chave única `(source, external_event_id)`.
- Toda chamada externa (Asaas, provedor de contrato, e-mail) passa por um **client/adapter** em `apps/api/src/integrations/*`, nunca direto de um service de domínio.
- Contrato assinado gera cobrança pelo **mesmo caminho** da Nova Cobrança: `ChargesService.createFromPlan(customerId, plan, origin)`. Um único `ChargePlanSchema` (zod) em `packages/shared`.
- Validação de entrada com zod (schemas de `packages/shared`) via `ZodValidationPipe`. O front usa os mesmos schemas.
- Nunca logar CPF/CNPJ, chave de API, token de webhook ou payload completo de cliente. Use `maskDocument()`.
- Erros de domínio com códigos estáveis (`CHARGE_ALREADY_PAID`, `ASAAS_UNAVAILABLE`…) — ver tabela de erros em cada `design.md`.
- Textos de interface em **português do Brasil**. Código, nomes de tabela e de variável em **inglês**.

## Comandos (após a fundação existir)

```bash
pnpm install
docker compose up -d            # postgres + redis
pnpm --filter api prisma migrate dev
pnpm dev                        # api + web em paralelo
pnpm test                       # todos os testes
pnpm --filter api test:e2e      # integração com Testcontainers
pnpm lint && pnpm typecheck
```

Webhooks em dev: exponha a API com um túnel (cloudflared ou ngrok) e cadastre no **sandbox** de cada serviço:
- Asaas: `https://<túnel>/api/v1/webhooks/asaas`
- Clicksign: `https://<túnel>/api/v1/webhooks/contracts/clicksign` (guarde o segredo HMAC em `CLICKSIGN_HMAC_SECRET`)

## Definição de pronto (por tarefa)

- Critérios de aceite dos IDs cobertos têm teste automatizado (unitário ou integração).
- `pnpm lint`, `pnpm typecheck` e `pnpm test` passam.
- Migration criada se o schema mudou; `data-model.md` atualizado.
- `tasks.md` marcado; commit no formato `feat(cobrancas): cria cobrança avulsa [COB-01, COB-02]`.

## Não faça

- Não chame a API de produção do Asaas nem do Clicksign em testes ou em dev. `ASAAS_ENV=sandbox` e `CLICKSIGN_ENV=sandbox` são o padrão; produção só com variável explícita. Testes automatizados usam `nock` e o `FakeContractProvider`.
- Não crie migrations destrutivas sem avisar.
- Não adicione dependências fora de `stack.md` sem registrar um ADR.
- Não implemente funcionalidades listadas como "Fora de escopo" em `visao.md`.
