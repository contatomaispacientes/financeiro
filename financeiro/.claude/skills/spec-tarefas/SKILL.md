---
name: spec-tarefas
description: Quebra requirements.md + design.md aprovados de um módulo em tasks.md — tarefas pequenas, ordenadas, cada uma com testes e IDs de requisitos.
argument-hint: <NN-modulo>
arguments: [modulo]
disable-model-invocation: true
---

Você vai escrever `docs/specs/$modulo/tasks.md`.

1. Leia `requirements.md` e `design.md` do módulo. Ambos devem estar `Aprovado`; se não estiverem, avise e pare.
2. Leia `docs/specs/_templates/tasks.md` e o `tasks.md` de uma spec já aprovada (ex.: `00-fundacao`) como referência de granularidade.
3. Regras para as tarefas:
   - cada tarefa cabe em uma sessão de trabalho (algumas horas), deixa o sistema funcionando e termina com testes passando;
   - ordem: shared/schemas → dados/migrations → integração externa → serviço e API → front → E2E;
   - cada tarefa lista os testes que precisa ter e os IDs que cobre (`_Requisitos: …_`);
   - nada de tarefa "genérica" (ex.: "ajustes finais").
4. Rastreabilidade: monte (só na resposta, não no arquivo) uma tabela ID → tarefa(s). Todo ID do requirements precisa aparecer em pelo menos uma tarefa.
5. Status `Em revisão`; atualize `docs/specs/README.md`; peça aprovação.
