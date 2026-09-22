# Fixtures dos leitores de PDF de Fatores

PDFs REAIS dos bancos usados pelos testes de regressão em
`../__tests__/importar-fatores.test.ts` (lição do fix ef488d9: validar só contra
texto extraído não pega o layout real). Sem os arquivos, os testes de fixture são
PULADOS (os sintéticos rodam sempre).

| Arquivo | Origem | O que cobre |
|---|---|---|
| `santander-lista-mesquita-8104875.pdf` | Santander, Mesquita, Regra 8104875 (25/08 a 14/09/2026) | Faixa em lista `12;24;...;120`, 1 bloco, 1 página |
| `santander-intervalo-sjc-860021522.pdf` | Santander, São José dos Campos, Regra 860021522 (03/09 a 23/09/2026) | Faixa em intervalo `3-144`, 7 páginas paginadas por colunas (prazos 17–96) |
| `daycoval-sjc-731701.pdf` | Daycoval, PREF SJ CAMPOS, 14 tabelas (09/09 a 09/10/2026) | Uma tabela por página, colunas vazias, só dias úteis, TC 0,00 |
