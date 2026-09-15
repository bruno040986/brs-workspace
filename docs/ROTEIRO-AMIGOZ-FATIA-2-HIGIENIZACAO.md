# Roteiro — Amigoz Fatia 2: "Higienização Amigoz" (Gestão de Leads)

> Executor: Sonnet. Autor do roteiro: Fable (14/09/2026). Decisões de produto do Bruno
> (14/09) já fechadas — não reabrir. Dúvida real de arquitetura/segurança → parar e
> perguntar. Worktree: `brs-workspace-portal-parceiro`, branch `portal-parceiro/workspace`.
> Migrations SÓ com timestamp real (`date +%Y%m%d%H%M%S`); aplicar pela main
> (`echo Y | npx supabase db push`) só depois do merge, com autorização do Bruno.

## 0. O que já existe (não reescrever)

- Adaptador Amigoz: `src/lib/if-credito/amigoz/client.ts` — `carregarConfigAmigoz()`,
  `chamarAmigozAutenticado(cfg, operacao, metodo, caminho, body, criadoPor)` (token em
  cache, refaz login em 401, registra tudo em `if_credito_chamadas`),
  `AMIGOZ_AVERBADORAS`, `AMIGOZ_TIPOS_PRODUTO`.
- Config/descoberta: `src/lib/if-credito/amigoz-actions.ts` + card em
  `src/app/(dashboard)/rh/parceiros/config/provedores/if-credito/AmigozCard.tsx`.
- Formato REAL da consulta de margem (`POST /api/consulta-margem`, body
  `{cpf, averbadora, convenio, numero_matricula?, senha_servidor?}`): array de linhas, uma
  por produto×tipo de margem, todas com `nome, nascimento (dd/mm/aaaa), ocupacao, folha,
  verba, numeroMatricula, estavel_bool, idProduto ("15"|"7"), tipoMargem (3|2|1),
  tipoProduto (texto), margem_atual (string "467.50"), cartoes[], emprestimos[]`.
  `emprestimos[]` traz linhas com `idProduto "13"`, `tipoMargem 5`, `margem_atual`
  (consignado/empréstimo). Sem margem: array vazio ou erro da averbadora
  (`{detail: "..."}`, HTTP 4xx/5xx) — ambos são resultado válido a registrar.
- Convênios do Amigoz (`GET /api/cliente/convenios`): 104 itens `{id, nome, averbadora,
  senha_servidor, matricula_obrigatoria, produtos[{codigo_produto, tipo_margem}], ...}`.
  Alguns são "SIMULAÇÃO_…_NÃO DIGITAR" — esconder do seletor.
- Padrões a copiar: lote NVTI (`src/app/api/nvti/upload/route.ts`, `src/lib/nvti/worker.ts`,
  `src/app/api/cron/nvti-batches/route.ts`, tabelas em
  `supabase/migrations/20260820120000_nvti_higienizacao.sql`); sync WeSales
  (`src/lib/nvti/nvti-wesales.ts` → `syncNvtiResultadoParaWesales`); cliente WeSales
  (`src/lib/wesales/client.ts`: `findContactByCpf`, `updateContact`, `ensureCustomField`,
  `customFieldEntry`, `searchContactsAte`, `countContacts`, `createOpportunity`,
  `resolvePipeline`, `resolvePipelineStage`); filtro de público (wizard de Ações Manuais em
  `src/app/(dashboard)/central-integracoes/_components/ActionsClient.tsx`, tipos em
  `central-integracoes/types.ts`: tagsAny/tagsAll/tagsNone + custom field = valor).

## 1. Regras de negócio fixadas

| tipoMargem | idProduto | Nome canônico BRS            | Observação                       |
|-----------:|----------:|------------------------------|----------------------------------|
| 3          | 15        | Cartão Consignado — margem única |                              |
| 2          | 7         | Cartão Benefício — saque (70%)   | Bruno: 70% da margem vira saque |
| 1          | 7         | Cartão Benefício — compra (30%)  | Bruno: 30% vira limite do cartão|
| 5          | 13        | Empréstimo consignado (aninhado) | vem em `emprestimos[]`          |

- "Tem oportunidade" = qualquer `margem_atual > 0` nas linhas acima.
- Ritmo da API: **1 consulta por vez, sem paralelismo**, pausa mínima configurável
  (padrão 1500 ms) entre consultas; a API leva 1–7 s e às vezes 30 s. Respeitar
  `AbortSignal.timeout(60_000)` que o adaptador já usa. Em 401 o adaptador refaz login.
  Em 5xx/erro de rede: retentar 1 vez após 10 s; depois marcar item como `erro`.
- O Amigoz não tem homologação: TODA consulta é real. Não consultar CPF inválido (validar DV).
- Mapeamento de convênio: nosso `convenios` NÃO tem id externo por IF. Criar tabela
  `if_convenio_mapeamento` (ver §2) ligando `convenios.id` ↔ `amigoz_convenio_id` +
  `averbadora` + `exige_matricula` + `exige_senha_servidor`. Tela do lote escolhe o convênio
  BRS; sem mapeamento, o modo exige escolher o convênio do Amigoz manualmente e oferece
  "salvar vínculo".

## 2. Schema (1 migration, timestamp real)

```sql
-- mapeamento convênio BRS ↔ convênio na IF (genérico por IF, começa pelo Amigoz)
create table if not exists public.if_convenio_mapeamento (
  id uuid primary key default gen_random_uuid(),
  instituicao_financeira_id uuid not null references public.financial_institutions(id),
  convenio_id uuid not null references public.convenios(id),
  convenio_externo_id text not null,        -- id no Amigoz (ex.: "25")
  convenio_externo_nome text,
  averbadora_externa integer,               -- código da averbadora no Amigoz
  exige_matricula boolean not null default false,
  exige_senha_servidor boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (instituicao_financeira_id, convenio_id)
);

-- lotes de higienização de margem (IF-agnóstico; origem: unitaria | csv | wesales)
create table if not exists public.if_higienizacao_lotes (
  id uuid primary key default gen_random_uuid(),
  instituicao_financeira_id uuid not null references public.financial_institutions(id),
  convenio_id uuid references public.convenios(id),
  convenio_externo_id text not null,
  averbadora_externa integer,
  origem text not null check (origem in ('unitaria','csv','wesales')),
  status text not null default 'pendente' check (status in ('pendente','rodando','pausado','concluido','erro','cancelado')),
  total_itens integer not null default 0,
  itens_processados integer not null default 0,
  itens_com_margem integer not null default 0,
  itens_erro integer not null default 0,
  pausa_ms integer not null default 1500,
  filtro_wesales jsonb,                     -- origem='wesales': filtros usados
  arquivo_nome text,
  worker_lock_until timestamptz, worker_lock_by text,
  criado_por uuid references public.users(id),
  created_at timestamptz not null default now(),
  iniciado_em timestamptz, concluido_em timestamptz
);
create table if not exists public.if_higienizacao_itens (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references public.if_higienizacao_lotes(id) on delete cascade,
  ordem integer not null,
  cpf text not null,
  nome text, telefone text, matricula text, senha_servidor_enc text,   -- entrada (CSV/WeSales)
  wesales_contact_id text,
  status text not null default 'pendente' check (status in ('pendente','processando','ok','sem_margem','erro')),
  tentativas integer not null default 0,
  erro text,
  -- resultado normalizado (pra planilha/WeSales sem reparsear o bruto)
  nome_if text, nascimento_if date, ocupacao text, matricula_if text, estavel boolean,
  margem_consignado numeric(12,2), margem_beneficio_saque numeric(12,2),
  margem_beneficio_compra numeric(12,2), margem_emprestimo numeric(12,2),
  tem_oportunidade boolean,
  resposta_bruta jsonb,
  consultado_em timestamptz,
  nvti_enviado_em timestamptz, wesales_atualizado_em timestamptz
);
create index if not exists idx_if_hig_itens_lote_status on public.if_higienizacao_itens (lote_id, status, ordem);
create unique index if not exists uq_if_hig_itens_lote_cpf on public.if_higienizacao_itens (lote_id, cpf);
alter table public.if_convenio_mapeamento enable row level security;
alter table public.if_higienizacao_lotes enable row level security;
alter table public.if_higienizacao_itens enable row level security;
```

Permissão NOVA `alvoconsig-higienizacao-amigoz` (REGRA FIXA dos 4 pontos): (1)
`SYSTEM_MODULES` em `usuarios/page.tsx` sob `cat-div-comercial`, filho de
`alvoconsig-gestao`; (2) `divisoes.ts` → child de "Gestão de Leads": `{ label:
'Higienização Amigoz', href: '/gestao-leads/higienizacao-amigoz' }`; (3)
`permissions.ts` → rota `/gestao-leads/higienizacao-amigoz`; (4) seed na mesma migration
(cross join a partir de `sistema-usuarios-root`, igual à 20260905102132 L200-214).
Card novo na hub `gestao-leads/page.tsx`.

## 3. Lib (`src/lib/if-credito/amigoz/`)

- `margem.ts`: `consultarMargemAmigoz({cpf, convenioExternoId, averbadora, matricula?,
  senhaServidor?}, criadoPor)` → chama `chamarAmigozAutenticado(cfg, 'consulta-margem',
  'POST', '/api/consulta-margem', body)`; `normalizarMargem(resposta)` → objeto com os 4
  valores da tabela do §1 + nome/nascimento/ocupação/matrícula/estável + `temOportunidade`.
  Testes unitários com o JSON real gravado em `if_credito_chamadas` (copiar pra fixture,
  anonimizando CPF/nome).
- `convenios.ts`: `listarConveniosAmigoz()` (cache 1 h em memória do processo; esconde
  "NÃO DIGITAR"), `salvarMapeamentoConvenio(...)`, `obterMapeamento(convenioId)`.
- `lote.ts`: `criarLote(...)`, `adicionarItens(loteId, itens[])` (chunks de 1000, dedupe por
  CPF, valida DV), `runHigienizacaoWorker(workerId, budgetMs)` (lock igual ao NVTI; pega o
  lote `rodando` mais antigo, processa itens `pendente` em série com a pausa; atualiza
  contadores; fecha o lote quando não sobra pendente), `kickHigienizacaoWorker()`.
- Cron: `src/app/api/cron/if-higienizacao/route.ts` (mesmo padrão de `nvti-batches`:
  Bearer `CRON_SECRET`, fail-closed, `maxDuration 60`). Adicionar no `vercel.json` a cada
  minuto **só se** já houver lote `rodando` (a rota sai cedo quando não há — custo zero).
- `saidas.ts`:
  - `gerarPlanilhaLote(loteId)` → XLSX (SheetJS, já é dependência) com colunas: CPF, Nome
    (entrada), Nome (IF), Nascimento, Matrícula, Ocupação, Estável, Margem Consignado,
    Margem Benefício Saque, Margem Benefício Compra, Margem Empréstimo, Tem oportunidade,
    Status, Erro, Consultado em.
  - `enviarParaNvti(loteId)` → só itens `tem_oportunidade = true` e `nvti_enviado_em is
    null`; reaproveita o lote NVTI (`nvti_batches`) criando um batch com esses CPFs e
    `gravarConvenioDoLoteSeVazio`; carimba `nvti_enviado_em`. NVTI é quem cadastra no
    WeSales (já faz hoje via `syncNvtiResultadoParaWesales`).
  - `atualizarWesales(loteId)` → só itens com `wesales_contact_id` OU contato achado por
    `findContactByCpf`; grava custom fields (criar chaves via `ensureCustomField` seguindo a
    regra: **código nunca cria campo — usar as chaves que o Bruno criar**; até lá, pedir
    as chaves: sugestão `amigoz_margem_consignado`, `amigoz_margem_beneficio_saque`,
    `amigoz_margem_beneficio_compra`, `amigoz_margem_emprestimo`, `amigoz_consultado_em`,
    `amigoz_matricula`) e cria 1 oportunidade por item com oportunidade no pipeline
    "AC-Oferta" (resolver com `resolvePipeline`/`resolvePipelineStage`; se não existir
    estágio combinado, parar e perguntar). Idempotente: não duplicar oportunidade aberta
    do mesmo contato+produto (usar `findOpportunitiesByContact`).

## 4. Telas (`src/app/(dashboard)/gestao-leads/higienizacao-amigoz/`)

`page.tsx` com 3 abas (client component `HigienizacaoAmigozClient.tsx`):

1. **Consulta unitária** — convênio BRS (select) → mostra convênio Amigoz mapeado (ou
   seletor manual + "salvar vínculo"), CPF, matrícula (se `exige_matricula`), senha do
   servidor (se `exige_senha_servidor`, campo password, nunca persistido em claro).
   Resultado: tabela igual à do Amigoz (Matrícula · Tipo de cartão · Tipo de margem ·
   Margem · Vínculo) + linha do empréstimo + botões "Atualizar no WeSales" e "Enviar à
   NVTI". Cada consulta unitária também vira um lote `origem='unitaria'` com 1 item (mesma
   trilha, mesmas saídas).
2. **Upload CSV/XLSX** — modelo para download (colunas: cpf, nome, telefone, matricula,
   senha_servidor); upload → pré-visualização (total, inválidos, duplicados) → escolher
   convênio + pausa → "Iniciar lote". Progresso por polling leve (a cada 5 s, só enquanto
   `rodando`; parar quando concluir — sem Realtime aqui, sem poll fora da tela). Ao
   concluir: **Baixar planilha** · **Higienizar na NVTI (só com oportunidade)** ·
   **Atualizar WeSales**. Pausar/retomar/cancelar.
3. **Selecionar no WeSales** — mesmos filtros do wizard de Ações Manuais (tags any/all/none
   + custom field = valor; convênio entra pelo custom field do convênio já usado lá) →
   `countContacts` → "Gerar lote" (`searchContactsAte` com limite configurável, máx.
   5.000 por lote) → mesma tela de progresso e saídas da aba 2 (aqui "Atualizar WeSales"
   já tem `wesales_contact_id`, sem busca por CPF).

Lista de lotes anteriores (data, origem, convênio, totais, status) com acesso às saídas.

## 5. Fora de escopo desta fatia

Criar cliente/contrato no Amigoz, simulação de ofertas, Painel de Operações, Portal
Parceiro (lá é só consulta unitária multi-IF, fatia própria). Nada de webhook (Amigoz não
tem). Não tocar no card de config nem no adaptador além de adicionar funções.

## 6. Verificação

- `npx eslint` nos arquivos novos + `npx tsc --noEmit`; build local.
- Teste real: lote CSV com 3 CPFs (o do Piauí + 2 inválidos/desconhecidos) → 1 ok, 2 erro/
  sem margem; planilha baixada com as 4 margens; "Atualizar WeSales" só depois das chaves
  de campo existirem.
- Varredura de caracteres cirílicos/gregos nos arquivos editados (rotina desta sessão).
