---
name: spec-novo
description: Cria ou reescreve o requirements.md de um módulo em docs/specs, entrevistando o usuário e escrevendo critérios de aceite em EARS com IDs.
argument-hint: <NN-modulo> (ex.: 09-notas-fiscais)
arguments: [modulo]
disable-model-invocation: true
---

Você vai escrever `docs/specs/$modulo/requirements.md`.

1. Leia `CLAUDE.md`, `docs/product/visao.md`, `docs/specs/README.md`, `docs/architecture/data-model.md` e `docs/specs/_templates/requirements.md`. Se a pasta do módulo já existir, leia o que houver nela.
2. Se o módulo não estiver no índice, proponha número, nome e prefixo de 3 letras ainda não usado.
3. Entreviste o usuário em rodadas curtas (no máximo 5 perguntas por rodada) até entender: objetivo (qual O1–O5 da visão atende), quem usa, fluxos principais, regras, erros, o que está fora de escopo e dependências. Não invente regra de negócio: o que não souber vira "Pergunta em aberto".
4. Escreva o arquivo seguindo o template:
   - histórias no formato "Como <papel>, quero <capacidade>, para <benefício>";
   - critérios EARS ("QUANDO…, o sistema DEVE…", "SE…, ENTÃO…") com IDs `<PFX>-NN.M`, testáveis e sem detalhe de implementação;
   - códigos de erro estáveis em MAIÚSCULAS quando houver recusa;
   - requisitos não funcionais com números.
5. Status `Em revisão`; linha no Changelog com a data de hoje.
6. Atualize a linha do módulo em `docs/specs/README.md` (crie se for novo) e, se mudou o escopo do produto, aponte o que deveria mudar em `visao.md` (não altere sem confirmação).
7. Termine listando as perguntas em aberto e peça a aprovação do usuário. Só marque `Aprovado` quando ele aprovar explicitamente.
