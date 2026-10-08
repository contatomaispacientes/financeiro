# Financeiro

Plataforma interna de gestão financeira: clientes, serviços, cobranças no Asaas (avulsa, parcelada, recorrente), contratos assinados no Clicksign que geram a cobrança, contas a pagar e fluxo de caixa.

> Fase atual: **especificação**. O código ainda não existe — começa pela spec `00-fundacao`.

## Como começar no Claude Code

1. Crie o repositório e copie este conteúdo para a raiz. Faça o primeiro commit.
2. Abra o Claude Code na pasta e peça: "leia o CLAUDE.md e me dê o status das specs" (ou rode `/spec-status`).
3. Revise as specs `01` a `08` (estão `Em revisão`). Ajuste o que quiser e marque `Aprovado` no topo de cada arquivo — ou peça ao Claude para aplicar suas mudanças.
4. Implemente tarefa por tarefa: `/spec-implementar 00-fundacao`.
5. Ao terminar um módulo: `/spec-revisar <módulo>`.

## Mapa da documentação

| Arquivo | Conteúdo |
| --- | --- |
| `CLAUDE.md` | Regras do projeto para o Claude Code (lido automaticamente) |
| `docs/product/visao.md` | Problema, objetivos, usuários, escopo, glossário |
| `docs/product/telas.md` | Telas e padrões de interface |
| `docs/architecture/stack.md` | Stack, estrutura de pastas, convenções, variáveis de ambiente |
| `docs/architecture/overview.md` | Módulos, filas, fluxos (cobrança, contrato, webhook, reconciliação), estados |
| `docs/architecture/data-model.md` | Schema Prisma alvo e regras de integridade |
| `docs/architecture/decisions/` | ADRs |
| `docs/integrations/asaas.md` | Contrato com a API do Asaas, webhook, runbook |
| `docs/integrations/contratos-provider.md` | Interface do provedor de assinatura e FakeProvider |
| `docs/integrations/contratos-clicksign.md` | Clicksign API v3: envelopes, modelos, webhook HMAC, runbook |
| `docs/specs/` | Uma pasta por módulo com `requirements.md`, `design.md`, `tasks.md` |
| `docs/reference/` | Mapeamento original da AvanceAI |
| `.claude/skills/` | Comandos do fluxo SDD (`/spec-novo`, `/spec-design`, `/spec-tarefas`, `/spec-implementar`, `/spec-revisar`, `/spec-status`) |

## Pendências de decisão

- Clicksign: confirmar que o plano inclui automação com modelos via API e criar o modelo DOCX no sandbox.
- E-mail transacional de produção e WhatsApp (v1.1).
- Hospedagem de produção.
