---
name: spec-design
description: Escreve o design.md de um módulo a partir do requirements.md aprovado — endpoints, schemas zod, dados, regras, jobs, erros, front e plano de testes.
argument-hint: <NN-modulo>
arguments: [modulo]
disable-model-invocation: true
---

Você vai escrever `docs/specs/$modulo/design.md`.

1. Leia `docs/specs/$modulo/requirements.md`. Se o status não for `Aprovado`, avise e pergunte se o usuário quer aprovar antes ou seguir assim mesmo.
2. Leia `CLAUDE.md`, `docs/architecture/stack.md`, `docs/architecture/overview.md`, `docs/architecture/data-model.md`, os ADRs em `docs/architecture/decisions/`, a integração relevante em `docs/integrations/` e os designs das specs das quais este módulo depende.
3. Escreva seguindo `docs/specs/_templates/design.md`. Toda seção deve citar os IDs de requisito que atende. Obrigatório:
   - tabela de API com método, rota, papel, corpo/query, resposta e IDs;
   - schemas zod que irão para `packages/shared`;
   - regras não triviais como algoritmo passo a passo (transações, locks, idempotência);
   - tabela de erros com código, HTTP e quando;
   - plano de testes por nível cobrindo todos os IDs.
4. Mudanças de schema: edite também `docs/architecture/data-model.md` e cite a mudança no Changelog do design.
5. Decisão relevante e não óbvia (nova dependência, padrão diferente, trade-off) → crie um ADR novo em `docs/architecture/decisions/` e adicione ao índice.
6. Faça uma checagem de rastreabilidade: liste qualquer ID do requirements que não apareça no design e resolva antes de terminar.
7. Status `Em revisão`; atualize `docs/specs/README.md`; peça aprovação.
