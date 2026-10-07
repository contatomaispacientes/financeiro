# 08 — Régua de cobrança · Requisitos

> Status: **Em revisão** · Prefixo: `REG` · Depende de: 03, 04 · Marco: M7 (WhatsApp na v1.1)

## Contexto

Reduzir inadimplência (O5) com lembretes automáticos antes e depois do vencimento. Na AvanceAI o atraso bloqueava o acesso; aqui não há acesso a bloquear, então a régua vira notificação. Canais: notificações nativas do Asaas, e-mail da plataforma e, na v1.1, WhatsApp.

## Fora de escopo

- SMS próprio, ligação, negativação/protesto (o Asaas oferece; avaliar na v2).
- Régua diferente por cliente (v1: uma régua global + opção de desligar por cliente).

## Requisitos

### REG-01 — Configurar a régua

- REG-01.1 — O ADMIN DEVE configurar: dias antes do vencimento (0–30; 0 = não envia), envio no dia do vencimento (sim/não), dias após o vencimento (até 5 valores entre 1 e 60), canais ativos e mensagem com variáveis.
- REG-01.2 — Variáveis disponíveis: `{cliente}`, `{valor}`, `{vencimento}`, `{link}`, `{pix}`, `{linha_digitavel}`, `{empresa}`, `{dias_atraso}`.
- REG-01.3 — O ADMIN DEVE ver a prévia da mensagem com uma cobrança real escolhida.
- REG-01.4 — SE a mensagem usar variável desconhecida, ENTÃO o sistema DEVE recusar com `REMINDER_UNKNOWN_VARIABLE`.

### REG-02 — Canal Asaas

- REG-02.1 — ONDE o canal `ASAAS` estiver ativo, o sistema DEVE criar/atualizar clientes no Asaas com notificações habilitadas; quando inativo, desabilitadas.
- REG-02.2 — QUANDO o canal `ASAAS` for ligado ou desligado, o sistema DEVE atualizar os clientes já existentes no Asaas em segundo plano.

### REG-03 — Canal e-mail

- REG-03.1 — Todo dia às 09:00 (America/Sao_Paulo), o sistema DEVE enviar por e-mail os lembretes devidos no dia para cobranças em aberto: antes do vencimento, no dia e após o vencimento, conforme a configuração.
- REG-03.2 — Cada lembrete (cobrança + tipo + canal + dia de referência) DEVE ser enviado no máximo uma vez, mesmo se o job rodar de novo.
- REG-03.3 — SE a cobrança for paga ou cancelada antes do envio, ENTÃO o lembrete NÃO DEVE sair.
- REG-03.4 — SE o cliente não tiver e-mail ou estiver com lembretes desligados, ENTÃO o lembrete DEVE ser registrado como `SKIPPED` com o motivo.
- REG-03.5 — SE o envio falhar, ENTÃO o sistema DEVE tentar de novo até 3 vezes e registrar `FAILED` com o erro.
- REG-03.6 — Cobranças vencidas há mais tempo que o maior "dias após" NÃO DEVEM receber novos lembretes automáticos.

### REG-04 — Envios avulsos

- REG-04.1 — O envio manual da cobrança (COB-10) DEVE usar o mesmo modelo e ser registrado como `MANUAL`.
- REG-04.2 — QUANDO uma cobrança for gerada a partir de contrato e o canal e-mail estiver ativo, o sistema DEVE enviar o link da fatura ao cliente (registrado como `CREATED`).

### REG-05 — Controle por cliente

- REG-05.1 — O usuário DEVE poder desligar os lembretes automáticos de um cliente na ficha dele.

### REG-06 — Histórico

- REG-06.1 — O detalhe da cobrança DEVE listar os lembretes (tipo, canal, data, situação, erro).
- REG-06.2 — Configurações › Régua DEVE mostrar os envios dos últimos 7 dias com totais por situação.

### REG-07 — WhatsApp (v1.1)

- REG-07.1 — ONDE o canal `WHATSAPP` estiver ativo e configurado, o sistema DEVE enviar os mesmos lembretes por WhatsApp para o celular do cliente, com as mesmas regras de unicidade e salto.
- REG-07.2 — O provedor de WhatsApp DEVE ficar atrás de uma interface `WhatsAppProvider` (escolha registrada em ADR).

## Requisitos não funcionais

- REG-NF1 — E-mails com remetente e domínio configurados (SPF/DKIM no provedor de produção); texto simples + HTML simples.
- REG-NF2 — Em ambiente não produtivo, todo e-mail vai para o Mailpit (nunca para o cliente real).

## Changelog

| Data | Mudança |
| --- | --- |
| 07/10/2026 | Versão inicial |
