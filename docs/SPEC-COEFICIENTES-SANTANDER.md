# SPEC — Coeficientes por Fator Price (Santander) e importador de PDF

> Investigação e implementação de 25-26/08/2026. Complementa
> `docs/SPEC-CRM-WESALES-CAMPANHAS.md` (ofertas do CRM AlvoConsig).

## 1. Relação Fator ↔ Coeficiente (validada, exata)

O banco publica um **Fator** (`parcela = valor_solicitado × Fator`). O nosso
`coeficientes.coeficiente` já era usado no sentido inverso
(`valor_liberado = margem × coeficiente`, ver `src/lib/alvoconsig/ofertas.ts`).
Logo: **`coeficiente = 1 / Fator`**.

Validado com dado real (simulação FVE Santander, 26/08/2026, Mesquita, tabela
8104875, prazo 120): Fator do dia = 0,0280385; Valor Solicitado = R$ 11.876,53;
Parcela = R$ 333,00. `11.876,53 × 0,0280385 = 333,00` — exato ao centavo.

## 2. Duas camadas de preenchimento (decisão 26/08/2026)

- **Camada simples (implementada)**: coeficiente = 1/Fator, vinculado a
  Instituição × Convênio × Tabela × Prazo, com vigência. Cobre qualquer banco,
  inclusive os que só publicam o Fator/coeficiente pronto (sem fórmula
  conhecida). Duas formas de preencher, convivendo na mesma tela
  (`/coeficientes`):
  - **Manual** (`createCoeficientes`) — digitação um a um, mantida só para
    caso pontual/teste (inviável como rotina).
  - **Importar PDF de Fatores** (`/api/comissionamento/importar-fatores`,
    `src/lib/comissionamento/importar-fatores-santander.ts`) — sobe o
    "Relatório de Fatores PRICE" do banco, que já cobre várias semanas de uma
    vez (uma linha por dia); grava um `coeficientes` por dia coberto,
    automaticamente. Tela pede Instituição Financeira (define qual parser
    usar — hoje só Santander), Convênio (validado contra o que vem escrito no
    PDF) e Tabela de Comissão (resolvida automaticamente pela "Regra" do PDF
    quando é Santander — a Regra já bate com `codigo_tabela_banco`; para
    outras IFs sem essa correspondência direta, ex. Daycoval, o campo Tabela
    fica habilitado e obrigatório, aguardando o parser próprio).
- **Camada avançada (NÃO implementada, pendência aberta)**: calcular o Fator
  ao vivo a partir de taxa + carência (fórmula abaixo), sem depender de
  reimportar PDF. Ver §3 — tem um gap não resolvido, não implementar até
  fechar isso.

## 3. Fórmula Price + carência — validada, com gap não resolvido

```
FatorPuro(i, n) = i / (1 - (1+i)^-n)
Fator(i, n, carência_dias) = FatorPuro(i, n) × (1 + i)^(carência_dias / 30)
```

A progressão dia-a-dia e o salto mensal no `Fator` publicado batem
perfeitamente com essa fórmula (confirmado prazo a prazo, Mesquita e Salto,
Novo e Refin, dados ao vivo do FVE + PDFs reais). O problema é **achar a
carência_dias sozinhos, sem depender do PDF**:

- Regra de fechamento/pagamento testada: `DT_FECHAMENTO`/`DT_PAGAMENTO` por
  convênio (mês de referência = mês atual; se dia ≤ fechamento, paga no mês
  seguinte; senão empurra mais um mês). Essa regra **acerta exatamente** a
  data "Vencimento da 1ª parcela" mostrada na tela de simulação do Santander
  (testado Mesquita e Salto, hoje 26/08/2026).
- Só que, invertendo o `Fator` REAL publicado no PDF pra descobrir a
  carência que o banco de fato usou, o número não bate com essa data — dá
  uma carência bem maior (semanas a mais) do que a diferença entre hoje e a
  "1ª parcela" mostrada na tela. Ou seja: **a fórmula do Fator está certa, a
  regra de fechamento/pagamento pra achar a data está certa (bate com a
  tela), mas as duas juntas não reproduzem o Fator publicado** — falta uma
  peça no meio.
- Hipótese do Bruno (não verificada): o banco pode contar o prazo a partir do
  1º vencimento pra frente, sem contabilizar o tempo de contratação até lá
  como carência da forma que estamos supondo — a especular checar depois.
- **Enquanto isso não fechar, não implementar cálculo automático pro
  Santander** — o erro estimado é de ~7-10% no valor liberado, não é
  arredondamento.

**Investigação adicional (26/08/2026, enquanto o Bruno estava fora):**
- A **taxa de variação diária** do Fator publicado (mesma regra/prazo, dias
  consecutivos, antes do salto mensal) bate quase exato com
  `(1+i)^(-1/30)` — diferença de 0,007%, dentro do arredondamento do PDF (7
  casas). Ou seja, **o mecanismo de composição diária da fórmula está
  correto**; o que está errado é só a **data de referência** usada como
  âncora da carência — não é um problema de fórmula/formato.
- Testei a hipótese do Bruno de forma literal (carência contada a partir do
  1º vencimento, não até ele) e uma variante (carência = prazo total do
  contrato − n×30, usando a data da última parcela real: 10/09/2036) — **nenhuma
  bateu** com a carência implícita real (~131 dias). A do Bruno dá ~45 dias
  (igual à carência simples, não resolve); a variante da última parcela dá
  ~68 dias. Nenhuma fecha os ~131 dias que o Fator publicado realmente usa.
- **Conclusão por ora**: falta descobrir qual é a data/evento real que a
  carência do Santander usa como âncora — não é a "vencimento da 1ª parcela"
  mostrada na tela nem variações simples dela. Precisa de mais dados (um
  relatório de Fatores de uma semana bem diferente, pra ver como o
  deslocamento se comporta) ou confirmação direta com o Santander. Não vale a
  pena continuar só por tentativa e erro sem mais informação.

## 4. Daycoval — primeiras observações (formato de relatório diferente)

- PDF já traz o **"1º Venc" pronto** por linha — não precisa de regra de
  fechamento/pagamento pra esse banco (mais simples que o Santander nesse
  ponto, quando formos atacar a camada avançada).
- "Convênio" no relatório do Daycoval é um código próprio por tabela/tier
  (ex.: 871831 PREFMESQUITA1DIG, 871833 PREFMESQUITA3DIG) sem correspondência
  com `codigo_tabela_banco` nem com `convenios.codigo` — por isso a Tabela de
  Comissão não pode ser resolvida automaticamente feito o Santander; fica
  campo manual na tela de importação.
- "TC: 0,00" e observação "Aplicar Fator sobre Valor Liberado + TC" — parece
  existir um valor adicional (tarifa/custo) somado antes de aplicar o Fator;
  não investigado ainda.
- Parser do Daycoval ainda não implementado (fica pra quando entrar de fato
  no fluxo).

## 5. Aprimoramento futuro anotado (não implementado)

Bruno propôs criar em `/convenios` uma aba "Instituição Financeira ×
Convênio" — cadastro rico (campos padrão + personalizados, reaproveitáveis
entre convênios/IFs) para o roteiro operacional de cada banco (fechamento,
pagamento, tipo de averbação, documentação exigida, etc.), exibível no CRM
como base de conhecimento pro atendente. Boa ideia, mesma direção da tabela
de junção Instituição×Convênio que a fórmula avançada vai precisar — fica
pra depois do essencial estar rodando.
