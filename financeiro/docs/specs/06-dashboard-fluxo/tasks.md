# 06 — Dashboard e fluxo de caixa · Tarefas

> Status: **Em revisão**

- [ ] 1. Cenário de teste fixo (seed de teste) com números esperados documentados na própria suíte
  - _Requisitos: FLX-NF2_

- [ ] 2. `CashflowCalculator` (SQL) com entradas/saídas realizadas e previstas, taxas e estornos
  - _Requisitos: definições, FLX-02.1_

- [ ] 3. `GET /reports/dashboard` reutilizando o calculator
  - Alertas: contratos com erro na cobrança (contagem 0 até a spec 07 existir), cobranças DRAFT antigas, eventos pendentes.
  - _Requisitos: FLX-01.1–01.5_

- [ ] 4. `GET /reports/cashflow`, `expenses-by-category`, `statement`
  - _Requisitos: FLX-02, FLX-03, FLX-04_

- [ ] 5. `GET /reports/aging` e taxa de inadimplência
  - _Requisitos: FLX-05.1, FLX-05.2_

- [ ] 6. Exportação CSV
  - _Requisitos: FLX-06.1_

- [ ] 7. Tela Visão geral
  - _Requisitos: FLX-01_

- [ ] 8. Tela Fluxo de caixa (gráfico, tabela, categorias, extrato, inadimplência, exportar)
  - _Requisitos: FLX-02–FLX-06_

- [ ] 9. Teste de desempenho com volume sintético
  - _Requisitos: FLX-NF1_
