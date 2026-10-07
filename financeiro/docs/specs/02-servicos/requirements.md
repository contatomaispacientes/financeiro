# 02 — Serviços · Requisitos

> Status: **Em revisão** · Prefixo: `SRV` · Depende de: 00 · Marco: M1

## Contexto

Catálogo do que a empresa vende. Equivale aos "Planos" da AvanceAI, sem limites de uso nem trial. O preço do catálogo é só o padrão: cada cobrança/contrato congela o preço usado (O1).

## Fora de escopo

- Variações de preço por cliente, tabelas de preço, impostos por serviço (v2).
- Página pública de catálogo.

## Requisitos

### SRV-01 — Cadastrar e editar serviço

**História:** Como FINANCEIRO, quero manter um catálogo de serviços com preço padrão, para montar cobranças rapidamente.

- SRV-01.1 — O sistema DEVE exigir nome (2–120, único entre ativos, sem diferenciar maiúsculas) e preço padrão > 0; descrição é opcional (até 500).
- SRV-01.2 — SE já existir serviço ativo com o mesmo nome (ao criar, renomear ou reativar um serviço), ENTÃO o sistema DEVE recusar com `SERVICE_DUPLICATE`.
- SRV-01.3 — QUANDO o preço padrão de um serviço for alterado, cobranças, assinaturas e contratos já criados NÃO DEVEM mudar.

### SRV-02 — Ativar e desativar

- SRV-02.1 — O usuário DEVE poder ativar/desativar um serviço; inativos não aparecem no catálogo da Nova Cobrança/Novo Contrato.
- SRV-02.2 — O sistema NÃO DEVE excluir serviço já usado em algum item; serviço nunca usado PODE ser excluído.

### SRV-03 — Listar

- SRV-03.1 — A lista DEVE mostrar nome, descrição, preço padrão, quantidade de vendas em que foi usado (parcelamento conta 1, assinatura conta 1) e situação, com filtro ativo/inativo/todos.

## Requisitos não funcionais

- SRV-NF1 — Alterações registradas em auditoria (preço antes/depois).

## Changelog

| Data | Mudança |
| --- | --- |
| 07/10/2026 | Versão inicial |
| 07/10/2026 | Revisão: duplicado também ao reativar; contagem de uso por venda |
