# 03 — Cobranças · Tarefas

> Status: **Aprovado** · Parte 1 = M2 (tarefas 1–7) · Parte 2 = M3 (tarefas 8–15)

## Parte 1 — cobrança avulsa (M2)

- [x] 1. `ChargePlanSchema` e `calculatePlan` em `shared`
  - Testes cobrindo toda a lista de validações e parcelas (mesmo que parcelada só entre na parte 2).
  - _Requisitos: COB-01.1, COB-01.5, COB-03.2_

- [ ] 2. Validar o Asaas no sandbox e registrar fixtures
  - Criar no sandbox: avulsa Pix, boleto, UNDEFINED; parcelada 3×; assinatura mensal; capturar respostas em `test/fixtures/asaas/`.
  - Responder as perguntas em aberto do requirements e atualizar `asaas.md`/este design se algo divergir.
  - _Requisitos: COB-02, COB-03, COB-04 (preparação)_

- [ ] 3. `AsaasClient` — payments: create, get, list, pixQrCode, identificationField; conversão centavos ↔ decimal; mapeamento de erros
  - Testes unitários com nock e fixtures.
  - _Requisitos: COB-02.1, COB-05.1_

- [ ] 4. `ChargesService.createFromPlan` para `SINGLE` + `POST /charges/preview` + `POST /charges`
  - DRAFT → Asaas → espelho; dados de pagamento best-effort; auditoria.
  - _Requisitos: COB-01.4, COB-01.6, COB-02.1–02.4, COB-05.2, COB-NF2_

- [ ] 5. Falha e retomada: `retry`, `discard`, busca por `externalReference` antes de criar; `ctx.idempotencyKey`; retry com vencimento passado (COB-12.3)
  - Teste: falha 502 → DRAFT; retry com o Asaas já tendo criado → não duplica; chamar 2× com a mesma `idempotencyKey` → um único registro local e no Asaas.
  - _Requisitos: COB-12.1, COB-12.2, COB-12.3 (e base de CTR-05.3)_

- [ ] 6. `GET /charges/:id` e `GET /charges/:id/payment-info`
  - _Requisitos: COB-05, COB-07.1_

- [ ] 7. Tela Nova Cobrança (avulsa) e detalhe básico
  - Formulário completo, prévia, sucesso, erro com retry; detalhe com dados de pagamento e cópia.
  - _Requisitos: COB-01.1–01.3, COB-05.3, COB-07.1_

## Parte 2 — cobranças completas (M3)

- [ ] 8. Parcelada: criação do installment, casamento das parcelas, telas de parcelas
  - _Requisitos: COB-03.1–03.4_

- [ ] 9. Recorrente: `AsaasClient` subscriptions (inclui `listSubscriptions` por `externalReference`); criação e retry sem duplicar; importação da 1ª cobrança com upsert; `/subscriptions` (lista e detalhe)
  - _Requisitos: COB-04.1, COB-04.2, COB-04.4_

- [ ] 10. Importação de cobranças de assinatura vindas do webhook (`PAYMENT_CREATED` com `subscription`) — integra com a spec 04
  - _Requisitos: COB-04.3_

- [ ] 11. Lista de cobranças com filtros, contagem por status e soma
  - _Requisitos: COB-06.1–06.3_

- [ ] 12. Cancelar (individual e parcelas restantes) com confirmação e auditoria
  - _Requisitos: COB-08.1–08.4_

- [ ] 13. Estornar (ADMIN), `refund_requested_at`, selo "Estorno solicitado"
  - _Requisitos: COB-09.1–09.3_

- [ ] 14. Enviar por e-mail (MailProvider + Mailpit em dev) e `sync` manual
  - _Requisitos: COB-10.1, COB-10.2, COB-07.2_

- [ ] 15. Cancelar recorrência + E2E manual no sandbox dos três tipos (roteiro em `docs/testes/sandbox-cobrancas.md`)
  - _Requisitos: COB-11.1, todos (validação ponta a ponta)_
