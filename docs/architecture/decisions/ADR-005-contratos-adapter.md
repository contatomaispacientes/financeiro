# ADR-005 — Contratos atrás de um adapter, com modelos do provedor e FakeProvider

**Status:** Aceito · 07/10/2026

## Contexto
O provedor de assinatura eletrônica ainda não foi escolhido (candidatos: ZapSign, Clicksign, Autentique, D4Sign). Gerar PDF localmente exige motor de renderização e manutenção de layout jurídico.

## Decisão
- Interface `ContractProvider` em `apps/api/src/integrations/contracts/` (ver `docs/integrations/contratos-provider.md`).
- v1 usa **modelos cadastrados no próprio provedor** com campos variáveis; o sistema guarda o `provider_template_id` e um `variable_map` (campo do provedor → variável do catálogo).
- `FakeProvider` completo (simula envio, links, assinatura e webhook) é implementado primeiro e usado em dev e testes. O provedor real é um segundo adapter, escolhido por `CONTRACT_PROVIDER`.

## Consequências
- O módulo de contratos pode ser construído e testado de ponta a ponta antes da escolha do provedor.
- Trocar de provedor = novo adapter + recadastro dos modelos.
- Geração local de PDF fica para v2 (novo ADR se necessário).
