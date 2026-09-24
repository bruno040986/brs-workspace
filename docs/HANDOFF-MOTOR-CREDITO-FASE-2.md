# HANDOFF — API Kaizom (ex-"Motor de Crédito (MySQL)"), Fase 2

> Escrito em 10/09/2026 para abrir uma sessão nova só deste assunto.
> A sessão anterior segue com a Base de Conhecimento de Convênios.

## 1. O que é

O fornecedor de higienização de **margem de convênios públicos** grava o
resultado das consultas numa tabela MySQL dele (`bancobrs`.`consultas`). Hoje a
margem entra no Workspace por **planilha Excel** (Gestão de Leads › Importação,
tipo "margem"). A Fase 2 cria **mais uma forma de importar** — lendo direto do
banco do fornecedor. **Não substitui a importação por Excel** (decisão do Bruno).

## 2. O que já existe (Fase 1 — em produção desde 08/09)

- Credencial + conexão testadas e funcionando: card **Provedores › Motor de
  Crédito (MySQL)** (`/rh/parceiros/config/provedores/motor-credito`),
  permissão `sistema-config-motor-credito`.
- Tabela `motor_credito_mysql_config` (linha única `id=1`): host, porta, banco,
  tabela, usuario, `senha_enc` (cofre AES), **`cursor_coluna`, `cursor_valor`**
  (já previstos para a leitura incremental), `ativo`. Migration
  `20260908224209_motor_credito_mysql_config.sql`.
- `src/lib/motor-credito/mysql-client.ts` — `abrirConexao()` (mysql2, conexão
  por chamada, `connectTimeout` 8s), `testarConexaoMotorCredito`,
  `descreverTabelaMotorCredito` (DESCRIBE), `amostrarLinhasMotorCredito`,
  `identificadorSeguro()` (regex antes de interpolar nome de tabela/coluna).
- `src/lib/motor-credito/config-actions.ts` — actions do card.
- Rede: o fornecedor libera **qualquer IP** (a Vercel não tem IP fixo). Usuário
  `integracaobrs` deve ser **só SELECT** em `consultas` (lado deles).

## 3. O fato novo (10/09) — a tabela tem dado real

`consultas` passou de 0 para **10 linhas**. Schema:

| coluna | tipo | obs |
|---|---|---|
| `id` | bigint unsigned PK | começa alto (ex.: 1486881) — sequência de um sistema maior; serve de **cursor** |
| `tarefa_id` | bigint, index | ex.: 2158 — **semântica ainda desconhecida** |
| `cpf_consultado` | varchar(11) | só dígitos |
| `matricula` | varchar(255) | |
| `nome` | varchar(255) | **veio NULL** na amostra — o nome está em `dados_extras.nome` |
| `valor_margem` | decimal(10,2) | ex.: 8157.88 |
| `valor_disponivel` | decimal(10,2) | ex.: 7862.71 |
| `observacao` | text | ex.: "Consulta realizada com sucesso." |
| `consultado_em` | timestamp | |
| `dados_extras` | json | tem `cpf` formatado, `nome`, e mais chaves (o print cortou) |
| `sucesso` | tinyint(1) | |
| `created_at` / `updated_at` | timestamp | |

### 3.1 Estrutura de `dados_extras` (5 linhas reais analisadas em 10/09)

```
dados_extras
├─ cpf            "000.000.000-00" (formatado)
├─ nome           nome completo  ← usar este (a coluna `nome` vem NULL)
├─ identificacao  = matrícula
├─ cargo          código (ex. "05770")
├─ orgao          ex. "SEFAZ"            (igual em todas as linhas do lote)
├─ lotacao        ex. "20 - SECRETARIA DA FAZENDA E PLANEJAMENTO" (varia por pessoa)
├─ vinculo        ex. "7 - Efetivo"
├─ admissao       "dd/mm/aaaa"
├─ mes_referencia "mm/aaaa"   (ex. "12/2025")
├─ prox_folha     "dd/mm/aaaa"
├─ fim_contrato   "" ou null
├─ margem_bruta       { "<PRODUTO>": { valor_str: "1165,41", valor_float: 1165.41 }, ... }
├─ margem_disponivel  { mesmo formato }
└─ exportador     cópia "achatada" dos mesmos dados (cpf_cliente, nome_cliente,
                  margem_bruta_cartao_de_credito, margem_disponivel_consignacoes_facultativas…)
                  ⚠ NÃO traz o Cartão de Benefício — usar os mapas acima, não o exportador.
```

Produtos que aparecem nos mapas de margem, e a correspondência com os campos
de margem que a importação Excel já grava no WeSales:

| chave no JSON | produto | campo WeSales (`MARGEM_FIELD_KEYS`) |
|---|---|---|
| `CONSIGNACOES FACULTATIVAS` | Empréstimo Novo | `novoValor` / `novoData` |
| `CARTAO DE CREDITO` | Cartão Consignado (RMC) | `rmcValor` / `rmcData` |
| `CARTÃO DE BENEFÍCIO` | Cartão Benefício (RCC) | `rccValor` / `rccData` |

- As colunas de topo `valor_margem` / `valor_disponivel` são só a
  **Consignações Facultativas** (bruta / disponível) repetida — não servem para cartão.
- Valor a gravar = **`margem_disponivel[...].valor_float`** (número; nunca o
  `valor_str`, que tem vírgula). Guardar a bruta também na staging, para a revisão.
- Chaves têm acento e espaço (`"CARTÃO DE BENEFÍCIO"`): comparar normalizando
  (sem acento, maiúsculas), porque o fornecedor pode variar a grafia.
- `created_at` e `updated_at` vieram **NULL** → leitura incremental só pelo `id`.
- Datas vêm em `dd/mm/aaaa` → converter para `AAAA-MM-DD` antes do WeSales.

## 4. Desenho da Fase 2 (já combinado com o Bruno)

```
cron (Vercel) ──lê por cursor id──▶ tabela de STAGING no Workspace
                                       │
                         tela de REVISÃO em Gestão de Leads
                         (humano confere e aprova/rejeita, com botão)
                                       │ aprovado
                                       ▼
                     WeSales — mesma lógica de margem da importação Excel
```

Nunca direto ao WeSales: sempre passa pela revisão humana.

**Reuso obrigatório:** a gravação no WeSales da importação Excel está em
`src/app/api/alvoconsig/upload/route.ts` (bloco `tipo === 'margem'`, ~linhas
200–430): uma "foto" de margem por CPF; campos de contato `MARGEM_FIELD_KEYS`
(`novoValor/novoData`, `rmcValor/rmcData`, `rccValor/rccData`) — valor
MONETORY vai como **número**, data como **AAAA-MM-DD**; `gravarContato()`
(CPF, matrícula **nunca sobrescreve** a existente, Convênio Código/Nome);
tags `base:` + `disponivel`; Consignante via `resolverOuCriarConsignante`;
rastreio em `crm_imports`. Campos/parsers em `src/lib/alvoconsig/import.ts`
(`CAMPOS_IMPORT`, `parseMoney`, `normalizeCpfCell`). **Extrair esse núcleo para
uma função compartilhada** e usar nos dois caminhos — não duplicar.

## 5. Perguntas — respondidas pela Kaizom em 11/09/2026

**Resolvidas pela amostra:**
- ~~Chaves de `dados_extras`~~ → §3.1.
- ~~`valor_margem` × `valor_disponivel`; tem cartão?~~ → os três produtos vêm
  nos mapas `margem_bruta`/`margem_disponivel` (§3.1); grava-se a disponível.
- ~~Linha atualizada depois~~ → `created_at`/`updated_at` vêm NULL; cursor só por `id`.

**Resolvidas pela Kaizom (11/09):**
1. ~~De qual convênio é cada linha?~~ → **O convênio é único por `tarefa_id`**
   (é o que a Kaizom usa pra determinar a averbadora do lado deles) — mas essa
   informação está na **tarefa**, não na `consulta` que já é espelhada.
   Confirma o caminho (c) do desenho original: um lote (`tarefa_id`) é sempre
   de um convênio só, nunca misto. **Duas formas de obter o valor, a Kaizom
   topa as duas:**
   (a) ela adiciona uma coluna `convenio` direto em `consultas` (disse que é
       fácil — só não tinha feito porque o valor se repete a cada linha do
       lote); ou
   (b) espelhar a tabela de **tarefas** também (dela lê-se o convênio por
       `tarefa_id`, um SELECT/join extra).
   **Falta decidir qual caminho pedir** — (a) é mais simples pro nosso lado
   (sem join, sem tabela nova espelhada) e é a que a Kaizom ofereceu de bate-
   pronto; (b) evita repetição de dado mas exige espelhar mais uma tabela.
   Decisão de quem for desenhar a staging (arquitetura — Fable/Opus).
2. ~~`tarefa_id`~~ → confirmado: é o identificador único que aparece no
   **higienizador**, ao clicar em "visualizar detalhes da tarefa". É o
   lote/lista mesmo, como já se suspeitava pela amostra (5 linhas do mesmo
   2158, mesmo segundo).
3. ~~Linhas com `sucesso = 0`~~ → confirmado: em caso de falha, `sucesso = 0`
   e o **motivo da falha aparece em `observacao`**. Decisão de UX ainda em
   aberto (mostrar na tela de revisão como falha vs. descartar), mas
   mecanicamente o dado já vem pronto pra exibir o motivo.
4. `created_at`/`updated_at` vazios → a **Kaizom** respondeu "se não me
   engano esses campos ficam vazios mesmo" (resposta com ressalva, não
   garantia) — reforça o que a amostra já mostrou (§3.1): cursor só por `id`,
   nunca por `updated_at`.

**Decisões internas** (data da margem, cron, caminho (a) vs (b)) → fechadas
na §7, revisão Fable de 11/09.

**Ganchos com a Base de Conhecimento de Convênios** (não bloqueiam a Fase 2,
mas vale deixar a staging guardando esses campos):
- `vinculo` ("7 - Efetivo") conversa com o cadastro **Públicos Atendidos**.
- `lotacao` (secretaria) conversa com **Órgãos / Empregadores** — se uma IF
  tiver restrição de órgão naquele convênio, dá pra avisar na revisão.

## 6. Regras do Workspace que valem aqui

- **Uma worktree por sessão**: `git worktree add ../brs-workspace-motor-credito -b motor-credito/fase-2 main`
  (depois `npm install` real — Turbopack recusa `node_modules` em symlink — e
  `cp ../brs-workspace/.env.local .`). Pasta principal fica em `main`, só pra
  merge/push/`db push`. `git checkout` e `rm -rf` são bloqueados pelas permissões.
- **Migrations**: timestamp real (`date +%Y%m%d%H%M%S`), só da pasta principal,
  `npx supabase migration list` antes do `echo Y | npx supabase db push`.
  RLS ligada sem policy; tudo via server action + admin client.
- **Menu/permissão nova → REGRA FIXA nos 4 pontos**: `SYSTEM_MODULES` em
  `usuarios/page.tsx`, `src/lib/nav/divisoes.ts`, `src/lib/auth/permissions.ts`
  (exato + prefixo) e seed na migration a partir de `sistema-usuarios-root`.
- **Cofre só funciona em produção**: `CRM_CREDENTIALS_KEY` é "Sensitive" na
  Vercel, o `vercel env pull` grava `"[SENSITIVE]"` no `.env.local`. Tudo que
  decifra a senha do MySQL tem que ser testado em produção, não em localhost.
- **Dado pessoal**: a tabela tem CPF e nome reais — não colar amostras em
  commits, docs ou logs.
- Modelos: arquitetura/migration/segurança = Fable (ou Opus enquanto a cota do
  Fable estiver esgotada); telas sobre padrão definido = Sonnet.

## 7. Decisões fechadas (revisão Fable, 11/09/2026)

Conferido contra o código antes de decidir: `upload/route.ts` (bloco margem
l.394–446, `gravarContato` l.351, `maxDuration 300`, `LIMITE_LINHAS_API 2000`,
`CONCORRENCIA 5`), `crm_imports` (check de `tipo` já aceita `'margem'`),
`convenios` (`codigo` ARW opcional, `codigo_sistema` sequencial — é o que vai
pro WeSales —, `averbadora_id` desde 09/09), cron padrão `CRON_SECRET`
fail-closed (`api/cron/convenio-pesquisas`), `cursor_coluna`/`cursor_valor`
já na config.

**D1 — Convênio: caminho (a), coluna na `consultas`.** Pedir à Kaizom
(Bruno) que grave em `consultas` o **identificador estável do convênio + o
nome** (ex.: `convenio_id` inteiro deles e `convenio` texto, exatamente como
aparece no higienizador). Se só derem uma, que seja o nome. **Não** espelhar a
tabela de tarefas agora — (b) fica como evolução só se precisarmos de
metadados do lote (nome da lista, quantidade, data). **Enquanto a coluna não
existe, nada trava:** o leitor faz `SELECT *` e grava `convenio_externo =
row.convenio ?? null`; a revisão pede a escolha do convênio **por lote
(`tarefa_id`)** — o caminho (c), que a Kaizom confirmou ser seguro — com a
opção "lembrar este vínculo".

**D2 — De-para Kaizom → Workspace:** coluna nova `convenios.codigo_motor_credito
text null` (unique parcial `where deleted_at is null`), editável no formulário
do Convênio ao lado do Código ARW. O leitor casa `convenio_externo` com ela
(normalizado: trim, maiúsculas, sem acento) e preenche `convenio_id` na
staging; sem casamento, `convenio_id` fica nulo e **aprovar exige escolher o
convênio** (o "lembrar" grava o de-para na coluna). Reusa o cadastro
existente, sem tabela de categorização nova.

**D3 — Data da margem no WeSales = data de `consultado_em`** (fuso
America/Sao_Paulo, `AAAA-MM-DD`): é a data da "foto", mesmo significado do
"hoje" do Excel. `mes_referencia` (competência) fica só na staging/revisão.

**D4 — `sucesso = 0` entra na staging com `status = 'falha'`**, aparece na
revisão com `observacao` (motivo), não é aprovável e nunca vai pro WeSales.
Não descartar em silêncio: o operador precisa ver que o CPF foi consultado e
falhou.

**D5 — Cron `*/5 * * * *`, `maxDuration 60`, até 500 linhas por execução**
(`WHERE id > cursor ORDER BY id ASC LIMIT 500`, via `identificadorSeguro()`).
Lease de 4 min na própria `motor_credito_mysql_config` (`lease_ate`,
`lease_por`) contra execução dupla — mesmo padrão de `convenio-pesquisas`.
Insert com `on conflict (mysql_id) do nothing`; **cursor só avança depois do
insert bem-sucedido** → reler é sempre seguro.

**D6 — Staging `motor_credito_consultas`, estado por LINHA (não por lote —
um lote pode chegar em duas leituras).** Colunas: `id uuid`, `mysql_id bigint
unique`, `tarefa_id bigint`, `cpf text` (11 dígitos), `nome`, `matricula`,
`convenio_externo text null`, `convenio_id uuid null → convenios`, `orgao`,
`lotacao`, `vinculo`, `cargo`, `admissao date null`, `mes_referencia text`,
`prox_folha date null`, `margem_novo_bruta/_disp`, `margem_rmc_bruta/_disp`,
`margem_rcc_bruta/_disp numeric(12,2) null`, `valor_margem`,
`valor_disponivel`, `sucesso bool`, `observacao`, `consultado_em timestamptz`,
`dados_extras jsonb` (bruto, auditoria), `status text check
(pendente|aprovada|rejeitada|falha|enviando|enviada|erro_envio)`,
`revisado_por`, `revisado_em`, `crm_import_id uuid null → crm_imports`,
`erro_envio`, `wesales_contact_id text null`, `created_at`. Índices em
`status`, `tarefa_id`, `cpf`. RLS ligada sem policy (só admin client).
`orgao/lotacao/vinculo` ficam guardados pros ganchos da Base de Conhecimento.

**D7 — Aprovação → WeSales in-request, sem motor de jobs.** Rota
`POST /api/motor-credito/enviar` (`maxDuration 300`), seleção de linhas ou
lote inteiro, **máx. 2000 por chamada** (mesmo teto do Excel). Marca `enviando`
antes, `enviada`/`erro_envio` por linha — timeout no meio é retomável
reenviando o que ficou. 1 `crm_imports` por envio (`tipo='margem'`,
`arquivo_nome = 'Motor de Crédito — tarefa {tarefa_id}'`, `convenio_id`),
rastreio igual ao do Excel. `scp-engine`/`enqueueJob` só se um dia o volume
estourar os 300 s.

**D8 — Núcleo compartilhado (o passo de maior risco).** Extrair de
`upload/route.ts` a função `gravarFotoMargemWesales()` em
`src/lib/alvoconsig/margem-wesales.ts`: entrada neutra `{ convenio, linhas:
[{ cpf, nome?, telefone?, matricula?, margens: { novo?, rmc?, rcc? }, data }],
baseTagSlug }`, saída `{ importadas, erros, contactIds }`. Dentro: ensure dos
custom fields, `resolverOuCriarConsignante`, 1 foto por CPF, matrícula nunca
sobrescreve, tags `base:`+`disponivel`, `comConcorrenciaLimitada(5)`. O bloco
`tipo === 'margem'` do Excel passa a chamá-la, comportamento idêntico.
**Commit separado, revertível sozinho, e regressão REAL: uma importação Excel
de margem em produção antes do merge.**

**D9 — Permissão nova `alvoconsig-motor-credito`** (submenu "Motor de
Crédito" em Gestão de Leads; `view` = ver staging, `can_include` =
aprovar/rejeitar/enviar). REGRA FIXA nos 4 pontos, seed a partir de
`sistema-usuarios-root`. Quem empurra margem pro WeSales é papel mais restrito
do que quem vê Gestão de Leads.

**D10 — Card Provedores › Motor de Crédito** ganha: cursor atual, última
leitura (quando/quantas linhas), botão "Ler agora" (mesma função do cron) e
"Reposicionar cursor" (só root, com confirmação — seguro pelo D5).

Fica pra depois (não bloqueia): expurgo da staging no mesmo prazo do
`alvoconsig-expurgo`; espelhar tarefas (b) se precisar de metadados do lote.

## 7.1 Estado em 24/09/2026 (retomada)

- Card renomeado **"API Kaizom"** (main `1cb629c`).
- Kaizom entregou a coluna `consultas.convenio` (**só o nome**, ex.
  "GOVERNO SP" — sem id). D2 fica: `convenios.codigo_motor_credito` guarda
  esse nome NORMALIZADO (trim/maiúsculas/sem acento); o leitor casa por ele.
- **Etapa 1 FEITA** na worktree `brs-workspace-motor-credito` (branch
  `motor-credito/fase-2`, 3 commits): migration `20260924113756`, REGRA FIXA
  (4 pontos), `tipos.ts`, `parser.ts` (+ teste anonimizado), `leitor.ts`,
  cron `/api/cron/motor-credito` (*/5), actions do card (Ler agora /
  Reposicionar cursor), D8 (`src/lib/alvoconsig/margem-wesales.ts`, commit
  isolado `0fda85e`), `staging-actions.ts`, `POST /api/motor-credito/enviar`.
  O parser (Etapa 2.1) já foi escrito junto porque o leitor depende dele.
- **Ressalva a conferir na Etapa 3:** `consultado_em` é lido como texto e
  assumido em horário de Brasília (`parser.ts` › `consultadoEmParaIso`);
  comparar 1 linha real com "detalhes da tarefa" no higienizador.
- **Etapas 2 e 3 FEITAS (24/09, tarde):** tela `/alvoconsig/motor-credito`,
  campo "Código na API Kaizom" no Convênio, card de sincronização (Sonnet);
  revisão + `next build` + merge na main (`6ec7efd`) + `db push` (Fable).
  **Primeira leitura do cron em produção OK** (17:15 UTC): 10 linhas do lote
  2158, `convenio_externo = "GOVERNO SP"`, todas `pendente` e sem convênio
  casado (de-para ainda vazio — esperado), cursor `1486890`, lease solto.
  `consultado_em` gravado como 17:26:53 -03:00 (hipótese Brasília) — **falta
  Bruno comparar com o higienizador**.
- **Falta (Bruno, na tela):** definir o convênio do lote 2158 com "lembrar"
  → aprovar 1 CPF → Enviar ao WeSales → conferir o contato (campos Novo/RMC/
  RCC Margem + Data, tag `base:margem-...`, Convênio Código/Nome) → só então
  liberar pro operacional. E a regressão do D8: 1 import Excel de margem.

## 8. Roteiro de execução — quem faz o quê

Uma sessão, uma worktree (`motor-credito/fase-2`, receita na §6); a troca de
modelo é por `/model` dentro dela. Ordem obrigatória: Opus fixa schema e
tipos ANTES do Sonnet abrir tela.

**Etapa 0 — Bruno (agora, fora do código):** mandar à Kaizom o pedido do D1
(coluna `convenio` em `consultas`: id estável + nome). Não bloqueia nada.

**Etapa 1 — Opus (arquitetura/migration/segurança):**
1. Migration (timestamp real): `motor_credito_consultas` (D6),
   `convenios.codigo_motor_credito` (D2), `lease_ate`/`lease_por` na config
   (D5), permissão `alvoconsig-motor-credito` com seed (D9) + os outros 3
   pontos da REGRA FIXA (`SYSTEM_MODULES`, `divisoes.ts`, `permissions.ts`).
2. Tipo `LinhaConsultaNormalizada` em `src/lib/motor-credito/tipos.ts` —
   contrato que o parser do Sonnet vai cumprir.
3. `src/lib/motor-credito/leitor.ts`: lease, SELECT por cursor, casamento
   D2, insert idempotente, avanço do cursor (D5). Cron
   `/api/cron/motor-credito` + entrada no `vercel.json`.
4. D8 — extração do núcleo + refatoração do bloco margem do Excel, commit
   isolado.
5. Rota `POST /api/motor-credito/enviar` (D7) e actions de
   aprovar/rejeitar/escolher convênio por lote (com "lembrar").

**Etapa 2 — Sonnet (execução sobre padrão definido), depois da Etapa 1:**
1. `src/lib/motor-credito/parser.ts`: `dados_extras` → `LinhaConsultaNormalizada`
   (§3.1: chaves normalizadas sem acento, `valor_float`, `dd/mm/aaaa` → date,
   D3/D4) + testes unitários com fixtures **anonimizadas** (§6, dado pessoal).
2. Tela `/alvoconsig/motor-credito`: lista por lote (`tarefa_id`, contadores
   por status, convênio casado/pendente, filtro), detalhe com linhas
   (badge de falha + motivo, seleção múltipla, aprovar/rejeitar/enviar,
   escolha do convênio por lote com "lembrar"). Padrão visual de
   `alvoconsig/importacoes`.
3. Campo "Código no Motor de Crédito" no formulário de Convênio (D2).
4. Card Provedores (D10).

**Etapa 3 — Opus:** revisão final do Sonnet; merge na main; `npx supabase
migration list` → `echo Y | npx supabase db push`; deploy; teste em produção
(cofre só decifra em prod, §6): "Ler agora" → revisar → enviar **1 CPF** →
conferir no WeSales → só então liberar pro operacional.
