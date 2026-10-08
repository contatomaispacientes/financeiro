# 05 — Contas a pagar · Requisitos

> Status: **Aprovado** · Prefixo: `DSP` · Depende de: 00 · Marco: M4

## Contexto

Lado das saídas: despesas da empresa com categoria, fornecedor e vencimento, para alimentar o fluxo de caixa e o saldo previsto (O4). Não há integração de pagamento: o usuário paga fora e marca aqui.

## Fora de escopo

- Pagamento de contas pelo Asaas (Pix de saída, boleto), importação de extrato/OFX, rateio por centro de custo, parcelamento de despesa (v1.1: lançar N despesas).

## Requisitos

### DSP-01 — Lançar despesa

**História:** Como FINANCEIRO, quero lançar uma conta a pagar, para saber o que sai e quando.

- DSP-01.1 — O sistema DEVE exigir descrição (2–120), categoria ativa, valor > 0 e vencimento; fornecedor, observações e anexo (PDF/imagem até 5 MB) são opcionais.
- DSP-01.2 — O usuário DEVE poder editar despesa em aberto; despesa paga só pode ter observações e anexo alterados (`EXPENSE_NOT_EDITABLE`).
- DSP-01.3 — O usuário DEVE poder cancelar despesa em aberto (não exclui; fica `CANCELED`).

### DSP-02 — Pagar

- DSP-02.1 — QUANDO o usuário marcar como paga, o sistema DEVE registrar data de pagamento (padrão hoje), valor pago (padrão o valor previsto) e forma de pagamento.
- DSP-02.2 — O usuário DEVE poder desfazer o pagamento, voltando a `OPEN`, com auditoria.
- DSP-02.3 — Despesa `OPEN` com vencimento anterior a hoje DEVE ser exibida como "Atrasada" (estado derivado, não gravado).

### DSP-03 — Despesas recorrentes

- DSP-03.1 — O usuário DEVE poder criar uma recorrência mensal com descrição, categoria, fornecedor, valor, dia do vencimento (1–31), mês inicial e final opcional.
- DSP-03.2 — O sistema DEVE gerar automaticamente, uma única vez por mês, a despesa do mês corrente de cada recorrência ativa; dia 29–31 em meses mais curtos vira o último dia do mês.
- DSP-03.3 — QUANDO uma recorrência for criada, o sistema DEVE gerar imediatamente a despesa do mês corrente se o mês inicial já tiver começado.
- DSP-03.4 — Alterar valor ou dia da recorrência DEVE valer a partir da próxima geração; despesas já geradas não mudam.
- DSP-03.5 — O usuário DEVE poder pausar/encerrar a recorrência.
- DSP-03.6 — O usuário DEVE poder lançar uma despesa já marcando "repetir todo mês", o que cria a recorrência e a despesa do mês juntas.

### DSP-04 — Categorias

- DSP-04.1 — O ADMIN DEVE poder criar, renomear e desativar categorias; categoria em uso não é excluída.

### DSP-05 — Lista

- DSP-05.1 — A lista DEVE filtrar por situação (a pagar, atrasada, paga, cancelada), categoria, período de vencimento e busca por descrição/fornecedor.
- DSP-05.2 — A tela DEVE mostrar KPIs: em aberto, atrasadas, pago no mês e total do mês.

## Requisitos não funcionais

- DSP-NF1 — Valores em centavos; anexos no `StorageService` com URL assinada de curta duração para download.
- DSP-NF2 — Pagamento, desfazer e cancelamento auditados.

## Changelog

| Data | Mudança |
| --- | --- |
| 07/10/2026 | Versão inicial |
