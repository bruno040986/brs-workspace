# Roteiro — Amigoz Fatia 3: ofertas disponíveis → Oportunidade no WeSales

> Executor: Sonnet. Autor: Fable (15/09/2026). Decisões abaixo já fechadas com o Bruno —
> não reabrir. Dúvida real de arquitetura/segurança → parar e perguntar. Worktree
> `brs-workspace-portal-parceiro`, branch `portal-parceiro/workspace`. Migration só com
> timestamp real; aplicar/publicar só com autorização do Bruno.
> Contexto: docs/ROTEIRO-AMIGOZ-FATIA-2-HIGIENIZACAO.md (tudo de lá continua valendo).

## 0. Descoberta OBRIGATÓRIA antes de codar (o Bruno roda, o Sonnet lê)

No card Amigoz (Configurações › Provedores › APIs de IFs de Crédito › Descoberta), com o
CPF real do Piauí já usado (convênio 25, averbadora 1):

1. `criar-cliente` — payload do modelo, preenchendo nome/telefone/data_nascimento
   (dd/mm/aaaa)/escolaridade/convenio_id=25/tipo_produto=7/tipo_margem=1/margem=70.12/
   margem_saque=163.62/numero_matricula=2448726. Anotar: (a) o id que volta
   (`id_cliente_cartao` ou equivalente), (b) o código de escolaridade aceito (a doc diz
   `integer`; na tela deles é "Ensino Superior" etc. — testar 1..5 se rejeitar).
2. `simulacao-cartao` com `id_cliente_cartao` = id do passo 1, uma vez para o benefício
   (tipo_produto 7, tipo_margem 1, margem 70.12, margem_saque 163.62) e uma vez para o
   consignado (tipo_produto 15, tipo_margem 3, margem 467.50, margem_saque 0).
3. Se o cliente já tiver cartão (AOS002 sumir e vier "possui cartão"), rodar também
   `simulacao-saque-v2`.

O Sonnet copia as respostas de `if_credito_chamadas` (anonimizando CPF/nome) para
fixtures em `src/lib/if-credito/amigoz/__fixtures__/` e fixa o formato de
`OfertaNormalizada` a partir delas. Referência do que a tela deles mostra (é o alvo):
limite pré-aprovado, saque (valor, nº parcelas, valor da parcela), taxa a.m./a.a., CET
a.m./a.a., IOF, total financiado, 1º vencimento, seguros opcionais (Diamante/Super
Diamante) e tarifa de emissão.

## 1. Modelo canônico (IF-agnóstico)

```ts
// src/lib/if-credito/ofertas.ts (novo, genérico — NADA de Amigoz aqui)
export type ProdutoOferta = 'cartao_rmc' | 'cartao_rcc' | 'saque_complementar' | 'novo' | 'refin'
export type OfertaNormalizada = {
  produto: ProdutoOferta
  instituicaoId: string          // financial_institutions.id
  instituicaoNome: string
  limitePreAprovado: number | null
  valorSaque: number | null
  numParcelas: number | null
  valorParcela: number | null
  taxaMes: number | null         // %
  cetMes: number | null          // %
  primeiroVencimento: string | null // AAAA-MM-DD
  tabelaCodigo: string | null    // identidade da oferta na IF (idempotência); Amigoz: id do produto ("223 Cartão Consignado" → "223")
  bruto: unknown                 // resposta da IF, auditoria
}
```

Regra: `valorSaque` é o "troco" da oferta (o que o cliente recebe) — é o
`monetaryValue` da Oportunidade, igual ao REFIN.

## 2. Schema (1 migration, timestamp real)

```sql
alter table public.if_higienizacao_lotes
  add column if not exists buscar_ofertas boolean not null default false;

alter table public.if_higienizacao_itens
  add column if not exists cliente_externo_id text,          -- id do cliente na IF (Amigoz: id_cliente_cartao)
  add column if not exists ofertas jsonb,                    -- OfertaNormalizada[] (com `bruto` dentro)
  add column if not exists ofertas_status text check (ofertas_status in ('pendente','ok','sem_oferta','erro')),
  add column if not exists ofertas_erro text,
  add column if not exists ofertas_consultadas_em timestamptz,
  add column if not exists wesales_ofertas_em timestamptz;   -- carimbo de "virou Oportunidade"
```

Sem tabela nova: a oferta mora no item enquanto é lote; a versão "oficial" é a
Oportunidade no WeSales (o inventário, como o REFIN). Nada de permissão nova.

## 3. Adaptador Amigoz (`src/lib/if-credito/amigoz/ofertas.ts`)

- `garantirClienteAmigoz(cfg, item, lote)` → se `cliente_externo_id` vazio: `POST /api/cliente`
  com cpf, nome_cliente (nome_if ou nome de entrada), telefone (item.telefone → se vazio,
  telefone do contato WeSales via `findContactByCpf`; se ainda vazio, `ofertas_status='erro'`
  "sem telefone" e NÃO cria), data_nascimento (nascimento_if, já em dd/mm/aaaa),
  escolaridade (constante `ESCOLARIDADE_PADRAO` fixada na descoberta), convenio_id
  (variante usada: `convenio_externo_usado`), tipo_produto/tipo_margem/margem/margem_saque
  do produto com margem, numero_matricula (matricula_if). Grava `cliente_externo_id`.
  Erro de "cliente já existe" (descobrir o código) → tratar como sucesso se vier o id.
- `simularOfertasAmigoz(cfg, item)` → uma `simulacao-cartao` por produto com margem > 0
  (RCC: tipo_produto 7, tipo_margem 1, margem = compra, margem_saque = saque; RMC:
  tipo_produto 15, tipo_margem 3, margem = consignado). Cada resposta → `OfertaNormalizada`
  via `normalizarOfertaAmigoz(produto, bruto)` (fixtures da descoberta). Sem oferta ou erro
  da IF em um produto não derruba o outro.
- Pausa entre chamadas = `pausa_ms` do lote (mesma regra da margem). 401 já é tratado pelo
  adaptador.

## 4. Worker (`lote.ts`) — extensão, não reescrita

Depois de gravar a margem de um item, **se** `lote.buscar_ofertas` **e**
`tem_oportunidade`: `garantirClienteAmigoz` → `simularOfertasAmigoz` → grava `ofertas`,
`ofertas_status`, `ofertas_consultadas_em`. Item sem margem: `ofertas_status = null`
(não tenta). Contador novo no lote: `itens_com_oferta`. Tudo no mesmo loop serial.
Ação avulsa `buscarOfertasDoLote(loteId)` para lote já concluído sem a flag: reabre só
os itens `ok` com `ofertas_status is null` (status do lote volta a `pendente`, o worker
pula a margem de quem já tem `consultado_em`).

## 5. Saída: ofertas → Oportunidades no WeSales (`saidas.ts`)

`enviarOfertasParaWesales(loteId)` — só itens com `ofertas_status='ok'` e
`wesales_ofertas_em is null`, contato achado por `wesales_contact_id`/`findContactByCpf`
(nunca cria contato — quem cria é a NVTI, como na fatia 2). Reaproveitar TAL QUAL o
bloco REFIN de `src/app/api/alvoconsig/upload/route.ts` (linhas ~447-540):
`resolverPipelineOfertas()`, `ensureCustomField` dos `OFERTA_FIELD_KEYS` (modelo
'opportunity'), `findOpportunitiesByContactDetalhadas` para idempotência por
`tipoOferta + instituicaoId + tabelaCodigo` (atualiza valor/campos sem mexer na etapa;
cria só oferta inédita), `nomeOportunidade(produto, 'Amigoz', tabela)`,
`monetaryValue = valorSaque`, campos parcela/prazo/taxa/instituicao(id+nome)/tabelaCodigo/
seguro quando houver. Carimba `wesales_ofertas_em`. Best-effort por item.
Botão na tela: "Enviar ofertas ao WeSales" (habilitado quando `itens_com_oferta > 0`).

## 6. Campanha do AlvoConsig lê as ofertas do inventário (pequeno, mas essencial)

Hoje `src/app/api/alvoconsig/campanhas/route.ts` lê do pipeline "Ofertas de Crédito" só
`tipoOferta='refin'` e CALCULA Novo/Cartão por coeficiente. Estender `resolverOfertasRefin`
(ou função irmã) para também trazer Oportunidades `cartao_rmc`/`cartao_rcc`/
`saque_complementar` do inventário como linhas de `crm_ofertas` (`produto` já aceita
esses valores; `dados.origem = 'inventario_if'`, `instituicao_id/nome` da Oportunidade,
`valor_liberado = monetaryValue`). Sem duplicar com a calculada por coeficiente: se
existir oferta de inventário do mesmo produto+instituição, ela vence a calculada.
Isso é o que faz a oferta do Amigoz aparecer no CRM.

## 7. Telas

- `LoteProgress`: checkbox "Buscar ofertas após a margem" na criação (CSV, WeSales e
  unitária); coluna "Ofertas" na tabela de itens; botão "Enviar ofertas ao WeSales".
- Detalhe do item (expansível): cartões de oferta no estilo da tela do Amigoz — Limite
  pré-aprovado, Saque em Nx de R$ Y, taxa/CET a.m., 1º vencimento; um card por produto.
- Unitária: depois da margem, botão "Buscar ofertas" que roda cliente + simulação na hora
  e mostra os cards.

## 8. Fora de escopo

Digitar contrato (`POST /contratos`), seguros, documentos, link de formalização — Fatia 4.
Portal Parceiro — fatia própria.

## 9. Verificação

Lint/tsc/build; fixtures com teste unitário de `normalizarOfertaAmigoz`; teste real: lote
CSV com o CPF do Piauí e `buscar_ofertas` ligado → 2 ofertas (RMC e RCC) → "Enviar
ofertas ao WeSales" → 2 Oportunidades em "Ofertas de Crédito" › Disponível → rodar de
novo não duplica.
