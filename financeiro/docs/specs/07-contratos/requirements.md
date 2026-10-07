# 07 — Contratos · Requisitos

> Status: **Em revisão** · Prefixo: `CTR` · Depende de: 01, 02, 03, 04 · Marco: M6

## Contexto

Toda venda deve ser formalizada com contrato assinado eletronicamente, e a cobrança só nasce quando todos assinam (O3). O provedor é o **Clicksign (API v3)** (ADR-009, `docs/integrations/contratos-clicksign.md`). O módulo é construído contra a interface `ContractProvider`: primeiro com o `FakeProvider` (dev e testes), depois com o adapter do Clicksign (ADR-005). A cobrança gerada usa o mesmo `ChargePlan` da Nova Cobrança (ADR-006).

## Fora de escopo

- Editor de texto do contrato e geração local de PDF (modelos vivem no provedor).
- Aditivos, renovação automática de contrato, assinatura com certificado ICP-Brasil (avaliar com o provedor escolhido).
- Portal para o cliente baixar contratos.

## Requisitos

### CTR-01 — Modelos de contrato

**História:** Como ADMIN, quero cadastrar os modelos que existem no provedor e dizer qual dado vai em cada campo, para gerar contratos sem digitar nada.

- CTR-01.1 — O ADMIN DEVE cadastrar modelo com nome, provedor, ID do modelo no provedor e mapeamento campo do provedor → variável do catálogo (`contratos-provider.md`).
- CTR-01.2 — ONDE o provedor permitir listar modelos e campos, o sistema DEVE oferecer escolher o modelo e os campos em listas em vez de digitar.
- CTR-01.3 — SE o mapeamento usar variável que não existe no catálogo, ENTÃO o sistema DEVE recusar com `TEMPLATE_UNKNOWN_VARIABLE`.
- CTR-01.4 — O ADMIN DEVE poder ver a prévia do mapeamento com dados de um cliente e plano de exemplo.
- CTR-01.5 — Modelos podem ser desativados; desativados não aparecem no Novo Contrato.

### CTR-02 — Criar contrato (rascunho)

**História:** Como FINANCEIRO, quero montar um contrato com cliente, serviços e condições de pagamento, para enviá-lo para assinatura.

- CTR-02.1 — O contrato DEVE ter: cliente ativo, modelo ativo, título, plano de cobrança (mesmo formulário e validações da Nova Cobrança), signatários e validade (padrão 15 dias).
- CTR-02.2 — O vencimento do plano DEVE permitir "data fixa" ou "N dias após a assinatura" (padrão: `contract_charge_due_days` das Configurações).
- CTR-02.3 — Todo contrato DEVE ter exatamente um signatário do cliente (preenchido com nome, e-mail, celular e documento do cadastro) e ao menos um signatário da empresa prestadora (preenchido com o signatário padrão das Configurações); o usuário PODE adicionar outros representantes da empresa (até 6 signatários no total) e definir a ordem. Não há testemunhas na v1.
- CTR-02.9 — SE o cliente não tiver endereço de cobrança completo (CEP, logradouro, número, bairro, cidade, UF), ENTÃO o sistema DEVE bloquear o envio com `CUSTOMER_ADDRESS_REQUIRED`, independentemente de o modelo usar a variável de endereço.
- CTR-02.8 — Cada signatário DEVE ter um método de autenticação: e-mail (padrão), WhatsApp ou SMS; SE o método for WhatsApp ou SMS e não houver celular, ENTÃO o sistema DEVE recusar com `SIGNER_PHONE_REQUIRED`.
- CTR-02.4 — SE algum signatário não tiver e-mail válido, ENTÃO o sistema DEVE recusar o envio com `SIGNER_EMAIL_REQUIRED`.
- CTR-02.5 — O sistema DEVE mostrar a prévia das variáveis resolvidas e do plano (totais, parcelas) antes do envio.
- CTR-02.6 — SE alguma variável usada pelo modelo não puder ser preenchida (ex.: endereço do cliente vazio), ENTÃO o sistema DEVE bloquear o envio listando o que falta (`CONTRACT_MISSING_VARIABLES`).
- CTR-02.7 — Rascunho pode ser editado e descartado; a Nova Cobrança DEVE oferecer "Gerar contrato" que leva ao Novo Contrato com cliente e plano preenchidos.

### CTR-03 — Enviar para assinatura

- CTR-03.1 — QUANDO o usuário enviar, o sistema DEVE congelar variáveis e plano (snapshot), criar no Clicksign o envelope, o documento a partir do modelo, os signatários e seus requisitos, ativar o envelope e mudar o contrato para `SENT`.
- CTR-03.2 — O Clicksign DEVE enviar o convite de assinatura a cada signatário pelo canal do seu método de autenticação; ONDE o Clicksign fornecer link individual, o usuário DEVE poder copiá-lo.
- CTR-03.3 — SE o Clicksign falhar em qualquer passo, ENTÃO o contrato DEVE continuar `DRAFT` com o erro visível, e o reenvio DEVE retomar do passo que falhou, sem criar envelope, documento ou signatário duplicado.

### CTR-04 — Acompanhar assinatura

- CTR-04.1 — QUANDO o provedor avisar que um signatário assinou, o sistema DEVE marcar o signatário como `SIGNED` com data e o contrato como `PARTIALLY_SIGNED` (se faltarem outros).
- CTR-04.2 — QUANDO todos assinarem (ou o provedor avisar documento concluído), o contrato DEVE ir para `SIGNED` com `signed_at`.
- CTR-04.3 — QUANDO o contrato for assinado, o sistema DEVE baixar o PDF assinado e guardá-lo no storage; falha no download NÃO DEVE impedir a geração da cobrança e DEVE ser tentada de novo.
- CTR-04.4 — SE um signatário recusar, ENTÃO o contrato DEVE ir para `REFUSED` com o motivo, quando houver.
- CTR-04.5 — Eventos do Clicksign DEVEM ser recebidos pelo mesmo mecanismo idempotente do webhook do Asaas (persistir → 2xx em menos de 5 s → fila) com origem `CONTRACT`; SE o header `Content-Hmac` não corresponder ao HMAC-SHA256 do corpo bruto, ENTÃO o sistema DEVE responder 401 sem persistir.
- CTR-04.6 — SE chegar assinatura de contrato `CANCELED` ou `EXPIRED`, ENTÃO o sistema NÃO DEVE gerar cobrança e DEVE registrar alerta no log.

### CTR-05 — Gerar a cobrança na assinatura

**História:** Como dono, quero que a cobrança seja criada sozinha quando o cliente assinar, para não depender de alguém lembrar.

- CTR-05.1 — QUANDO o contrato chegar a `SIGNED`, o sistema DEVE criar a cobrança/parcelamento/assinatura no Asaas a partir do plano do contrato, com `origin = CONTRACT` e vínculo ao contrato.
- CTR-05.2 — O vencimento DEVE ser: "N dias após a assinatura" → data da assinatura + N; "data fixa" → a data. SE a data resultante for anterior ao dia da geração (data fixa já passou, ou a geração foi refeita dias depois da assinatura), ENTÃO DEVE ser hoje + `contract_charge_due_days`, com o ajuste registrado na auditoria.
- CTR-05.3 — A cobrança DEVE ser gerada no máximo uma vez por contrato, mesmo com eventos repetidos ou reprocessamento.
- CTR-05.4 — SE a geração falhar, ENTÃO o sistema DEVE tentar de novo automaticamente (5×) e, esgotado, mostrar o erro no contrato com ação "Tentar gerar cobrança" (que DEVE funcionar mesmo depois de esgotadas as tentativas) e destacar no dashboard.
- CTR-05.5 — ONDE o canal de e-mail estiver ativo e a mensagem "Cobrança emitida" (`CREATED`) estiver ativa na régua, o sistema DEVE enviar ao cliente o link da fatura logo após gerar a cobrança (REG-04.2).

### CTR-06 — Gerenciar contratos enviados

- CTR-06.1 — O usuário DEVE poder reenviar o convite a um signatário pendente.
- CTR-06.2 — O usuário DEVE poder cancelar contrato `SENT` ou `PARTIALLY_SIGNED` (cancela no provedor) com confirmação e auditoria.
- CTR-06.3 — Diariamente, contratos enviados com validade vencida DEVEM ser cancelados no provedor e marcados `EXPIRED`.
- CTR-06.4 — Contrato assinado não pode ser cancelado aqui; o caminho é cancelar/estornar a cobrança gerada.

### CTR-07 — Lista e detalhe

- CTR-07.1 — A lista DEVE filtrar por status, cliente e período e mostrar cliente, título, total do plano, status, enviado em, assinado em e se a cobrança foi gerada.
- CTR-07.2 — O detalhe DEVE mostrar status por signatário, links, plano congelado, variáveis enviadas, histórico de eventos, PDF assinado e cobrança(s)/assinatura geradas com link.
- CTR-07.3 — A ficha do cliente DEVE listar os contratos dele.

### CTR-08 — Clicksign

- CTR-08.1 — O sistema DEVE escolher o provedor por variável de ambiente (`CONTRACT_PROVIDER=fake|clicksign`) sem mudar o código de domínio.
- CTR-08.2 — O adapter do Clicksign DEVE usar a API v3 (envelopes) conforme `docs/integrations/contratos-clicksign.md` e passar na mesma suíte de conformidade do `FakeProvider`, rodada contra o sandbox do Clicksign.
- CTR-08.3 — Antes de implementar o adapter, os pontos marcados **[confirmar]** em `contratos-clicksign.md` DEVEM ser validados no sandbox e o documento corrigido.
- CTR-08.4 — A tela de Configurações › Integrações DEVE mostrar o ambiente do Clicksign, se o token e o segredo HMAC estão configurados e o resultado de um teste de conexão.

## Requisitos não funcionais

- CTR-NF1 — Envio, cancelamento, geração de cobrança e reprocessamentos auditados.
- CTR-NF2 — PDFs assinados guardados com acesso só por URL assinada de curta duração.
- CTR-NF3 — O `FakeProvider` e suas rotas `/dev/*` NÃO DEVEM existir em produção.

## Perguntas em aberto

- [x] Provedor real → Clicksign API v3 (ADR-009).
- [ ] O plano do Clicksign contratado inclui automação com modelos via API?
- [x] A empresa assina todos os contratos? → **Sim.** A empresa prestadora assina todos e o cliente também (CTR-02.3).
- [x] Testemunhas são necessárias? → **Não** (papel `WITNESS` removido).
- [x] Endereço obrigatório? → **Sim, em todo contrato** (CTR-02.9).

## Changelog

| Data | Mudança |
| --- | --- |
| 07/10/2026 | Versão inicial |
| 07/10/2026 | Provedor definido: Clicksign. CTR-02.8 (método de autenticação), CTR-03 e CTR-04.5 ajustados ao fluxo de envelopes e HMAC, CTR-08 reescrito |
| 07/10/2026 | Decisões do dono: empresa assina todos os contratos, sem testemunhas (CTR-02.3), endereço de cobrança obrigatório (CTR-02.9); CTR-05.2 ajusta também o 'N dias após a assinatura' quando a geração é refeita tarde; CTR-05.4 funciona após esgotar tentativas |
