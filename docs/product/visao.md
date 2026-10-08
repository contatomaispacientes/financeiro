# Visão do produto

> Status: **Aprovado** · Dono: Gabriel · Última revisão: 07/10/2026

## Problema

A empresa cobra clientes por serviços (avulsos, parcelados e mensais) e hoje controla entradas, saídas, contratos e inadimplência de forma espalhada. Falta um lugar único que:

- gere a cobrança no Asaas a partir do cliente e dos serviços vendidos;
- formalize a venda com contrato assinado eletronicamente **antes** de cobrar;
- acompanhe sozinho o status (pago, vencido, estornado) sem conferência manual;
- registre as despesas e mostre o resultado do mês e o fluxo de caixa.

## Objetivos

| # | Objetivo | Como medimos |
| --- | --- | --- |
| O1 | Emitir uma cobrança (Pix, boleto, cartão ou "cliente escolhe") em menos de 1 minuto a partir do cadastro do cliente | Tempo do clique em "Nova cobrança" até o link da fatura |
| O2 | Status de 100% das cobranças atualizado automaticamente | Nenhuma cobrança com status divergente do Asaas após a reconciliação diária |
| O3 | Toda venda com contrato assinado; a cobrança nasce da assinatura | % de cobranças com `origin = CONTRACT` para clientes novos |
| O4 | Visão clara de entradas, saídas e saldo previsto do mês | Dashboard e fluxo de caixa batendo com o extrato do Asaas + despesas pagas |
| O5 | Reduzir inadimplência com lembretes automáticos | Valor vencido sobre faturado, mês a mês |

## Usuários

| Papel | Quem | Pode |
| --- | --- | --- |
| `ADMIN` | Dono da empresa | Tudo, inclusive configurações, usuários e estornos |
| `FINANCEIRO` | Quem opera o dia a dia | Clientes, serviços, cobranças, contratos, despesas; sem configurações e sem estorno |
| `LEITURA` | Contador, sócio | Só visualizar dashboard, relatórios e listas |

O cliente final **não acessa** a plataforma: recebe link da fatura (Asaas) e convite de assinatura (Clicksign).

## Escopo (v1)

1. **Clientes** — cadastro PF/PJ, ficha com histórico, vínculo com o cliente no Asaas criado sob demanda.
2. **Serviços** — catálogo com preço padrão; preço ajustável em cada cobrança/contrato.
3. **Cobranças** — avulsa, parcelada (2–12×) e recorrente (assinatura Asaas); vários serviços por cobrança; desconto, multa e juros; Pix copia-e-cola, boleto e link da fatura; cancelar, estornar, reenviar.
4. **Webhook Asaas** — atualização de status idempotente, log e reprocessamento; reconciliação diária.
5. **Contratos** — modelos com variáveis, envio para assinatura via **Clicksign (API v3)**, acompanhamento por webhook, **cobrança gerada automaticamente quando todos assinam**, cópia do PDF assinado.
6. **Contas a pagar** — despesas com categoria e fornecedor, recorrência mensal, marcar como paga.
7. **Dashboard e fluxo de caixa** — recebido, a receber, vencido, a pagar, saldo previsto; entradas × saídas por mês; despesas por categoria; extrato.
8. **Régua de cobrança** — lembretes antes/depois do vencimento por notificação do Asaas e e-mail; WhatsApp na v1.1.
9. **Configurações e acesso** — usuários e papéis, padrões financeiros, status das integrações, log de webhooks, auditoria.

## Fora de escopo (v1)

- Multiempresa / várias contas Asaas (há **uma** conta Asaas).
- Portal do cliente com login.
- Emissão de nota fiscal (o Asaas tem NFS-e; avaliar na v2).
- Conciliação bancária de outros bancos e importação de OFX.
- Split de pagamento, antecipação, transferências e Pix de saída pelo Asaas.
- Geração local de PDF do contrato (v1 usa modelos do próprio provedor — ADR-005).
- App mobile nativo (o web é responsivo).

## Glossário

| Termo | Significado |
| --- | --- |
| Cliente | Quem paga. Espelhado no Asaas como `customer` (`cus_…`). |
| Serviço | Item do catálogo vendido. Equivale ao "Plano" da AvanceAI, sem limites de uso. |
| Plano de cobrança (`ChargePlan`) | Estrutura com itens, tipo, forma de pagamento, vencimento, parcelas/ciclo, desconto, multa e juros. Usada pela Nova Cobrança e guardada no contrato. |
| Cobrança | Espelho local de um `payment` do Asaas (`pay_…`). |
| Parcelamento | Grupo de cobranças ligadas a um `installment` do Asaas. |
| Assinatura (recorrência) | `subscription` do Asaas (`sub_…`) que gera uma cobrança por ciclo. Não confundir com assinatura de contrato. |
| Contrato | Documento enviado ao Clicksign para assinatura eletrônica (1 contrato = 1 envelope); contém o plano de cobrança. |
| Signatário | Pessoa que assina o contrato: o cliente e o representante da empresa (sem testemunhas na v1). |
| Régua de cobrança | Sequência de lembretes antes e depois do vencimento. |
| Despesa | Conta a pagar da empresa. |

## Princípios

1. O Asaas é a fonte da verdade do dinheiro recebido; o sistema espelha e explica.
2. Toda automação deixa rastro (evento, log, auditoria) e pode ser reprocessada.
3. Nada que já foi pago é editado: cancela/estorna e gera outro.
4. Começar em sandbox, com provedores falsos nos testes, e só então produção.

## Pendências de produto

- [x] Provedor de assinatura eletrônica → **Clicksign** (ADR-009). Confirmar se o plano inclui automação com modelos via API.
- [ ] Canal de e-mail transacional (SMTP próprio, Resend, SES…).
- [ ] WhatsApp (API oficial via BSP ou provedor não oficial) — v1.1.
- [ ] Hospedagem de produção (VPS com Docker, Railway, Render, Fly…).
