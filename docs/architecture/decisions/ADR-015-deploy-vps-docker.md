# ADR-015 — Produção em VPS Hostinger com Docker Compose e Caddy

**Status:** Aceito · 08/10/2026 · Resolve a pendência "Hospedagem de produção" (visao.md, FND)

## Contexto
O dono tem uma VPS na Hostinger e quer o sistema num subdomínio próprio. O sistema precisa de Postgres, Redis (BullMQ) e de processos de longa duração (filas e crons), o que descarta hospedagem compartilhada de Node.js.

## Decisão
- Tudo em **Docker Compose** na VPS (`docker-compose.prod.yml`): `postgres`, `redis`, `api`, `web`, `backup`. Só o `web` publica portas (80/443).
- **Um `Dockerfile` na raiz** com dois alvos (`api` e `web`) e um estágio de build comum, em vez de um por app: o monorepo precisa do `shared` e do lockfile da raiz nos dois. A imagem da API leva o workspace instalado inteiro (dependências de dev incluídas), para rodar `prisma migrate deploy` ao subir e o `tsx` do seed. Imagem maior, sem risco de faltar pacote; otimizar depois se o disco apertar.
- **Caddy** (`caddy:2.10.2-alpine`) serve a SPA, faz proxy de `/api` para a API e emite e renova o HTTPS sozinho (Let's Encrypt). Mesmo domínio para front e API: sem CORS entre origens e o cookie de refresh (`SameSite=Strict`, `Secure`) funciona.
- API com `trust proxy = 1` em produção, para o limite de login usar o IP real (`X-Forwarded-For` do Caddy).
- **Backup**: contêiner `postgres:17-alpine` com `deploy/backup.sh` (`pg_dump -Fc` diário às 03:00 BRT, retenção de 30 dias) na pasta `./backups` da VPS. A cópia fora da VPS fica com os backups automáticos da Hostinger e downloads periódicos. O design previa S3; adiado até haver um bucket.
- pnpm instalado no build com `npm i -g pnpm@<versão do packageManager>`: o Corepack do Node 24 não consegue baixar o pnpm 12.
- O seed em produção exige `SEED_ADMIN_PASSWORD`, aceita `SEED_ADMIN_EMAIL` e não cria clientes, serviços nem modelo de contrato fictícios.

## Consequências
- Deploy e atualização: `git pull && docker compose -f docker-compose.prod.yml up -d --build` (guia em `docs/deploy.md`).
- O build roda na VPS: precisa de cerca de 2 GB de RAM.
- Sem CI de deploy por enquanto; o CI continua só validando.
