---
name: spec-implementar
description: Implementa a próxima tarefa aberta (ou a indicada) do tasks.md de um módulo, com testes, seguindo requirements e design aprovados.
argument-hint: <NN-modulo> [número da tarefa]
arguments: [modulo, tarefa]
disable-model-invocation: true
---

Implemente **uma** tarefa de `docs/specs/$modulo/tasks.md`.

1. Confira que `requirements.md`, `design.md` e `tasks.md` de `$modulo` estão `Aprovado`. Se algum não estiver, pare e diga qual.
2. Escolha a tarefa: `$tarefa` se informada; senão a primeira com `[ ]`. Confira que as tarefas anteriores estão `[x]` e que as specs das quais o módulo depende já implementaram o necessário; se faltar algo, pare e explique.
3. Releia os critérios dos IDs citados na tarefa, a parte correspondente do design, `CLAUDE.md` e `docs/architecture/stack.md`.
4. Antes de codar, mostre um plano curto (arquivos a criar/alterar, testes) e siga.
5. Escreva os testes dos critérios de aceite com o ID no nome (`it('[COB-02.3] …')`) e implemente até passarem. Respeite as regras não negociáveis do `CLAUDE.md` (centavos, datas, espelho do Asaas, idempotência, adapters, sem segredos em log).
6. Rode `pnpm lint`, `pnpm typecheck` e os testes afetados (e a suíte de integração se tocou em API/banco). Corrija até ficar verde.
7. Se descobrir que a spec está errada ou incompleta: pare, proponha a alteração no requirements/design (com linha no Changelog) e só continue após o usuário concordar.
8. Mudou o schema? Migration Prisma + `docs/architecture/data-model.md` na mesma tarefa.
9. Marque a tarefa `[x]` no `tasks.md`, informe os IDs cobertos e proponha a mensagem de commit no padrão `feat(<modulo>): <resumo> [IDs]`. Faça o commit só se o usuário pedir.
10. Não comece a próxima tarefa sem o usuário pedir.
