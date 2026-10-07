# 07 — Contratos · Tarefas

> Status: **Em revisão** · Tarefas 1–11 funcionam só com o FakeProvider; 12–14 ligam o Clicksign (ADR-009).

- [ ] 1. Schemas e catálogo de variáveis em `shared`; `ContractVariablesService` com testes
  - _Requisitos: CTR-02.5, CTR-02.6_

- [ ] 2. Interface `ContractProvider`, `ContractProviderRegistry`, `FakeContractProvider` e suíte de conformidade
  - _Requisitos: CTR-08.1, CTR-NF3_

- [ ] 3. Modelos de contrato (API + tela), validação do mapeamento, prévia
  - _Requisitos: CTR-01.1–01.5_

- [ ] 4. Conferir que `ctx.idempotencyKey` de `createFromPlan` (spec 03, tarefa 5) cobre o cenário de contrato: teste com plano parcelado e recorrente usando `ctr_<id>`
  - _Requisitos: CTR-05.3_

- [ ] 5. Contratos: rascunho, editar, descartar, prévia, método de autenticação por signatário
  - Signatário da empresa obrigatório (padrão das Configurações), endereço completo obrigatório no envio.
  - _Requisitos: CTR-02.1–02.9_

- [ ] 6. Envio para o provedor com `provider_progress`/`onProgress` (retomada sem duplicar), links, auditoria
  - O `FakeProvider` deve simular falha em um passo intermediário para testar a retomada.
  - _Requisitos: CTR-03.1–03.3, CTR-NF1_

- [ ] 7. Webhook de contratos (`/webhooks/contracts/:provider`, rawBody, verificação) reutilizando o `WebhookInbox`; `ContractEventsProcessor` e máquina de estados; rotas `/dev/fake-sign`
  - _Requisitos: CTR-04.1, CTR-04.2, CTR-04.4, CTR-04.5, CTR-04.6_

- [ ] 8. `ContractChargeProcessor` (geração única, ajuste de vencimento inclusive para geração tardia, retries, erro visível, "Tentar gerar cobrança" com `requeue`, alerta no dashboard)
  - _Requisitos: CTR-05.1–05.4_

- [ ] 9. Download do PDF assinado para o storage + URL assinada
  - _Requisitos: CTR-04.3, CTR-NF2_

- [ ] 10. Reenviar convite, cancelar, sync, expiração diária
  - _Requisitos: CTR-06.1–06.4_

- [ ] 11. Telas: lista, wizard Novo Contrato (com `ChargePlanForm` extraído), detalhe, aba na ficha do cliente, botão "Gerar contrato" na Nova Cobrança; E2E Playwright com o Fake
  - _Requisitos: CTR-02, CTR-07.1–07.3_

- [x] 12a. Escolher o provedor → Clicksign API v3 (ADR-009, `contratos-clicksign.md`)

- [ ] 12. Preparar o sandbox do Clicksign e fechar os **[confirmar]**
  - Conferir no plano a automação com modelos via API; gerar token de sandbox; criar o modelo DOCX com as variáveis sugeridas; cadastrar webhook apontando para o túnel e anotar o segredo HMAC.
  - Executar à mão (ou script em `apps/api/scripts/clicksign-sandbox.ts`) o fluxo envelope → documento por modelo → signatários → requisitos → ativar; assinar pelo e-mail de teste; capturar respostas e webhooks em `test/fixtures/clicksign/`.
  - Responder cada **[confirmar]** de `contratos-clicksign.md` e corrigir o documento (URL de produção, papéis, links individuais, cancelamento de envelope em andamento, arquivo assinado, id do evento, variáveis do modelo).
  - _Requisitos: CTR-08.3_

- [ ] 13. `ClicksignContractProvider` (HTTP client JSON:API, mapper, `verifyWebhook` HMAC, `parseWebhook`, retomada por `resume`), teste de conexão em Configurações › Integrações; suíte de conformidade contra o sandbox
  - _Requisitos: CTR-08.1, CTR-08.2, CTR-08.4, CTR-04.5_

- [ ] 14. Ponta a ponta em sandbox: contrato → assinatura no Clicksign → `auto_close`/`document_closed` → PDF no storage → cobrança no sandbox do Asaas → e-mail com o link (se ativo); roteiro em `docs/testes/sandbox-contratos.md`
  - _Requisitos: CTR-03, CTR-04, CTR-05.1–05.5_
