# ADR-009 — Clicksign (API v3) como provedor de assinatura eletrônica

**Status:** Aceito · 07/10/2026 · Complementa ADR-005

## Contexto
O ADR-005 deixou o provedor de contratos atrás de um adapter, a definir. O dono escolheu o Clicksign.

## Decisão
- Usar a **API v3** do Clicksign (envelopes), não a 1.9 legada.
- 1 contrato = 1 envelope com 1 documento gerado a partir de um **modelo DOCX** cadastrado no Clicksign, com variáveis preenchidas pelo `variable_map`.
- Autenticação do signatário por e-mail (padrão), WhatsApp ou SMS.
- Webhook único `POST /webhooks/contracts/clicksign` validado pelo header `Content-Hmac` (HMAC-SHA256 do corpo bruto).
- `auto_close: true` no envelope: quando todos assinam, o documento finaliza sozinho e dispara a geração da cobrança.
- O `FakeContractProvider` continua existindo para dev e testes automatizados; `CONTRACT_PROVIDER=clicksign` em homologação e produção.

## Consequências
- Mapeamento detalhado em `docs/integrations/contratos-clicksign.md`; pontos marcados **[confirmar]** são validados no sandbox antes de implementar o adapter.
- Criar um contrato no Clicksign exige várias chamadas (envelope → documento → signatários → requisitos → ativar); o adapter grava os ids a cada passo para retomar sem duplicar.
- Modelo de dados ganha `contracts.provider_envelope_id` e `contract_signers.auth_method`.
- Depende de o plano do Clicksign incluir automação com modelos via API.
