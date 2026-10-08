---
name: spec-revisar
description: Revisa a implementação de um módulo contra os critérios de aceite da spec — rastreabilidade ID → teste → código — e aponta lacunas.
argument-hint: <NN-modulo>
arguments: [modulo]
---

Revise o módulo `$modulo` sem alterar código de produção.

1. Leia `requirements.md`, `design.md` e `tasks.md` de `docs/specs/$modulo/`.
2. Para cada critério (`<PFX>-NN.M`), procure:
   - teste que cite o ID no nome (busca pelo ID nos arquivos de teste);
   - implementação correspondente (rota, service, componente) conforme o design.
3. Confira também: rotas e códigos de erro do design existem e batem; schemas zod em `packages/shared`; regras do `CLAUDE.md` (centavos, datas em São Paulo, status só por Asaas/webhook/reconciliação, logs sem dados sensíveis); papéis da matriz de permissões.
4. Responda com uma tabela `ID | Teste | Implementação | Situação (ok / sem teste / divergente / ausente)` e uma lista priorizada do que corrigir.
5. Se tudo estiver ok e todas as tarefas `[x]`, ofereça marcar o `requirements.md` como `Implementado` e atualizar `docs/specs/README.md`.
