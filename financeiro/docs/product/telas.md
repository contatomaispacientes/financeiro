# Telas

Referência visual: protótipo navegável feito no claude.ai ("Painel Financeiro — Protótipo"). As telas abaixo descrevem o mesmo comportamento em texto, para servir de guia de implementação. A tela de **Contratos** não estava no protótipo e foi especificada aqui.

Layout geral: menu lateral escuro (vira barra horizontal no celular) com grupos **Análise**, **Contas a receber**, **Contas a pagar**, **Sistema**; conteúdo com cabeçalho (título, subtítulo, ação principal). Selo do ambiente Asaas (Sandbox/Produção) no rodapé do menu.

| Rota | Tela | Conteúdo principal | Spec |
| --- | --- | --- | --- |
| `/login` | Login | E-mail e senha | 00 |
| `/` | Visão geral | 5 KPIs (recebido no mês, a receber, vencido, contas a pagar, saldo previsto); próximos recebimentos; despesas em aberto (com "Marcar paga"); resultado do mês (realizado × previsto); últimos eventos do webhook | 06 |
| `/fluxo` | Fluxo de caixa | Barras entradas × saídas por mês (previsto do mês atual em tom claro); tabela mês/entradas/saídas/resultado/margem; saídas por categoria; extrato realizado do mês | 06 |
| `/cobrancas/nova` | Nova cobrança | 1) cliente (busca + cadastrar), aviso se ainda não existe no Asaas; 2) serviços do catálogo → itens com qtd e preço editáveis; 3) tipo (avulsa/parcelada/recorrente), parcelas ou ciclo, forma de pagamento, vencimento, desconto, multa, juros. Lateral: resumo e **prévia do payload do Asaas**. Botão "Gerar cobrança no Asaas" ou "Gerar contrato" | 03, 07 |
| `/cobrancas` | Cobranças | Chips por status com contagem, busca por cliente ou `pay_…`, filtro por período; tabela ID Asaas, cliente, serviços, tipo, forma, vencimento, valor, status; rodapé com total | 03 |
| painel lateral | Detalhe da cobrança | Valor, status, tipo, forma, vencimento, pago em, referência, parcelamento/assinatura; itens; link da fatura, Pix copia-e-cola, linha digitável; ações reenviar, cancelar, estornar; eventos recebidos | 03, 04 |
| `/assinaturas` | Recorrências | Lista de assinaturas Asaas, próximo vencimento, ação cancelar | 03 |
| `/contratos` | Contratos | Lista com status (rascunho, enviado, parcialmente assinado, assinado, recusado, expirado, cancelado), cliente, valor do plano, enviado em, assinado em, cobrança gerada | 07 |
| `/contratos/novo` | Novo contrato | Cliente → modelo → plano de cobrança (mesmo formulário da Nova Cobrança) → signatários → prévia das variáveis → enviar | 07 |
| `/contratos/:id` | Detalhe do contrato | Status por signatário, links de assinatura, histórico de eventos, PDF assinado, cobrança gerada (link), ações reenviar/cancelar | 07 |
| `/contratos/modelos` | Modelos de contrato | Nome, modelo do Clicksign (escolhido da lista ou chave digitada), mapeamento variável do modelo → variável do sistema, prévia, ativo | 07 |
| `/clientes` | Clientes | Busca por nome/CPF/CNPJ; tabela com e-mail, documento, celular, ID Asaas, nº de cobranças, pago, em aberto | 01 |
| `/clientes/:id` | Ficha do cliente | Dados, ID Asaas, totais (pago, em aberto, vencido), cobranças, contratos; ação "Nova cobrança para este cliente" | 01 |
| `/servicos` | Serviços | Nome, descrição, preço padrão, nº de usos, ativo/inativo; modal Novo/Editar serviço | 02 |
| `/despesas` | Contas a pagar | KPIs (em aberto, atrasadas, pago no mês, total do mês); chips por status; tabela com categoria, fornecedor, vencimento, valor, status; marcar paga/desfazer; modal Nova despesa com recorrência | 05 |
| `/configuracoes` | Configurações | Status da conta Asaas (ambiente, conexão), padrões (vencimento em dias, multa, juros), régua (dias antes/depois, canais, mensagem), webhook (URL, situação do token), Clicksign (ambiente, token e segredo HMAC configurados, testar conexão) | 00, 04, 07, 08 |
| `/configuracoes/webhooks` | Log de eventos | Eventos recebidos (Asaas e contratos), status de processamento, erro, botão reprocessar | 04 |
| `/configuracoes/usuarios` | Usuários | CRUD e papel | 00 |

## Padrões de interface

- Valores em `R$ 1.234,56`, fonte monoespaçada tabular para números e IDs.
- Datas `dd/mm/aaaa`; listas curtas `dd/mm`.
- Status sempre com **texto + cor** (nunca só cor): Pendente (âmbar), Confirmado (azul), Pago (verde), Vencido (vermelho), Cancelado (cinza), Estornado (roxo).
- Ações destrutivas (cancelar, estornar) pedem confirmação com o valor e o cliente na mensagem.
- Toda tela de lista: estado vazio explicativo, carregando (skeleton) e erro com "tentar de novo".
- Responsivo até 375 px: tabelas com rolagem horizontal, menu vira barra.
