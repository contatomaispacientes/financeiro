# 06 — Dashboard e fluxo de caixa · Tarefas

> Status: **Aprovado**

- [x] 1. Cenário de teste fixo (seed de teste) com números esperados documentados na própria suíte
  - _Requisitos: FLX-NF2_

- [x] 2. `CashflowCalculator` (SQL) com entradas/saídas realizadas e previstas, taxas e estornos
  - _Requisitos: definições, FLX-02.1_

- [x] 2b. Projeção dos 3 meses seguintes: `projectSubscriptionDueDates` em `shared` + `projectMonth` no calculator
  - _Requisitos: FLX-02.3_

- [x] 3. `GET /reports/dashboard` reutilizando o calculator
  - Alertas: contratos com erro na cobrança (contagem 0 até a spec 07 existir), cobranças DRAFT antigas, eventos pendentes.
  - _Requisitos: FLX-01.1–01.5_

- [x] 4. `GET /reports/cashflow`, `expenses-by-category`, `statement`
  - _Requisitos: FLX-02, FLX-03, FLX-04_

- [x] 5. `GET /reports/aging` e taxa de inadimplência
  - _Requisitos: FLX-05.1, FLX-05.2_

- [x] 6. Exportação CSV
  - _Requisitos: FLX-06.1_

- [x] 7. Tela Visão geral
  - _Requisitos: FLX-01_

- [x] 8. Tela Fluxo de caixa (gráfico, tabela, categorias, extrato, inadimplência, exportar)
  - _Requisitos: FLX-02–FLX-06_

- [ ] 9. Teste de desempenho com volume sintético
  - _Requisitos: FLX-NF1_
