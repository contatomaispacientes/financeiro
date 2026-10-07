# ADR-011 — Chargeback lançado como saída no fluxo de caixa (provisório)

**Status:** Aceito (provisório — revisar após validar os eventos de chargeback no sandbox) · 07/10/2026

## Contexto
No regime de caixa da spec 06, a cobrança de cartão conta como entrada realizada na confirmação. Se o cliente contesta a compra (chargeback), o Asaas bloqueia/retira o valor, mas a spec original não lançava nenhuma saída — o fluxo de caixa ficaria maior do que o dinheiro real. O dono não tinha preferência definida.

## Decisão
Postura conservadora: o fluxo de caixa nunca mostra dinheiro que pode não existir.
- QUANDO chegar `PAYMENT_CHARGEBACK_REQUESTED` (ou a reconciliação detectar `CHARGEBACK_REQUESTED`), o processador grava um lançamento em `charge_refunds` com `kind = CHARGEBACK`, valor = `value_cents − refunded_cents` e data = data do evento em SP.
- A entrada original continua no mês em que foi recebida; o chargeback aparece como **saída** na categoria "Chargebacks" no mês em que foi aberto.
- Se a disputa for ganha e o Asaas devolver o valor (evento exato a confirmar no sandbox — provável `PAYMENT_AWAITING_CHARGEBACK_REVERSAL` seguido de `PAYMENT_RECEIVED`), grava-se um lançamento `kind = CHARGEBACK_REVERSAL` (entrada) e a cobrança volta a `PAID`.

## Alternativas consideradas
- Ignorar o chargeback no fluxo (como estava): simples, mas superestima o caixa.
- Retirar a entrada do mês original: reescreve meses já fechados; descartado.

## Consequências
- `charge_refunds` ganha a coluna `kind` (`REFUND | CHARGEBACK | CHARGEBACK_REVERSAL`).
- Mapa de status ganha `CHARGEBACK → PAID` (reversão).
- Se o dono preferir outra regra, um novo ADR substitui este; só a spec 06 e o processador de eventos mudam.
