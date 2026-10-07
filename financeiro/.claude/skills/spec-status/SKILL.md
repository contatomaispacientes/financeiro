---
name: spec-status
description: Atualiza a tabela de status e o progresso das specs em docs/specs/README.md lendo os arquivos de cada módulo. Use quando o usuário perguntar em que pé está o projeto.
allowed-tools: Read Glob Grep Edit
---

1. Para cada pasta `docs/specs/NN-*/` (ignore `_templates`), leia a linha `> Status:` de `requirements.md`, `design.md` e `tasks.md` e conte `[x]` e `[ ]` no `tasks.md`.
2. Atualize a tabela "Índice" de `docs/specs/README.md` com os status e acrescente o progresso das tarefas (ex.: `Aprovado · 4/9`).
3. Responda com um resumo curto: marco atual do roadmap, o que está pronto, a próxima tarefa a fazer (primeira `[ ]` do módulo de menor número com tudo aprovado) e specs que ainda precisam de revisão/aprovação.
