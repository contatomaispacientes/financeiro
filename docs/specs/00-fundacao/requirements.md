# 00 — Fundação · Requisitos

> Status: **Aprovado** · Prefixo: `FND` · Depende de: — · Marco: M0 (e M8 para a seção Produção)

## Contexto

Base técnica sobre a qual todos os módulos são construídos: monorepo, banco, filas, autenticação, papéis, configurações, auditoria, layout do front e CI. Sem regra financeira aqui, exceto os padrões em Configurações.

## Fora de escopo

- Login social, 2FA (avaliar após M8), recuperação de senha por e-mail (v1: ADMIN redefine a senha).

## Requisitos

### FND-01 — Ambiente de desenvolvimento reproduzível

**História:** Como desenvolvedor, quero subir tudo com poucos comandos, para começar a trabalhar em minutos.

- FND-01.1 — O repositório DEVE ter workspaces `apps/api`, `apps/web` e `packages/shared` gerenciados por pnpm.
- FND-01.2 — `docker compose up -d` DEVE subir PostgreSQL, Redis e Mailpit com volumes nomeados.
- FND-01.3 — `pnpm dev` DEVE iniciar API e web com recarga automática.
- FND-01.4 — SE uma variável de ambiente obrigatória faltar ou for inválida, ENTÃO a API NÃO DEVE iniciar e DEVE listar quais variáveis estão erradas.
- FND-01.5 — `pnpm db:seed` DEVE criar o usuário admin, as configurações padrão, as categorias de despesa e os dados fictícios de exemplo.

### FND-02 — Autenticação

**História:** Como usuário interno, quero entrar com e-mail e senha, para acessar só o que meu papel permite.

- FND-02.1 — QUANDO credenciais válidas forem enviadas a `POST /auth/login`, o sistema DEVE devolver access token (15 min) e definir refresh token (7 dias) em cookie `httpOnly`, `secure`, `sameSite=strict`.
- FND-02.2 — SE as credenciais forem inválidas ou o usuário estiver inativo, ENTÃO o sistema DEVE responder 401 `INVALID_CREDENTIALS` sem revelar qual dos dois falhou.
- FND-02.3 — QUANDO `POST /auth/refresh` receber refresh válido, o sistema DEVE emitir novo par e revogar o refresh usado (rotação).
- FND-02.4 — SE um refresh já revogado for reutilizado, ENTÃO o sistema DEVE revogar todos os refresh do usuário (detecção de roubo).
- FND-02.5 — O sistema DEVE limitar `POST /auth/login` a 5 tentativas por minuto por IP + e-mail.
- FND-02.6 — Toda rota DEVE exigir autenticação, exceto as marcadas como públicas (login, refresh, webhooks, health).

### FND-03 — Usuários e papéis

**História:** Como ADMIN, quero cadastrar usuários com papéis, para controlar quem pode cobrar, estornar e configurar.

- FND-03.1 — O ADMIN DEVE poder criar, editar, desativar usuários e redefinir senha.
- FND-03.2 — O sistema DEVE aplicar a matriz de permissões do design (ADMIN, FINANCEIRO, LEITURA).
- FND-03.3 — SE um usuário tentar uma ação fora do seu papel, ENTÃO o sistema DEVE responder 403 `FORBIDDEN`.
- FND-03.4 — O sistema NÃO DEVE permitir desativar o último ADMIN ativo (`LAST_ADMIN`).

### FND-04 — Configurações

**História:** Como ADMIN, quero definir padrões financeiros e ver o estado das integrações, para que as cobranças saiam corretas sem eu repetir parâmetros.

- FND-04.1 — O sistema DEVE manter uma linha de configurações com: nome e documento da empresa, cidade, vencimento padrão em dias, multa %, juros % ao mês, dias de vencimento da cobrança gerada por contrato e parâmetros da régua.
- FND-04.2 — `GET /settings/integrations` DEVE mostrar: ambiente Asaas, se a chave está configurada (sem revelá-la), resultado do último teste de conexão, situação do token de webhook (configurado ou não), provedor de contratos ativo (`fake` ou `clicksign`, com ambiente e se token/segredo HMAC estão configurados), e-mail configurado.
- FND-04.3 — QUANDO o ADMIN pedir "Testar conexão", o sistema DEVE chamar o Asaas e mostrar sucesso/latência ou o erro.
- FND-04.4 — Toda alteração de configurações DEVE gerar registro de auditoria com antes/depois.

### FND-05 — Auditoria

- FND-05.1 — O sistema DEVE registrar em `audit_logs`: login (sucesso e falha), alterações de usuários e configurações, e as ações sensíveis definidas nos demais módulos.
- FND-05.2 — O ADMIN DEVE poder consultar a auditoria filtrando por entidade, usuário e período.

### FND-06 — Casca do front

- FND-06.1 — O web DEVE ter tela de login, layout com menu lateral (grupos Análise, Contas a receber, Contas a pagar, Sistema) responsivo até 375 px, e selo do ambiente Asaas.
- FND-06.2 — QUANDO o access token expirar, o web DEVE renovar com o refresh de forma transparente; SE o refresh falhar, ENTÃO DEVE voltar ao login preservando a rota de destino.
- FND-06.3 — Itens de menu e botões de ação DEVEM respeitar o papel do usuário.

### FND-07 — Qualidade

- FND-07.1 — CI DEVE rodar lint, typecheck, testes unitários e de integração e build a cada push/PR.
- FND-07.2 — A API DEVE expor `GET /health` (banco e Redis) e documentação OpenAPI em `/api/docs` fora de produção.
- FND-07.3 — Logs DEVEM ser JSON com `requestId` e NÃO DEVEM conter CPF/CNPJ completo, tokens ou chaves.

### FND-08 — Produção (M8)

- FND-08.1 — O sistema DEVE ter `Dockerfile` de produção para api e web e um guia de deploy.
- FND-08.2 — DEVE haver backup diário do Postgres com retenção de 30 dias e teste de restauração documentado.
- FND-08.3 — A virada para produção DEVE seguir checklist: chave de produção do Asaas, webhook de produção com token novo, eventos habilitados, HTTPS, CORS, cobrança real de baixo valor paga e conciliada, estorno testado; Clicksign com token de produção, modelo cadastrado na conta de produção, webhook de produção com novo segredo HMAC e um contrato real assinado gerando cobrança.

## Requisitos não funcionais

- FND-NF1 — p95 das rotas de leitura < 300 ms com 10 mil cobranças.
- FND-NF2 — Senhas com argon2id; nenhum segredo versionado (`.env` no `.gitignore`, `.env.example` versionado).
- FND-NF3 — Interface em pt-BR; acessibilidade: navegação por teclado, contraste AA, rótulos em todos os campos.

## Perguntas em aberto

- [x] Hospedagem de produção → VPS Hostinger com Docker Compose + Caddy (ADR-015).

## Changelog

| Data | Mudança |
| --- | --- |
| 07/10/2026 | Versão inicial |
