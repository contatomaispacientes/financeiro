# 01 — Clientes · Requisitos

> Status: **Aprovado** · Prefixo: `CLI` · Depende de: 00 · Marco: M1

## Contexto

Cliente é quem paga. Precisa de dados mínimos válidos para o Asaas emitir boleto/Pix (nome + CPF/CNPJ) e para o contrato (endereço, e-mail). O cadastro no Asaas acontece sob demanda na primeira cobrança ou contrato (O1).

## Fora de escopo

- Importação em massa por planilha (v1.1).
- Consulta automática de CNPJ na Receita (v1.1 — opcional).
- Vários contatos por cliente.

## Requisitos

### CLI-01 — Cadastrar cliente

**História:** Como FINANCEIRO, quero cadastrar um cliente PF ou PJ, para poder cobrá-lo e enviar contrato.

- CLI-01.1 — O sistema DEVE exigir nome (2–120 caracteres) e CPF ou CNPJ válido (dígitos verificadores); tipo PF/PJ é derivado do tamanho do documento.
- CLI-01.2 — O sistema DEVE aceitar e-mail, celular com DDD, endereço de cobrança (CEP, logradouro, número, complemento, bairro, cidade, UF) e observações, todos opcionais no cadastro.
- CLI-01.5 — SE o cliente não tiver endereço completo, ENTÃO a ficha e a seleção do Novo Contrato DEVEM avisar que o endereço é obrigatório para contrato (CTR-02.9).
- CLI-01.3 — SE já existir cliente com o mesmo documento (inclusive arquivado), ENTÃO o sistema DEVE recusar com `CUSTOMER_DUPLICATE` e informar qual cliente é.
- CLI-01.4 — O documento DEVE ser guardado só com dígitos e exibido formatado.

### CLI-02 — Listar e buscar

- CLI-02.1 — A lista DEVE permitir busca por nome (parcial, sem acento/maiúscula) ou documento (com ou sem máscara) e paginação.
- CLI-02.2 — Cada linha DEVE mostrar nome, e-mail, documento, celular, ID Asaas (ou "criado na 1ª cobrança"), nº de cobranças, total pago e total em aberto.
- CLI-02.3 — O filtro padrão DEVE ocultar arquivados; DEVE haver opção para mostrá-los.
- CLI-02.4 — ENQUANTO o usuário for LEITURA, o documento DEVE aparecer mascarado.

### CLI-03 — Ficha do cliente

- CLI-03.1 — A ficha DEVE mostrar dados cadastrais, ID Asaas, cliente desde, totais (pago, em aberto, vencido), cobranças (mais recentes primeiro), assinaturas ativas e contratos.
- CLI-03.2 — A ficha DEVE oferecer "Nova cobrança" e "Novo contrato" com o cliente pré-selecionado.

### CLI-04 — Editar e arquivar

- CLI-04.1 — O FINANCEIRO DEVE poder editar os dados do cliente.
- CLI-04.2 — QUANDO um cliente com `asaas_customer_id` for editado em nome, e-mail, celular ou endereço, o sistema DEVE atualizar o cliente no Asaas; SE o Asaas falhar, ENTÃO a edição local DEVE ser mantida e o usuário avisado (`ASAAS_SYNC_PENDING`), com nova tentativa em fila.
- CLI-04.3 — O sistema NÃO DEVE permitir alterar o documento de cliente que já tem cobrança emitida, contrato enviado ou cadastro no Asaas (`asaas_customer_id`) (`CUSTOMER_DOCUMENT_LOCKED`).
- CLI-04.4 — O sistema DEVE permitir arquivar (não excluir) clientes; SE houver cobrança em aberto (`DRAFT`, `PENDING`, `OVERDUE`), assinatura ativa ou contrato em andamento (`SENT`, `PARTIALLY_SIGNED`), ENTÃO DEVE recusar com `CUSTOMER_HAS_OPEN_ITEMS`.
- CLI-04.5 — Cliente arquivado NÃO DEVE aparecer na seleção de Nova Cobrança/Novo Contrato e pode ser desarquivado.

### CLI-05 — Garantir cliente no Asaas

- CLI-05.1 — QUANDO uma cobrança ou contrato precisar do cliente no Asaas e ele não tiver `asaas_customer_id`, o sistema DEVE buscar por CPF/CNPJ no Asaas e reutilizar se existir, ou criar, e gravar o id.
- CLI-05.2 — Duas operações simultâneas para o mesmo cliente NÃO DEVEM criar dois clientes no Asaas.

## Requisitos não funcionais

- CLI-NF1 — Busca responde em < 300 ms com 5 mil clientes (índice em nome com `unaccent`/trigram).
- CLI-NF2 — Criação, edição e arquivamento registrados em auditoria (sem documento completo).

## Perguntas em aberto

- [x] Endereço é obrigatório para algum modelo de contrato? → **Sim, para todo contrato** (endereço de cobrança). Continua opcional no cadastro (cobrança avulsa não exige); é validado ao enviar o contrato (CTR-02.9) e a ficha avisa quando falta (CLI-01.5).

## Changelog

| Data | Mudança |
| --- | --- |
| 07/10/2026 | Versão inicial |
| 07/10/2026 | Revisão: CLI-01.5 (aviso de endereço para contrato), CLI-04.3 trava documento também com cadastro no Asaas/contrato, CLI-04.4 detalha estados em aberto |
