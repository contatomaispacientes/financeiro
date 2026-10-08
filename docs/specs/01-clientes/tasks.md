# 01 — Clientes · Tarefas

> Status: **Aprovado**

- [x] 1. Schemas de cliente em `shared` + testes
  - _Requisitos: CLI-01.1, CLI-01.2, CLI-01.4, CLI-01.5 (`isAddressComplete`)_

- [x] 2. Migration de busca (unaccent, pg_trgm, índice trigram em nome)
  - _Requisitos: CLI-NF1_

- [x] 3. `CustomersModule`: criar, obter, editar, lookup por documento
  - Duplicado, documento travado se houver cobrança, auditoria.
  - Testes de integração.
  - _Requisitos: CLI-01.1–01.4, CLI-04.1, CLI-04.3, CLI-NF2_

- [ ] 4. Lista com busca, agregados e mascaramento por papel
  - Query única com agregados; teste de desempenho simples com 5 mil clientes no seed de teste.
  - _Requisitos: CLI-02.1–02.4, CLI-NF1_

- [ ] 5. Arquivar e desarquivar
  - _Requisitos: CLI-04.4, CLI-04.5_

- [ ] 6. `AsaasClient`: customers (find, create, update) + `ensureAsaasCustomer` com advisory lock
  - Fixtures reais do sandbox em `test/fixtures/asaas/customers/`.
  - Teste de concorrência (duas chamadas em paralelo → 1 POST).
  - _Requisitos: CLI-05.1, CLI-05.2_

- [ ] 7. Sincronização de edição com o Asaas (fila `asaas-customer-sync`, sem `jobId` fixo — ADR-010)
  - Teste: duas edições em sequência rápida → o último `PUT` leva os dados da segunda.
  - _Requisitos: CLI-04.2_

- [ ] 8. Telas: lista, formulário, ficha (abas de cobranças/assinaturas/contratos vazias até as specs 03 e 07)
  - _Requisitos: CLI-02, CLI-03.1, CLI-03.2, CLI-01_
