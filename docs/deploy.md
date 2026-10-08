# Deploy em produção (VPS Hostinger)

> FND-08 · ADR-015. Tudo roda em Docker Compose na VPS: Postgres, Redis, API, Caddy (site + HTTPS) e backup diário.

```
Internet ──443──▶ web (Caddy: SPA + HTTPS) ──/api──▶ api (NestJS) ──▶ postgres, redis
                                                     backup ──▶ ./backups (pg_dump diário, 30 dias)
```

## 1. Preparar a VPS (uma vez)

1. No hPanel, crie a VPS com o modelo **Ubuntu 24.04 com Docker** (ou instale o Docker com `curl -fsSL https://get.docker.com | sh`). Mínimo recomendado: 2 GB de RAM (o build do front usa memória).
2. **DNS do subdomínio:** em *Domínios › DNS / Nameservers*, crie um registro **A** com nome `financeiro` (ou o que quiser) apontando para o IP da VPS. Espere propagar (`ping financeiro.suaempresa.com.br` responde com o IP).
3. **Firewall:** libere só 22, 80 e 443 (no firewall do hPanel ou com `ufw allow 22,80,443/tcp && ufw enable`). Nada mais precisa ficar exposto: banco e Redis não publicam portas.
4. Acesse por SSH e clone o repositório:
   ```bash
   git clone https://github.com/<usuario>/<repo>.git financeiro && cd financeiro
   ```
   Repositório privado: use um token de acesso (`https://<token>@github.com/...`) ou uma *deploy key* só de leitura.

## 2. Configurar

```bash
cp deploy/env.production.example .env
nano .env
```

- `DOMAIN`: o subdomínio do passo 1.2.
- Gere cada segredo com `openssl rand -hex 32` (`POSTGRES_PASSWORD`, `JWT_*`, `ASAAS_WEBHOOK_TOKEN`).
- `ASAAS_API_KEY` **entre aspas simples** (a chave começa com `$`).
- Comece com `ASAAS_ENV=sandbox` e `CONTRACT_PROVIDER=fake`. Produção só no passo 5.
- `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD`: seu primeiro acesso.

O `.env` nunca vai para o git.

## 3. Subir

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps        # api "healthy" em ~1 min
docker compose -f docker-compose.prod.yml exec api node_modules/.bin/tsx prisma/seed.ts
```

As migrations rodam sozinhas a cada subida da API. O seed em produção cria só o admin, as configurações, as categorias de despesa e os modelos de lembrete (sem clientes ou serviços fictícios). Rodar de novo não duplica nada.

Abra `https://<DOMAIN>`, entre com o admin e troque a senha em *Usuários*. O Caddy emite o certificado HTTPS no primeiro acesso.

**Webhook do Asaas:** em *Integrações › Webhooks* no painel do Asaas, cadastre `https://<DOMAIN>/api/v1/webhooks/asaas` com o token de `ASAAS_WEBHOOK_TOKEN`. Em *Configurações › Integrações*, use "Testar conexão".

## 4. Operação

| Tarefa | Comando |
| --- | --- |
| Atualizar para a versão nova | `git pull && docker compose -f docker-compose.prod.yml up -d --build` |
| Logs da API | `docker compose -f docker-compose.prod.yml logs -f api` |
| Reiniciar | `docker compose -f docker-compose.prod.yml restart api` |
| Backup manual agora | `docker compose -f docker-compose.prod.yml exec backup pg_dump -Fc -f /backups/financeiro-manual.dump` |

### Backups (FND-08.2)

- O serviço `backup` faz `pg_dump` todo dia às 03:00 (horário de São Paulo) e 5 minutos após subir, em `./backups/` na VPS, e apaga os arquivos com mais de 30 dias.
- **Cópia fora da VPS:** ative os backups automáticos da VPS no hPanel e, de vez em quando, baixe a pasta (`scp -r root@<ip>:financeiro/backups .`). Se a VPS se perder, os backups dentro dela vão junto.

**Teste de restauração** (faça uma vez por mês; validado em 08/10/2026):

```bash
C="docker compose -f docker-compose.prod.yml"
$C exec postgres createdb -U financeiro restore_test
$C exec backup pg_restore -d restore_test --no-owner /backups/<arquivo>.dump
$C exec postgres psql -U financeiro -d restore_test -c "select count(*) from charges"
$C exec postgres dropdb -U financeiro restore_test
```

**Restaurar de verdade** (perda de dados): pare a API (`$C stop api`), recrie o banco (`$C exec postgres dropdb -U financeiro financeiro && $C exec postgres createdb -U financeiro financeiro`), rode o `pg_restore` com `-d financeiro` e suba de novo (`$C start api`).

## 5. Virada para produção (FND-08.3)

Só depois de usar em sandbox e ver os números baterem. Marque cada item:

- [ ] Asaas: gerar a chave de **produção**, trocar `ASAAS_ENV=production` e `ASAAS_API_KEY` no `.env`.
- [ ] Gerar um `ASAAS_WEBHOOK_TOKEN` novo e cadastrar o webhook na conta de produção com os eventos de cobrança habilitados.
- [ ] `docker compose -f docker-compose.prod.yml up -d` (recarrega o `.env`); "Testar conexão" verde.
- [ ] HTTPS ok (cadeado no navegador); login funciona; nenhum aviso de CORS.
- [ ] Cobrança real de baixo valor (R$ 5) por Pix, paga e com status **Pago** sozinho.
- [ ] Estorno dessa cobrança testado; aparece em *Fluxo de caixa*.
- [ ] Clicksign (quando o módulo de contratos estiver pronto): token de produção, modelo cadastrado na conta de produção, webhook com segredo HMAC novo e um contrato real assinado gerando cobrança.
- [ ] Anotar aqui a data da virada e quem fez.
