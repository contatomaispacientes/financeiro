# ADR-010 — Ids de job e reenfileiramento no BullMQ

**Status:** Aceito · 07/10/2026 · Complementa o ADR-008

## Contexto
O ADR-008 pede `jobId` determinístico para deduplicar jobs. Na revisão das specs apareceram três armadilhas do BullMQ:

1. Um `jobId` customizado não pode conter `:`, salvo exatamente 3 partes (compatibilidade com jobs repetíveis), nem ser um número inteiro: `queue.add` lança `Custom Id cannot contain :` / `Custom Id cannot be integers`.
2. `queue.add` com um `jobId` que já existe na fila (esperando, ativo, **concluído ou falho ainda retido**) não faz nada — não substitui nem reexecuta.
3. Por isso, um botão "Reprocessar"/"Tentar de novo" que reenfileira com o mesmo `jobId` de um job falho é silenciosamente ignorado.

## Decisão
- **Formato:** `jobId` usa `_` como separador e sempre começa com um prefixo não numérico. Ex.: `evt_<uuid>`, `ctrcharge_<contractId>`, `ctrfile_<contractId>`, `rem_<chargeId>_<kind>_<channel>_<offset>`. Proibido `:` em `jobId`.
- **Deduplicação** (webhook, contrato assinado, lembrete do dia): usar o `jobId` determinístico acima.
- **Reenfileiramento manual** (reprocessar evento, tentar gerar cobrança de contrato, tentar sincronizar cliente): o serviço chama `queue.getJob(jobId)` e, se existir em estado `failed` ou `completed`, faz `job.remove()` antes de `queue.add` com o mesmo `jobId`. Se o job estiver `waiting`/`active`/`delayed`, responde sem enfileirar de novo (já está em andamento).
- **Jobs que só levam "o estado atual"** (ex.: sincronizar cliente com o Asaas) não usam `jobId` fixo: cada gatilho enfileira um job novo, e o processor lê o estado do banco no momento da execução. Execuções repetidas são inofensivas e a última sempre leva os dados mais recentes.
- `removeOnComplete: { age: 7 dias }` e `removeOnFail: { age: 30 dias }` em todas as filas; a verdade sobre o resultado fica no Postgres (`webhook_events`, `contracts.charge_error`, `reminder_logs`…), não no Redis.
- Helper único `enqueueUnique(queue, name, data, jobId, opts)` / `requeue(queue, name, data, jobId, opts)` em `apps/api/src/queues/`, com teste.

## Consequências
- Nenhuma spec usa `:` em `jobId` (specs 04, 07 e 08 ajustadas).
- "Reprocessar" e "Tentar gerar cobrança" funcionam mesmo depois de esgotadas as tentativas.
