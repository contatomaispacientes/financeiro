# ADR-016 — Asaas simulado (`ASAAS_ENV=mock`)

**Status:** Aceito · 08/10/2026

## Contexto
O dono quer usar e demonstrar o sistema inteiro (criar cobrança, pagar, vencer, estornar, recorrência) sem conta no Asaas e sem túnel para webhook. O sandbox exige chave, cadastro e túnel; os testes automatizados usam `nock`, que não serve para uso manual.

## Decisão
- Terceiro valor em `ASAAS_ENV`: `mock`. O `AsaasModule` entrega `MockAsaasClient` no lugar do `HttpAsaasClient` (mesma interface `AsaasClient`); nenhum código de domínio sabe a diferença. `ASAAS_API_KEY` passa a ser dispensável só nesse modo.
- Estado do simulador em `<STORAGE_LOCAL_DIR>/asaas-mock.json` (clientes, cobranças, parcelamentos, assinaturas, estornos), para sobreviver a reinícios. Não usa banco nem Redis: é ferramenta de teste, não de produção.
- Toda mudança que o Asaas avisaria por webhook (pagamento, vencimento, remoção, estorno, nova cobrança de assinatura) vira um evento no formato do webhook real, gravado pelo mesmo `WebhookInbox` (`source = ASAAS`, id `evt_mock_…`) e processado pela mesma fila. Assim o caminho testado é o de produção.
- Simulações: `POST /asaas-mock/charges/:id/simulate` (`RECEIVE` | `OVERDUE`, papéis de `MANAGE_CHARGES`), botões "Simular pagamento/vencimento" no detalhe da cobrança, e uma fatura de mentira em `GET /asaas-mock/fatura/:id` (o `invoiceUrl` aponta para ela) com o botão "Simular pagamento". Fora de `mock` essas rotas respondem 404.
- Taxas fictícias para o líquido (Pix R$ 0,99; boleto R$ 1,99; cartão 2,99% + R$ 0,49). QR Code e linha digitável são de mentira.
- Assinaturas: cria a cobrança do ciclo atual na criação e a do próximo ciclo quando a anterior é paga.
- Selo "Asaas Simulado" no topo, como o de sandbox.

## Consequências
- Dá para testar o produto de ponta a ponta localmente ou na VPS sem nenhuma conta externa.
- Pode rodar com `NODE_ENV=production` (ex.: demonstração na VPS). O selo deixa claro que nada é cobrado; para cobrar de verdade troque para `production` seguindo o checklist do `docs/deploy.md`.
- O simulador não reproduz tudo do Asaas (chargeback, regras de cartão, notificações). Validação final continua no sandbox.
