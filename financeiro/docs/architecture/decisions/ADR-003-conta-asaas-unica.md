# ADR-003 — Uma conta Asaas; credenciais apenas em variáveis de ambiente

**Status:** Aceito · 07/10/2026

## Contexto
A referência (AvanceAI) guardava token por tenant no banco. Aqui há uma única empresa e uma única conta Asaas.

## Decisão
`ASAAS_ENV`, `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN` vivem só no ambiente (secret manager do host em produção). A tela de Configurações mostra ambiente, se a chave está configurada e o resultado de um teste de conexão — não permite ver nem editar a chave. Trocar a chave = alterar env e reiniciar.

## Consequências
- Nada de criptografia de segredo no banco (menos superfície de ataque).
- Multiempresa no futuro exigirá novo ADR (tabela de contas + segredo cifrado).
- Gerar novo token de webhook é um procedimento documentado (runbook), não um botão.
