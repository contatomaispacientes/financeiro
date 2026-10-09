# Deploy em produção (VPS Hostinger)

> FND-08 · ADR-015. Tudo roda em Docker Compose na VPS: Postgres, Redis, API, Caddy (site + HTTPS) e backup diário.

```
Internet ──443──▶ web (Caddy: SPA + HTTPS) ──/api──▶ api (NestJS + filas) ──▶ postgres, redis
                                                     backup ──▶ ./backups (pg_dump diário, 30 dias)
```

O `.env` de exemplo já vem no **modo demonstração**: Asaas simulado (ADR-016), contratos simulados e e-mail só registrado. Dá para usar o sistema inteiro sem nenhuma conta externa e depois virar para o modo real só trocando variáveis (seção 5).

## 1. Preparar a VPS (uma vez)

1. No hPanel, use o modelo **Ubuntu 24.04 com Docker** (ou instale com `curl -fsSL https://get.docker.com | sh`). Mínimo recomendado: 2 GB de RAM (o build do front usa memória).
2. **DNS do subdomínio:** em *Domínios › DNS / Nameservers*, crie um registro **A** com nome `financeiro` (ou o que quiser) apontando para o IP da VPS. Espere propagar: `ping financeiro.suaempresa.com.br` responde com o IP da VPS.
3. **Firewall:** libere só 22, 80 e 443 (firewall do hPanel ou `ufw allow 22,80,443/tcp && ufw enable`). Banco e Redis não publicam portas.
4. **Código na VPS:** no seu computador, `git push origin main`. Na VPS:
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
- Gere cada segredo com `openssl rand -hex 32` e cole no lugar de cada `troque-por-…` (`POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ASAAS_WEBHOOK_TOKEN`, `FAKE_CONTRACT_WEBHOOK_SECRET`). Atalho que faz tudo de uma vez:
  ```bash
  for k in POSTGRES_PASSWORD JWT_ACCESS_SECRET JWT_REFRESH_SECRET ASAAS_WEBHOOK_TOKEN FAKE_CONTRACT_WEBHOOK_SECRET; do
    sed -i "s|^$k=.*|$k=$(openssl rand -hex 32)|" .env
  done
  ```
- `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD`: seu primeiro acesso (senha com 10+ caracteres).

O `.env` nunca vai para o git.

## 3. Subir

```bash
docker compose -f docker-compose.prod.yml up -d --build      # 3 a 6 min no primeiro build
docker compose -f docker-compose.prod.yml ps                 # api "healthy" em ~1 min
docker compose -f docker-compose.prod.yml exec api node_modules/.bin/tsx prisma/seed.ts
```

- As migrations rodam sozinhas a cada subida da API.
- O seed em produção cria o admin, as configurações, as categorias de despesa, as mensagens da régua e (com `CONTRACT_PROVIDER=fake`) o modelo de contrato simulado. Não cria clientes fictícios. Rodar de novo não duplica.
- **Opcional, só no modo demonstração:** dados de exemplo (clientes com endereço, 7 meses de cobranças e despesas) para ver dashboard e fluxo de caixa cheios:
  ```bash
  docker compose -f docker-compose.prod.yml exec api node_modules/.bin/tsx prisma/seed-demo.ts
  ```
  Ele se recusa a rodar se `ASAAS_ENV` não for `mock`.

Abra `https://<DOMAIN>`, entre com o admin e, em **Configurações › Geral**, preencha os dados da empresa (nome, CNPJ, cidade) e o signatário padrão dos contratos. O Caddy emite o certificado HTTPS no primeiro acesso.

### Roteiro rápido de teste no modo demonstração

1. **Clientes:** cadastre um cliente com e-mail e endereço completo.
2. **Nova cobrança:** avulsa, parcelada ou recorrente → "Gerar cobrança no Asaas". No detalhe, **Simular pagamento** → o status vira Pago sozinho (pelo webhook simulado).
3. **Contrato:** Nova cobrança → "Gerar contrato em vez de cobrar já" → escolha o modelo → Salvar rascunho → Enviar para assinatura → em cada signatário, **Abrir** → Assinar. Quando todos assinam, a cobrança aparece no contrato.
4. **Régua:** Configurações › Régua → ligue "E-mail da plataforma" → "Rodar a régua agora (teste)". O histórico mostra o que sairia.
5. **Despesas, Visão geral e Fluxo de caixa** já refletem tudo.

## 4. Operação

| Tarefa | Comando |
| --- | --- |
| Atualizar para a versão nova | `git pull && docker compose -f docker-compose.prod.yml up -d --build` |
| Logs da API | `docker compose -f docker-compose.prod.yml logs -f api` |
| Reiniciar | `docker compose -f docker-compose.prod.yml restart api` |
| Backup manual agora | `docker compose -f docker-compose.prod.yml exec backup pg_dump -Fc -f /backups/financeiro-manual.dump` |

Rotinas automáticas (fuso de São Paulo): reconciliação com o Asaas às 06:00, expiração de contratos às 07:00, despesas recorrentes às 05:00, régua às 09:00, backup às 03:00, limpeza de eventos antigos no dia 1.

### Backups (FND-08.2)

- O serviço `backup` faz `pg_dump` todo dia às 03:00 e 5 minutos após subir, em `./backups/` na VPS, e apaga os arquivos com mais de 30 dias.
- **Cópia fora da VPS:** ative os backups automáticos da VPS no hPanel e, de vez em quando, baixe a pasta (`scp -r root@<ip>:financeiro/backups .`). Se a VPS se perder, os backups dentro dela vão junto.
- Os arquivos enviados (anexos de despesa, PDFs assinados) e o estado dos simuladores ficam no volume `financeiro_storage`, coberto pelo backup da VPS do hPanel.

**Teste de restauração** (faça uma vez por mês; validado em 08/10/2026):

```bash
C="docker compose -f docker-compose.prod.yml"
$C exec postgres createdb -U financeiro restore_test
$C exec backup pg_restore -d restore_test --no-owner /backups/<arquivo>.dump
$C exec postgres psql -U financeiro -d restore_test -c "select count(*) from charges"
$C exec postgres dropdb -U financeiro restore_test
```

**Restaurar de verdade** (perda de dados): pare a API (`$C stop api`), recrie o banco (`$C exec postgres dropdb -U financeiro financeiro && $C exec postgres createdb -U financeiro financeiro`), rode o `pg_restore` com `-d financeiro` e suba de novo (`$C start api`).

## 5. Virada para o modo real (FND-08.3)

Recomendado: primeiro **sandbox** do Asaas (dados de teste, mas a integração real), depois **produção**. Ao sair do modo `mock`, as cobranças simuladas continuam no banco como histórico; se quiser começar limpo, faça a virada num banco novo (`docker compose -f docker-compose.prod.yml down -v` apaga **tudo**, inclusive backups dos volumes — só faça se tiver certeza).

**E-mail real**
- [ ] Crie a caixa no hPanel (ex.: `financeiro@suaempresa.com.br`) e no `.env`: `SMTP_HOST=smtp.hostinger.com`, `SMTP_PORT=465`, `SMTP_USER` e `SMTP_PASS` dessa caixa, `MAIL_FROM` com o mesmo endereço. Confira SPF/DKIM do domínio no hPanel.

**Asaas**
- [ ] Gerar a chave (sandbox ou produção) e no `.env`: `ASAAS_ENV=sandbox` (ou `production`) e `ASAAS_API_KEY='$aact_…'` (aspas simples).
- [ ] Gerar um `ASAAS_WEBHOOK_TOKEN` novo e cadastrar o webhook em *Integrações › Webhooks* do Asaas: URL `https://<DOMAIN>/api/v1/webhooks/asaas`, token igual ao do `.env`, eventos de cobrança habilitados.
- [ ] `docker compose -f docker-compose.prod.yml up -d` (recarrega o `.env`); em Configurações › Integrações, "Testar conexão" verde.
- [ ] Cobrança real de baixo valor (R$ 5) por Pix, paga e com status **Pago** sozinho.
- [ ] Estorno dessa cobrança testado; aparece em *Fluxo de caixa*.

**Clicksign** (depende das tarefas 12–13 da spec 07, que precisam do sandbox da sua conta)
- [ ] Token de produção, modelo cadastrado na conta, webhook `https://<DOMAIN>/api/v1/webhooks/contracts/clicksign` com segredo HMAC novo em `CLICKSIGN_HMAC_SECRET`, `CONTRACT_PROVIDER=clicksign`, e um contrato real assinado gerando cobrança.

- [ ] Anotar aqui a data da virada e quem fez.
