# Estrutura de Pagamentos — Mapeamento AvanceAI + Projeto com Asaas

Oct 7, 2026 · @Gabriel

## Resumo

A AvanceAI cobra seus clientes (tenants) por **plano recorrente** via gateway (Asaas ativo), com vencimento da 1ª fatura configurável, bloqueio opcional até o 1º pagamento e alerta/bloqueio por atraso definidos por cliente. Os status das faturas chegam por **webhook**.

Sua plataforma troca "plano" por **serviços avulsos**: você cadastra o cliente, escolhe um ou mais serviços e o sistema cria a cobrança no Asaas (Pix, boleto ou cartão), acompanhando o status pelo webhook. A estrutura abaixo reaproveita o que funciona na AvanceAI e remove o que é específico de SaaS (limites de conexões, usuários, trial).

## Mapeamento da AvanceAI

O pagamento está espalhado em quatro telas do painel super admin. Nenhum dado foi alterado durante o mapeamento.

| Tela | O que faz | Campos / colunas observados |
| --- | --- | --- |
| **Planos** (`/planos`) | Catálogo de planos vendidos | ID, Nome, Preço (Mensal R$ 499,00; Anual R$ 4.788,00), Conexões, Usuários, Trial (sim/não), Dias de trial |
| **Novo Plano** (modal) | Criação do plano | Nome, Valor (R$), Conexões, Usuários, Dias de trial, Galeria (MB), Período trial (on/off); Catálogo: exibir na página pública, destacar como mais popular, ordem, descrição; Funcionalidades incluídas (\~40 toggles por módulo) |
| **Configuração Global de Gateway** (`/planos`) | Padrão para signup e novos clientes | Gateway ativo (Asaas), Token Asaas, Vencimento da 1ª cobrança (dias, 0 = hoje), Exigir pagamento antes do acesso |
| **Webhooks de Pagamento** (`/planos`) | Recebe status dos gateways | Por gateway: URL do webhook + segredo. Asaas = token `asaas-access-token` (botão Gerar); Stripe = signing secret; Pagar.me = basic auth; Mercado Pago = x-signature |
| **Gateway por tenant** (`/planos` e Editar Tenant) | Sobrescreve o global por cliente | Gateway, Token Asaas, **Customer ID Asaas** (`cus_…`), migrar para gateway global |
| **Editar Tenant › Cobrança** | Regras de inadimplência | Trial habilitado + duração; Alertar (dias antes do vencimento); Tolerância (dias após vencimento, 0 = nunca bloqueia); Mensagem de alerta; Esconder pagamentos de usuários comuns (LGPD) |
| **Pagamentos** (`/pagamentostenants`) | Faturas por cliente | Agrupado por tenant (gateway + nº de pagamentos). Colunas: ID (`pay_…`), Status (`PENDING`, `OVERDUE`…), Vencimento, Valor, Link da fatura |

### Regras de negócio observadas

1. No cadastro (signup) o cliente escolhe um plano e o gateway gera a cobrança.
2. A 1ª fatura vence em N dias (global; vale também na troca de plano). Boleto/Pix são pós-pagos; cobrança imediata só com cartão.
3. Com "exigir pagamento antes do acesso", o cliente nasce bloqueado e é liberado quando o webhook confirma o 1º pagamento.
4. Com gateway configurado, o trial não bloqueia ao terminar: o acesso segue até a 1ª fatura vencer sem pagamento.
5. Inadimplência: aviso N dias antes do vencimento; bloqueio (HTTP 402) N dias após; 0 só marca como atrasado.
6. Alterações no plano valem na hora para todos os clientes nele.

## Modelo de dados inferido (AvanceAI)

Pelos campos das telas, o banco da referência tem estas entidades de cobrança (nomes aproximados):

| Entidade | Campos principais | Relação |
| --- | --- | --- |
| `plans` | id, name, price, connections, users, trial\_enabled, trial\_days, gallery\_mb, public, featured, sort\_order, description, features (json) | 1 plano → N tenants |
| `gateway_settings` (global) | gateway, api\_token, first\_due\_days, require\_payment\_before\_access | única |
| `webhook_secrets` | gateway, url, secret | 1 por gateway |
| `tenants` | id, name, status, plan\_id, max\_users, max\_connections, trial\_\*, gateway, gateway\_token, gateway\_customer\_id, alert\_days\_before, tolerance\_days\_after, alert\_message, hide\_payments\_lgpd | 1 tenant → N pagamentos |
| `tenant_payments` | id, tenant\_id, gateway, gateway\_payment\_id (`pay_…`), status, due\_date, value, invoice\_url | espelho local da fatura do gateway |

O ponto-chave é que a fatura vive no gateway e o sistema guarda só um **espelho** (id, status, valor, vencimento, link), atualizado pelo webhook.

## Adaptação para a sua plataforma

Na sua plataforma, **Plano vira Serviço** e **Tenant vira Cliente**; a cobrança nasce de uma ação sua (não de um signup), podendo juntar vários serviços.

| AvanceAI | Sua plataforma | O que muda |
| --- | --- | --- |
| Plano (preço + limites) | **Serviço** (nome, preço padrão, descrição, ativo) | Sem limites de uso/trial; preço pode ser editado na cobrança |
| Tenant | **Cliente** (nome, CPF/CNPJ, e-mail, celular, endereço) | CPF/CNPJ obrigatório no Asaas para boleto/Pix |
| Customer ID Asaas no tenant | `asaas_customer_id` no cliente | Criado automaticamente no 1º uso |
| Fatura do plano | **Cobrança** com itens (1..N serviços) | Valor = soma dos itens − desconto |
| Cobrança recorrente do plano | Avulsa, **parcelada** ou **recorrente** (assinatura) | Escolha por cobrança |
| Bloqueio de acesso por atraso | **Régua de cobrança** (lembretes antes/depois do vencimento) | Não há acesso a bloquear; vira notificação |
| Config. global de gateway | **Configurações**: token Asaas, ambiente (sandbox/produção), vencimento padrão, multa, juros, desconto | Mesma ideia, mais campos financeiros |
| Webhooks de pagamento | Webhook Asaas com token | Igual (só Asaas) |

### Fluxo principal

1. Você seleciona (ou cadastra) o cliente.
2. Adiciona um ou mais serviços; ajusta quantidade e preço.
3. Define vencimento, forma de pagamento (Pix, boleto, cartão ou "cliente escolhe") e, se quiser, parcelas, desconto, multa e juros.
4. O sistema garante o cliente no Asaas e cria a cobrança.
5. Guarda o id `pay_…`, o link da fatura e o Pix copia-e-cola; envia ao cliente.
6. O webhook atualiza o status (pendente → pago / vencido / estornado).

&#91;embedded content: fluxo de cobrança · ida pela API, volta pelo webhook\]

A linha de cima é síncrona (sua chamada à API); a de baixo é assíncrona e só acontece quando o Asaas avisa pelo webhook.

## Integração com o Asaas

Bastam três chamadas para o fluxo básico (cliente → cobrança → dados de pagamento) e um webhook para o status. Base URL: sandbox `https://api-sandbox.asaas.com/v3`, produção `https://api.asaas.com/v3`; autenticação pelo header `access_token` com a chave da conta ([docs](https://docs.asaas.com/reference/criar-nova-cobranca)).

| Etapa | Endpoint | Campos que você envia / guarda |
| --- | --- | --- |
| Criar cliente | `POST /customers` | name, cpfCnpj, email, mobilePhone, externalReference = id do cliente no seu banco → guarda `id` (`cus_…`) |
| Buscar cliente existente | `GET /customers?cpfCnpj=…` | Evita duplicar cliente no Asaas |
| Criar cobrança avulsa | `POST /payments` | customer, billingType (`PIX`, `BOLETO`, `CREDIT_CARD` ou `UNDEFINED` = cliente escolhe), value, dueDate, description (até 500 caracteres, liste os serviços), externalReference = id da cobrança local, discount, interest, fine → guarda `id` (`pay_…`), `invoiceUrl`, `bankSlipUrl`, `status` |
| Parcelar | `POST /payments` com `installmentCount` + `installmentValue` | Asaas gera N cobranças ligadas a um `installment` |
| Recorrente | `POST /subscriptions` | customer, billingType, value, nextDueDate, cycle (`MONTHLY`, `YEARLY`…) |
| Pix copia-e-cola | `GET /payments/{id}/pixQrCode` | encodedImage (QR) + payload |
| Linha digitável | `GET /payments/{id}/identificationField` | Código do boleto |
| Cancelar | `DELETE /payments/{id}` | Marca cobrança como cancelada |
| Estornar | `POST /payments/{id}/refund` | Total ou parcial |

### Webhook

Cadastre a URL (ex.: `https://suaplataforma.com/api/webhooks/asaas`) no painel do Asaas com um token; o Asaas envia esse token no header `asaas-access-token` e o evento no campo `event` ([eventos](https://docs.asaas.com/docs/webhook-para-cobrancas)). Valide o token, grave o evento bruto, responda 200 rápido e processe de forma **idempotente** (o mesmo evento pode chegar mais de uma vez).

| Evento Asaas | Status na sua plataforma |
| --- | --- |
| `PAYMENT_CREATED` | Pendente |
| `PAYMENT_UPDATED` | Atualiza valor/vencimento |
| `PAYMENT_CONFIRMED` | Confirmado (pago, saldo ainda não disponível — cartão) |
| `PAYMENT_RECEIVED` | Pago |
| `PAYMENT_OVERDUE` | Vencido |
| `PAYMENT_DELETED` / `PAYMENT_RESTORED` | Cancelado / Pendente |
| `PAYMENT_REFUNDED` / `PAYMENT_PARTIALLY_REFUNDED` | Estornado / Estorno parcial |
| `PAYMENT_CHARGEBACK_REQUESTED` | Contestação |
| `PAYMENT_CHECKOUT_VIEWED` | Registra "cliente visualizou" |

Dica: use `externalReference` para ligar evento → cobrança local mesmo se o `pay_…` ainda não estiver salvo.

## Modelo de dados proposto

Seis tabelas cobrem o fluxo; `charges` é o espelho local da cobrança do Asaas, como na AvanceAI.

| Tabela | Campos | Observações |
| --- | --- | --- |
| `customers` | id, name, cpf\_cnpj, email, phone, address (json), asaas\_customer\_id, notes, created\_at | `asaas_customer_id` preenchido na 1ª cobrança |
| `services` | id, name, description, default\_price, active, created\_at | Catálogo (equivale a "Planos") |
| `charges` | id, customer\_id, status, billing\_type, total\_value, discount, due\_date, description, type (avulsa / parcelada / recorrente), asaas\_payment\_id, asaas\_installment\_id, asaas\_subscription\_id, invoice\_url, bank\_slip\_url, pix\_payload, paid\_at, net\_value, created\_by, created\_at | Status: `draft`, `pending`, `confirmed`, `paid`, `overdue`, `canceled`, `refunded` |
| `charge_items` | id, charge\_id, service\_id, description, quantity, unit\_price, total | Preço "congelado" no momento da cobrança |
| `settings` | asaas\_api\_key (criptografada), environment, webhook\_token, default\_due\_days, default\_fine\_pct, default\_interest\_pct, reminder\_days\_before, reminder\_days\_after | Equivale à "Configuração Global de Gateway" |
| `webhook_events` | id, asaas\_event\_id, event, payment\_id, payload (json), processed\_at, error | Log + idempotência (único por `asaas_event_id`) |

Regras: o valor da cobrança = soma de `charge_items.total` − desconto; nunca edite uma cobrança paga — cancele/estorne e gere outra.

## Telas do painel

| Tela | Conteúdo | Inspirada em |
| --- | --- | --- |
| **Dashboard** | A receber, recebido no mês, vencido, próximos vencimentos | — |
| **Clientes** | Lista + busca; ficha com dados, cobranças e total pago/pendente | Tenants |
| **Serviços** | Lista (nome, preço, ativo) + modal Novo Serviço | Planos / Novo Plano |
| **Nova Cobrança** | Cliente → itens (serviço, qtd, preço) → vencimento, forma, parcelas, desconto/multa/juros → resumo → Gerar | Signup + gateway |
| **Cobranças** | Agrupada por cliente ou lista plana; colunas ID Asaas, Status (badge), Vencimento, Valor, Link; ações: copiar Pix, reenviar, cancelar, estornar | Pagamentos dos Tenants |
| **Configurações** | Token Asaas, ambiente, padrões financeiros, régua de lembretes | Config. Global de Gateway |
| **Webhooks** | URL, gerar token, log dos últimos eventos | Webhooks de Pagamento |

## Roadmap de implementação

1. **Base**: tabelas, CRUD de Clientes e Serviços, tela de Configurações com token Asaas (sandbox).
2. **Cobrança avulsa**: Nova Cobrança → `POST /customers` + `POST /payments`; salvar link, Pix e boleto.
3. **Webhook**: endpoint com validação do `asaas-access-token`, log em `webhook_events`, atualização de status idempotente.
4. **Lista de Cobranças e Dashboard**: filtros por status/período/cliente, ações cancelar e estornar.
5. **Parcelamento e recorrência**: `installmentCount` e `/subscriptions`.
6. **Régua de cobrança**: lembretes N dias antes/depois (e-mail/WhatsApp) e mensagem personalizada.
7. **Produção**: trocar para chave e URL de produção, testar ponta a ponta com uma cobrança real de baixo valor.

### Pendências para decidir

- [ ] Cada cobrança pode ter vários serviços, ou sempre um serviço por cobrança?
- [ ] Haverá várias contas Asaas (multiempresa, como o token por tenant da AvanceAI) ou uma só?
- [ ] Canal dos lembretes: notificações do próprio Asaas, e-mail ou WhatsApp?
