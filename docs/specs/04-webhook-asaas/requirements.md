# 04 — Webhook e reconciliação Asaas · Requisitos

> Status: **Aprovado** · Prefixo: `WHK` · Depende de: 03 · Marco: M2 (webhook) e M3 (reconciliação)

## Contexto

O status das cobranças precisa refletir o Asaas sem intervenção manual (O2). O webhook é o caminho principal; a reconciliação diária é a rede de segurança (ADR-004, ADR-007). A mesma infraestrutura de recepção de eventos é usada pelos contratos (spec 07).

## Fora de escopo

- Webhooks de transferências, notas fiscais, contas e antecipações.

## Requisitos

### WHK-01 — Receber e autenticar

- WHK-01.1 — O sistema DEVE expor `POST /api/v1/webhooks/asaas` sem autenticação de usuário.
- WHK-01.2 — SE o header `asaas-access-token` estiver ausente ou diferente do configurado, ENTÃO o sistema DEVE responder 401 e NÃO DEVE persistir o evento.
- WHK-01.3 — QUANDO um evento autenticado chegar, o sistema DEVE persistir o corpo bruto com `id`, tipo e id do recurso e responder 200 em menos de 1 s.
- WHK-01.4 — SE o mesmo `id` de evento chegar de novo, ENTÃO o sistema DEVE responder 200 e NÃO DEVE processá-lo outra vez.
- WHK-01.5 — SE o corpo for inválido (sem `id` ou `event`), ENTÃO o sistema DEVE responder 400 e registrar o problema no log da aplicação.

### WHK-02 — Processar eventos de cobrança

- WHK-02.1 — O sistema DEVE processar cada evento persistido de forma assíncrona e aplicar a ação da tabela de eventos em `asaas.md`.
- WHK-02.2 — O sistema DEVE localizar a cobrança local por id Asaas, depois `externalReference`, depois parcelamento (`externalReference` do grupo ou id do parcelamento) + número da parcela; SE não encontrar e o evento tiver `subscription` conhecida, ENTÃO DEVE importar a cobrança; SE não encontrar e o evento tiver chegado há menos de 5 minutos, ENTÃO DEVE tentar de novo (a cobrança pode estar sendo criada neste instante); senão DEVE marcar o evento como `UNKNOWN_RESOURCE`.
- WHK-02.3 — O sistema DEVE respeitar o mapa de transições (overview.md); transições inválidas DEVEM ser ignoradas e marcadas `IGNORED_TRANSITION`, sem erro. Estornos parciais sucessivos e o estorno total depois de um parcial DEVEM ser aplicados.
- WHK-02.7 — QUANDO houver estorno, chargeback ou reversão de chargeback, o sistema DEVE registrar o lançamento em `charge_refunds` com o tipo correspondente, uma única vez por evento (ADR-011).
- WHK-02.4 — QUANDO a cobrança for paga, o sistema DEVE gravar data de pagamento e valor líquido.
- WHK-02.5 — SE o processamento falhar, ENTÃO o sistema DEVE tentar de novo até 5 vezes com espera crescente e, esgotadas, deixar o erro visível no log.
- WHK-02.6 — Atualizações de status DEVEM atualizar também `last_event_at` e o próximo vencimento da assinatura, quando aplicável.

### WHK-03 — Log e reprocessamento

- WHK-03.1 — O ADMIN DEVE ver o log de eventos (Asaas, contratos e reconciliação) com filtros por origem, tipo, situação (processado, pendente, com erro, ignorado) e recurso.
- WHK-03.2 — O ADMIN DEVE poder reprocessar um evento com erro, inclusive depois de esgotadas as 5 tentativas.
- WHK-03.3 — O painel de Configurações DEVE alertar quando houver evento não processado há mais de 1 hora ou nenhum evento recebido em 7 dias com cobranças abertas.
- WHK-03.4 — O detalhe da cobrança DEVE listar os eventos ligados a ela.

### WHK-04 — Reconciliação

- WHK-04.1 — Diariamente às 06:00 (America/Sao_Paulo), o sistema DEVE consultar no Asaas as cobranças locais em `PENDING`, `OVERDUE` e `CONFIRMED`, as `PAID`/`PARTIALLY_REFUNDED`/`CHARGEBACK` pagas nos últimos 120 dias e as `CANCELED` nos últimos 30 dias, e corrigir divergências de status, valor, vencimento e data de pagamento usando o mesmo processador de eventos.
- WHK-04.2 — A reconciliação DEVE importar cobranças de assinaturas ativas que não existam localmente.
- WHK-04.3 — Cada correção DEVE gerar um evento com origem `RECONCILE` no log.
- WHK-04.4 — O ADMIN DEVE poder disparar "Reconciliar agora" e ver o resumo (verificadas, corrigidas, importadas, erros).
- WHK-04.5 — A reconciliação NÃO DEVE exceder 3 requisições simultâneas ao Asaas.

## Requisitos não funcionais

- WHK-NF1 — O endpoint de webhook responde em < 300 ms no p95 (só persistência).
- WHK-NF2 — Comparação do token em tempo constante; payload guardado sem alteração (para auditoria).
- WHK-NF3 — Retenção de `webhook_events`: 18 meses (job mensal de limpeza).

## Changelog

| Data | Mudança |
| --- | --- |
| 07/10/2026 | Versão inicial |
| 07/10/2026 | Revisão: corrida com a criação (WHK-02.2), estornos parciais sucessivos (WHK-02.3), WHK-02.7 (charge_refunds com chargeback — ADR-011), reprocessar após esgotar tentativas, reconciliação cobre pagas/canceladas recentes |
