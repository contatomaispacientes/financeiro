# 08 — Régua de cobrança · Requisitos

> Status: **Aprovado** · Prefixo: `REG` · Depende de: 03, 04 · Marco: M7 (WhatsApp na v1.1)

## Contexto

Reduzir inadimplência (O5) com lembretes automáticos antes e depois do vencimento, e manter o cliente informado em cada etapa da cobrança (emitida, paga, estornada, cancelada) com mensagens totalmente personalizáveis. Na AvanceAI o atraso bloqueava o acesso; aqui não há acesso a bloquear, então a régua vira notificação. Canais: notificações nativas do Asaas, e-mail da plataforma e, na v1.1, WhatsApp.

## Fora de escopo

- SMS próprio, ligação, negativação/protesto (o Asaas oferece; avaliar na v2).
- Régua diferente por cliente (v1: uma régua global + opção de desligar por cliente).

## Requisitos

### REG-01 — Configurar a régua

- REG-01.1 — O ADMIN DEVE configurar: dias antes do vencimento (0–30; 0 = não envia), envio no dia do vencimento (sim/não), dias após o vencimento (até 5 valores entre 1 e 60) e canais ativos. Os textos ficam em REG-08.
- REG-01.2 — Variáveis disponíveis: `{cliente}`, `{valor}`, `{vencimento}`, `{link}`, `{pix}`, `{linha_digitavel}`, `{empresa}`, `{servicos}`, `{parcela}` (ex.: "2/3"), `{dias_para_vencer}`, `{dias_atraso}`, `{data_pagamento}`, `{valor_estornado}`.
- REG-01.3 — O ADMIN DEVE ver a prévia de cada mensagem com uma cobrança real escolhida.
- REG-01.4 — SE a mensagem usar variável desconhecida, ENTÃO o sistema DEVE recusar com `REMINDER_UNKNOWN_VARIABLE`; SE usar variável que não existe naquele processo (ex.: `{dias_atraso}` em "Cobrança emitida"), ENTÃO DEVE recusar com `REMINDER_VARIABLE_NOT_AVAILABLE`.

### REG-02 — Canal Asaas

- REG-02.1 — ONDE o canal `ASAAS` estiver ativo, o sistema DEVE criar/atualizar clientes no Asaas com notificações habilitadas; quando inativo, desabilitadas. Cliente com lembretes desligados (REG-05.1) DEVE ficar com notificações desabilitadas no Asaas mesmo com o canal ativo.
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
- REG-04.2 — QUANDO uma cobrança for emitida no Asaas (manual, de contrato ou novo ciclo de assinatura) e a mensagem "Cobrança emitida" estiver ativa, o sistema DEVE enviar o link da fatura ao cliente pelos canais ativos (registrado como `CREATED`).
- REG-04.3 — QUANDO uma cobrança for paga, estornada ou cancelada e a mensagem correspondente estiver ativa, o sistema DEVE avisar o cliente (`PAID`, `REFUNDED`, `CANCELED`), no máximo uma vez por cobrança, tipo e canal.

### REG-05 — Controle por cliente

- REG-05.1 — O usuário DEVE poder desligar as mensagens automáticas de um cliente na ficha dele; isso DEVE desligar o e-mail/WhatsApp da plataforma **e** as notificações do Asaas para esse cliente (sincronizado em segundo plano). Envio manual continua possível.

### REG-06 — Histórico

- REG-06.1 — O detalhe da cobrança DEVE listar os lembretes (tipo, canal, data, situação, erro).
- REG-06.2 — Configurações › Régua DEVE mostrar os envios dos últimos 7 dias com totais por situação.

### REG-08 — Mensagens personalizáveis

**História:** Como ADMIN, quero escrever a mensagem de cada etapa da cobrança, para falar com o cliente do jeito da empresa em cada situação.

- REG-08.1 — O sistema DEVE ter uma mensagem editável para cada processo × canal: Cobrança emitida (`CREATED`), Lembrete antes do vencimento (`BEFORE_DUE`), Vence hoje (`ON_DUE`), Cobrança em atraso (`AFTER_DUE`), Envio manual (`MANUAL`), Pagamento confirmado (`PAID`), Estorno (`REFUNDED`) e Cobrança cancelada (`CANCELED`). E-mail tem assunto e corpo; WhatsApp tem corpo.
- REG-08.2 — Para `BEFORE_DUE` e `AFTER_DUE`, o ADMIN PODE criar uma mensagem específica para um dia da régua (ex.: 1 dia de atraso × 30 dias de atraso); sem a específica, vale a mensagem geral do tipo.
- REG-08.3 — Cada mensagem DEVE poder ser ativada ou desativada; mensagem desativada não é enviada automaticamente. `MANUAL` não pode ser desativada.
- REG-08.4 — O ADMIN DEVE poder restaurar o texto padrão de qualquer mensagem.
- REG-08.5 — O sistema DEVE vir com textos padrão em português para todas as mensagens; `PAID`, `REFUNDED` e `CANCELED` vêm desativadas.

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
| 07/10/2026 | Decisões do dono: mensagens totalmente personalizáveis por processo, canal e dia da régua (REG-08); novas mensagens de evento (emitida para qualquer origem, paga, estornada, cancelada — REG-04.2/04.3); desligar lembretes do cliente desliga também as notificações do Asaas (REG-02.1, REG-05.1); novas variáveis |
