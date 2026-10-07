# 03 — Cobranças · Requisitos

> Status: **Em revisão** · Prefixo: `COB` · Depende de: 01, 02 (e 04 para status) · Marco: M2 (parte 1) e M3 (parte 2)

## Contexto

Coração do sistema: transformar cliente + serviços + condições em cobrança no Asaas e acompanhar até o recebimento (O1, O2). A mesma lógica é usada pelos contratos (ADR-006).

**Parte 1 (M2):** COB-01, COB-02, COB-05, COB-07, COB-12.
**Parte 2 (M3):** COB-03, COB-04, COB-06, COB-08, COB-09, COB-10, COB-11.

## Fora de escopo

- Cobrança com cartão tokenizado / checkout transparente (o cliente paga pela fatura do Asaas).
- Edição de valor/vencimento de cobrança já emitida (v1: cancelar e emitir outra). Avaliar `PUT /payments` na v1.1.
- Desconto por pagamento antecipado, NFS-e, split.

## Requisitos

### COB-01 — Plano de cobrança e prévia

**História:** Como FINANCEIRO, quero montar a cobrança escolhendo cliente, serviços e condições e ver o resumo antes de gerar, para não errar valor nem condição.

- COB-01.1 — O plano DEVE ter: 1 ou mais itens (serviço do catálogo ou descrição livre, quantidade 1–999, preço unitário em centavos ≥ 0), tipo (avulsa, parcelada, recorrente), forma de pagamento (Pix, boleto, cartão, cliente escolhe), vencimento, desconto em R$, multa % e juros % ao mês.
- COB-01.2 — QUANDO um serviço do catálogo for adicionado, o sistema DEVE preencher o preço padrão, editável; adicionar o mesmo serviço de novo DEVE somar na quantidade.
- COB-01.3 — Multa, juros e vencimento DEVEM vir preenchidos com os padrões das Configurações.
- COB-01.4 — `POST /charges/preview` DEVE devolver subtotal, desconto, total, parcelas (número, vencimento, valor) e as requisições que serão enviadas ao Asaas, sem efeitos colaterais.
- COB-01.5 — SE o total for ≤ 0, o desconto maior que o subtotal, o vencimento anterior a hoje (America/Sao_Paulo) ou o valor por cobrança abaixo do mínimo configurado, ENTÃO o sistema DEVE recusar com o código correspondente e mensagem em português.
- COB-01.6 — SE o cliente estiver arquivado, ENTÃO o sistema DEVE recusar com `CUSTOMER_ARCHIVED`.

### COB-02 — Cobrança avulsa

**História:** Como FINANCEIRO, quero gerar uma cobrança única no Asaas, para enviar o link ao cliente.

- COB-02.1 — QUANDO o usuário gerar uma cobrança avulsa, o sistema DEVE garantir o cliente no Asaas (CLI-05), criar o pagamento com `externalReference` local e guardar `pay_…`, link da fatura, URL do boleto e status.
- COB-02.2 — A descrição enviada ao Asaas DEVE listar os serviços e quantidades (até 500 caracteres, truncando com "…").
- COB-02.3 — O valor enviado DEVE ser o total com o desconto já abatido; multa e juros DEVEM ir nos campos próprios do Asaas.
- COB-02.4 — Os itens DEVEM ser gravados com descrição e preço congelados.

### COB-03 — Cobrança parcelada

- COB-03.1 — O usuário DEVE poder parcelar de 2 a 12 vezes; o sistema DEVE mostrar valor e vencimento de cada parcela (mensais a partir do 1º vencimento).
- COB-03.2 — A soma das parcelas DEVE ser exatamente o total; diferença de centavos vai na última.
- COB-03.3 — QUANDO gerada, o sistema DEVE criar o parcelamento no Asaas e espelhar cada parcela como uma cobrança local ligada ao `installment`, com número da parcela.
- COB-03.4 — SE o valor da parcela ficar abaixo do mínimo, ENTÃO DEVE recusar com `CHARGE_BELOW_MINIMUM`.

### COB-04 — Cobrança recorrente (assinatura)

- COB-04.1 — O usuário DEVE poder criar uma recorrência com ciclo (semanal, quinzenal, mensal, bimestral, trimestral, semestral, anual), data da primeira cobrança e data final opcional, posterior à primeira cobrança.
- COB-04.2 — QUANDO gerada, o sistema DEVE criar a assinatura no Asaas, guardar `sub_…` e os itens, e importar a primeira cobrança gerada pelo Asaas.
- COB-04.3 — Cada nova cobrança gerada pelo Asaas para a assinatura DEVE aparecer localmente (via webhook ou reconciliação) com `origin = SUBSCRIPTION` e os itens da assinatura.
- COB-04.4 — A tela de Recorrências DEVE listar assinaturas com cliente, valor, ciclo, próximo vencimento e status.

### COB-05 — Dados para pagamento

- COB-05.1 — Para cobranças em aberto, o sistema DEVE disponibilizar o link da fatura; Pix copia-e-cola e QR Code quando a forma for Pix ou "cliente escolhe"; linha digitável quando boleto ou "cliente escolhe".
- COB-05.2 — Os dados de Pix/boleto DEVEM ser buscados após a criação e, se falharem, sob demanda ao abrir o detalhe, sem bloquear a criação.
- COB-05.3 — O usuário DEVE poder copiar link, Pix e linha digitável com um clique.

### COB-06 — Lista de cobranças

- COB-06.1 — A lista DEVE filtrar por status (múltiplos), cliente, tipo, forma, período de vencimento e busca por nome do cliente ou `pay_…`, com contagem por status.
- COB-06.2 — Colunas: ID Asaas, cliente, serviços, tipo (com parcela "2/3" ou ciclo), forma, vencimento, valor, status; rodapé com quantidade e soma do filtro.
- COB-06.3 — O padrão DEVE ser ordenar por vencimento decrescente, 20 por página.

### COB-07 — Detalhe da cobrança

- COB-07.1 — O detalhe DEVE mostrar valor, status, cliente, tipo, forma, vencimento, data de pagamento, valor líquido (quando houver), itens, parcelas irmãs ou assinatura, dados de pagamento, eventos recebidos do Asaas e lembretes enviados.
- COB-07.2 — O usuário DEVE poder forçar a sincronização com o Asaas (`POST /charges/:id/sync`).

### COB-08 — Cancelar

- COB-08.1 — O FINANCEIRO DEVE poder cancelar cobrança `PENDING` ou `OVERDUE`; o sistema DEVE remover no Asaas e marcar `CANCELED`.
- COB-08.2 — Em parcelamento, o usuário DEVE poder cancelar uma parcela ou todas as parcelas em aberto.
- COB-08.3 — SE a cobrança não estiver em estado cancelável, ENTÃO DEVE recusar com `CHARGE_NOT_CANCELABLE`.
- COB-08.4 — O cancelamento DEVE pedir confirmação com cliente e valor e ser auditado.

### COB-09 — Estornar

- COB-09.1 — Somente ADMIN DEVE poder estornar cobrança `PAID` ou `CONFIRMED`, total ou parcialmente.
- COB-09.2 — QUANDO solicitado, o sistema DEVE pedir o estorno ao Asaas, registrar `refund_requested_at` e mostrar "Estorno solicitado" até o webhook confirmar `REFUNDED`/`PARTIALLY_REFUNDED`.
- COB-09.3 — SE o valor pedido exceder o saldo estornável, ENTÃO DEVE recusar com `REFUND_EXCEEDS_VALUE`.

### COB-10 — Reenviar ao cliente

- COB-10.1 — O usuário DEVE poder enviar por e-mail ao cliente o link da fatura (e Pix/linha digitável quando houver), usando o modelo da régua; o envio DEVE ser registrado como lembrete `MANUAL`.
- COB-10.2 — SE o cliente não tiver e-mail, ENTÃO o botão DEVE ficar desabilitado com a explicação.

### COB-11 — Cancelar recorrência

- COB-11.1 — O FINANCEIRO DEVE poder cancelar uma assinatura; o sistema DEVE removê-la no Asaas e marcar `CANCELED`; cobranças já geradas e em aberto DEVEM ter o status atualizado conforme o Asaas.

### COB-12 — Falha na criação e retomada

- COB-12.1 — SE o Asaas falhar durante a criação, ENTÃO o sistema DEVE manter o registro como `DRAFT` com o erro, responder com o id local e permitir "Tentar de novo" ou "Descartar".
- COB-12.2 — "Tentar de novo" NÃO DEVE criar cobrança, parcelamento ou assinatura duplicados no Asaas (busca por `externalReference` antes de criar, nos três tipos).
- COB-12.3 — SE o rascunho ainda não existir no Asaas e o vencimento já tiver passado, ENTÃO "Tentar de novo" DEVE recusar com `DUE_DATE_IN_PAST` e sugerir descartar e criar outra (cobrança manual); para cobrança de contrato vale o ajuste de CTR-05.2.

## Requisitos não funcionais

- COB-NF1 — Criação de cobrança avulsa (sem contar a latência do Asaas) < 500 ms.
- COB-NF2 — Criação, cancelamento, estorno e reenvio auditados.
- COB-NF3 — Nenhum caminho de código altera status de cobrança fora de: resposta do Asaas a uma ação nossa, processador de eventos (spec 04) ou reconciliação.

## Perguntas em aberto

- [ ] Confirmar no sandbox: `totalValue` vs `installmentValue`, se `externalReference` é replicado em todas as parcelas, valor mínimo por cobrança e o que acontece com cobranças pendentes ao remover uma assinatura.

## Changelog

| Data | Mudança |
| --- | --- |
| 07/10/2026 | Versão inicial |
| 07/10/2026 | Revisão: COB-12.2 cobre os três tipos, COB-12.3 (retry com vencimento passado), data final > primeira cobrança |
