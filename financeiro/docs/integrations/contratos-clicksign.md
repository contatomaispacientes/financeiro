# Integração Clicksign (API v3 — envelopes)

> Provedor de assinatura eletrônica escolhido (ADR-009). Implementa a interface `ContractProvider` de `contratos-provider.md`.
> Referência oficial: https://developers.clicksign.com · Use **sempre a API v3** (a 1.9 é legada). Itens marcados **[confirmar]** devem ser validados no sandbox na tarefa CTR-12 e esta página corrigida.

## Ambiente e autenticação

| | Sandbox | Produção |
| --- | --- | --- |
| Base URL | `https://sandbox.clicksign.com/api/v3` | `https://app.clicksign.com/api/v3` **[confirmar]** |
| IP de saída dos webhooks | `3.232.199.65` | `34.204.113.69` |

Headers em todas as chamadas:

```
Authorization: <CLICKSIGN_ACCESS_TOKEN>
Content-Type: application/vnd.api+json
Accept: application/vnd.api+json
```

Tokens de sandbox e produção não são intercambiáveis. Corpo e resposta seguem JSON:API (`data.type`, `data.attributes`, `data.relationships`). Timeout 15 s; retry só em rede/5xx/429.

## Conceitos

| Clicksign | No nosso sistema |
| --- | --- |
| Envelope (`draft` → `running` → finalizado/cancelado) | `contracts` (1 contrato = 1 envelope) — `provider_envelope_id` |
| Documento do envelope (gerado a partir de modelo) | `contracts.provider_document_id` |
| Modelo (`templates`, arquivo DOCX com variáveis) | `contract_templates.provider_template_id` + `variable_map` |
| Signatário (`signers`) | `contract_signers.provider_signer_id` |
| Requisito de qualificação (`action: agree`, `role`) | papel do signatário no documento |
| Requisito de autenticação (`action: provide_evidence`, `auth`) | `contract_signers.auth_method` |

## `createDocument` → sequência de chamadas

Executar em ordem, guardando cada id no banco **logo após cada passo** (permite retomar sem duplicar se algo falhar no meio):

1. **Envelope** — `POST /envelopes`
   ```json
   { "data": { "type": "envelopes", "attributes": {
       "name": "<contracts.title>", "locale": "pt-BR", "auto_close": true,
       "remind_interval": 3, "block_after_refusal": true,
       "deadline_at": "<expires_at RFC 3339>" } } }
   ```
   → `provider_envelope_id`.
2. **Documento a partir do modelo** — `POST /envelopes/{envelope_id}/documents`
   ```json
   { "data": { "type": "documents", "attributes": {
       "filename": "<titulo-slug>.pdf",
       "template": { "key": "<provider_template_id>", "data": { "<variavel_no_modelo>": "<valor>" } } } } }
   ```
   → `provider_document_id`. `data` = campos resolvidos pelo `variable_map`.
3. **Signatários** — `POST /envelopes/{envelope_id}/signers`, um por signatário:
   ```json
   { "data": { "type": "signers", "attributes": {
       "name": "…", "email": "…", "phone_number": "<só dígitos, com DDD>",
       "has_documentation": true, "documentation": "<CPF formatado>",
       "refusable": true, "group": <sign_order>,
       "communicate_events": { "signature_request": "email", "signature_reminder": "email", "document_signed": "email" } } } }
   ```
   → `provider_signer_id`. `signature_request` = `email` ou `whatsapp` conforme `auth_method`/canal escolhido **[confirmar valores aceitos]**. `group` define a ordem de assinatura **[confirmar]**.
4. **Requisitos** — `POST /envelopes/{envelope_id}/requirements`, dois por signatário:
   - Qualificação: `{ "action": "agree", "role": "<papel>" }` + relationships `document` e `signer`.
   - Autenticação: `{ "action": "provide_evidence", "auth": "<email|whatsapp|sms|…>" }` + relationships.
   O Clicksign exige ao menos uma autenticação por signatário para ativar o envelope.
5. **Ativar** — `PATCH /envelopes/{envelope_id}` com `{ "data": { "id": "<id>", "type": "envelopes", "attributes": { "status": "running" } } }`. Não volta para `draft`.
6. **Notificar** — `POST /envelopes/{envelope_id}/notifications` (todos) **[confirmar se a ativação já notifica quando `communicate_events.signature_request` ≠ none]**.
7. **Links de assinatura** — obter a URL individual de cada signatário para exibir/copiar na nossa tela **[confirmar campo no `GET /envelopes/{id}/signers/{id}`]**. Se não houver link individual na v3, a tela mostra só "convite enviado por e-mail/WhatsApp".

### Mapeamento de papéis

| `contract_signers.role` | `role` no requisito de qualificação |
| --- | --- |
| `CLIENT` | `contractor` (contratante) **[confirmar lista completa de papéis]** |
| `COMPANY` | `party` (parte) |
| `WITNESS` | papel de testemunha, se existir na v3; senão `sign` |

### Métodos de autenticação suportados na v1 do nosso sistema

`email` (padrão), `whatsapp`, `sms`. Outros que o Clicksign oferece (`pix`, `selfie`, `official_document`, `facial_biometrics`, `icp_brasil`…) ficam para depois.

## Outras operações

| Interface | Clicksign v3 |
| --- | --- |
| `getDocument` | `GET /envelopes/{envelope_id}` + `GET /envelopes/{envelope_id}/signers` (status de cada um) + `GET /envelopes/{envelope_id}/documents/{document_id}` |
| `cancelDocument` | Cancelar envelope/documento em andamento **[confirmar endpoint na v3 — envelope `draft` pode ser excluído com `DELETE /envelopes/{id}`]** |
| `resendToSigner` | `POST /envelopes/{envelope_id}/signers/{signer_id}/notifications` |
| `downloadSignedFile` | URL do arquivo assinado do documento (`links.files.signed` no documento **[confirmar]**, ou `document.downloads.signed_file_url` do evento `document_closed`) → baixar e gravar no storage na hora (URLs expiram) |
| `listTemplates` | `GET /templates` (nome e chave; variáveis do modelo **[confirmar se a API as devolve]**; se não, o ADMIN digita os nomes no mapeamento) |

## Webhook

- Cadastro: no painel do Clicksign ou pela API, apontando para `POST /api/v1/webhooks/contracts/clicksign`. Um webhook para sandbox e outro para produção.
- **Autenticação**: header `Content-Hmac: sha256=<hex>`, onde `hex = HMAC-SHA256(CLICKSIGN_HMAC_SECRET, corpo_bruto)`. Calcular sobre o **corpo bruto** (não reformatar o JSON) e comparar em tempo constante. Opcional: aceitar só os IPs de saída da tabela acima.
- **Entrega**: timeout de **5 s** e até **10 tentativas em ~24 h** (imediato, +10 s, +50 s, +4 min, +25 min, +30 min, +1 h, +4 h, +6 h, +12 h). Responder 2xx assim que persistir (ADR-004).
- Estrutura do corpo: `event` (`name`, `data`, `occurred_at`), `document` e `signers`.

### Eventos → `NormalizedContractEvent`

| Evento Clicksign | Normalizado | Observação |
| --- | --- | --- |
| `sign` | `SIGNER_SIGNED` | signatário identificado por `event.data.signer` (chave ou e-mail) **[confirmar campo]** |
| `refusal` | `SIGNER_REFUSED` | motivo em `event.data` quando houver |
| `auto_close` | `DOCUMENT_COMPLETED` | todos assinaram e o documento foi finalizado automaticamente (`auto_close: true` no envelope) |
| `close` | `DOCUMENT_COMPLETED` | finalizado manualmente no painel |
| `document_closed` | `DOCUMENT_COMPLETED` + gatilho de download | arquivo assinado pronto (`document.downloads.signed_file_url`); usar para baixar o PDF |
| `deadline` | `DOCUMENT_EXPIRED` | prazo (`deadline_at`) atingido |
| `cancel` | `DOCUMENT_CANCELED` | |
| `add_signer`, `remove_signer`, `upload`, demais | `IGNORED` | só registra |

`DOCUMENT_COMPLETED` pode chegar duas vezes (`auto_close` e `document_closed`): a máquina de estados já trata a segunda como transição ignorada, e a geração de cobrança é idempotente (CTR-05.3).

**Chave de idempotência** (`external_event_id`): o payload não traz um id de evento documentado **[confirmar]**; usar `sha256(document.key + event.name + (signer key|email|"") + event.occurred_at)`.

**Localização do contrato**: por `provider_document_id = document.key`; fallback por `provider_envelope_id` se o payload trouxer o envelope.

## Variáveis no modelo (DOCX)

O modelo é um DOCX cadastrado no Clicksign com variáveis entre chaves duplas, ex.: `{{cliente_nome}}` **[confirmar sintaxe]**. Sugestão de nomes no modelo, alinhados ao catálogo (`contratos-provider.md`):

| Variável no modelo Clicksign | Variável do catálogo |
| --- | --- |
| `cliente_nome` | `cliente.nome` |
| `cliente_documento` | `cliente.documento` |
| `cliente_endereco` | `cliente.endereco` |
| `servicos_lista` | `servicos.lista` |
| `valor_total` | `cobranca.valor_total` |
| `condicao_pagamento` | `cobranca.condicao` |
| `forma_pagamento` | `cobranca.forma` |
| `vencimento` | `cobranca.vencimento` |
| `multa` / `juros` | `cobranca.multa` / `cobranca.juros` |
| `data_contrato` / `cidade` | `contrato.data` / `contrato.cidade` |
| `empresa_nome` / `empresa_documento` | `empresa.nome` / `empresa.documento` |

Verificar se o plano contratado do Clicksign inclui **automação com modelos via API** antes de começar (pré-requisito comercial).

## Variáveis de ambiente

| Variável | Exemplo |
| --- | --- |
| `CONTRACT_PROVIDER` | `fake` (dev/testes) \| `clicksign` |
| `CLICKSIGN_ENV` | `sandbox` \| `production` |
| `CLICKSIGN_ACCESS_TOKEN` | token da conta (painel › Configurações › API) |
| `CLICKSIGN_HMAC_SECRET` | "HMAC SHA256 Secret" gerado no cadastro do webhook |

## Runbook

- **Novo modelo**: criar o DOCX com as variáveis da tabela → cadastrar no Clicksign → copiar a chave → cadastrar em Contratos › Modelos com o mapeamento → usar a prévia.
- **Webhook falhando**: o Clicksign tenta por ~24 h; corrigir e, se passou do prazo, usar "Sincronizar" no contrato (`POST /contracts/:id/sync`).
- **Trocar segredo HMAC**: recriar o webhook no Clicksign → atualizar `CLICKSIGN_HMAC_SECRET` → reiniciar a API → sincronizar contratos enviados no intervalo.
