# SPEC — Convênio como Base de Conhecimento (dossiê para o agente de IA)

> Fechada com o Bruno em 09–10/09/2026. Origem: repos da Alicia
> (`prime-cred-admin` / `prime-cred-db-local`, clonados como referência em
> `PROJETOS/SITES/referencia-alicia/`) — deles aproveitamos o **modelo de
> domínio** e o desenho das telas; código, enums e RLS foram descartados.
> Esta spec é a fonte da verdade: migrations e roteiros por fase saem dela
> sem reabrir o desenho.

## 0. Objetivo e princípios

- **Convênio vira dossiê.** Cada convênio passa a ter o mesmo peso de
  cadastro que Agente Corban e Instituições Financeiras: um repositório
  completo do que o agente de IA (WhatsApp, CRM AlvoConsig; depois
  CLT/NuAzul e Portal) precisa saber para atender aquele público.
- **Básico ≠ conhecimento.** O que existe hoje em Convênios continua sendo a
  única parte obrigatória ("Dados Básicos"). Toda a base de conhecimento é
  opcional, evolui devagar e nunca bloqueia salvar.
- **Nada de lista no código.** Esferas, Tipos, Formas de Contrato e
  Instituições Financeiras já existem e são completos — tudo é FK. As únicas
  listas novas viram **cadastros** (Públicos Atendidos, Órgãos/Empregadores,
  Regionalismo, Feriados).
- **IA sugere, humano aprova.** Conteúdo gerado pelo Jarvis (resumos, FAQ)
  entra como rascunho com origem marcada; só vira ativo depois de revisado.
- **Padrão do Workspace.** Server actions + admin client, RLS ligada sem
  policy, permissões pela REGRA FIXA, soft delete, `trigger_set_timestamp()`,
  migrations com timestamp real só da pasta principal.

## 1. Glossário

| Termo | Significado |
|---|---|
| Dados Básicos | O convênio como existe hoje (nome, CNPJ, tipo→esfera, cidade/UF/CEP, averbadora, site averbador, autenticação, códigos) |
| Base de Conhecimento (BC) | Tudo o que é novo: público, formas & margens, instituições, órgãos/restrições, documentos, FAQ |
| Público Atendido | Categoria de pessoa elegível ao consignado (Aposentado, Efetivo, Comissionado…) — cadastro global |
| Órgão / Empregador | "Sub-convênio" de exceção (Embrapa dentro do SIAPE; empresa X dentro do CLT). Só se cadastra o que aparece em restrição |
| Vínculo Convênio×IF | A IF opera este convênio — com roteiro, público e canais próprios |
| Forma operada | Dentro do vínculo, uma forma de contrato com margem/prazo/público próprios |
| FAQ geral | FAQ criada na entidade (IF, Forma, Averbadora); só vale para um convênio quando importada |
| FAQ do convênio | FAQ criada no convênio, com contexto opcional (esta IF / forma / averbadora) — a exceção |
| Regionalismo | Identidade cultural por UF e por cidade (gírias, referências, feriados) — do **cliente**, não do convênio |
| Dossiê | O documento consolidado que o agente consome (`convenio_conhecimento`) |

## 2. Modelo de dados

Convenções: `uuid pk default gen_random_uuid()`, `created_at/updated_at`
(trigger), `is_active boolean default true` onde faz sentido, `deleted_at`
para soft delete só nos cadastros de apoio (filhos de convênio são hard
delete pela UI, sempre dentro da transação do pai). Tudo em `public`, RLS
enabled sem policy. Os nomes abaixo são definitivos.

### 2.1 `convenios` (alterações — todas NULL)

| coluna | tipo | obs |
|---|---|---|
| `endereco` | text | opcional, ViaCEP sugere |
| `numero_servidores` | integer | |
| `max_comprometimento_salarial` | numeric(5,2) | teto % da margem total |
| `prazo_minimo_geral` / `prazo_maximo_geral` | integer | meses; check min ≤ max |
| `abrangencia` | text check in (`municipal`,`estadual`,`nacional`) | default derivado da esfera do tipo (Municipal→municipal, Estadual→estadual, demais→nacional); editável |
| `bc_observacoes` | text | notas livres da base de conhecimento |

### 2.2 `publicos_atendidos` (cadastro global, submenu Convênios › Públicos Atendidos)

`nome` (unique lower/trim, ativo), `situacao_funcional` text, `regime_juridico`
text, `tipo_provimento` text, `descricao` text, `is_active`, `deleted_at`.
Os três campos classificatórios são texto livre com **datalist** dos valores
já usados (promovíveis a cadastro depois). Seed inicial: Efetivo, Comissionado,
Temporário, CLT, Aposentado, Pensionista (classificação em branco — Bruno
preenche).

### 2.3 `convenio_publicos` — público elegível do convênio (o que o decreto permite)

`convenio_id` FK, `publico_id` FK `publicos_atendidos`, `observacao` text.
Unique (convenio_id, publico_id).

### 2.4 `convenio_formas_contrato` — formas permitidas + margem destinada

`convenio_id`, `forma_contrato_id` FK `formas_contrato`, `percentual_margem`
numeric(5,2) NULL (>0 quando informado), `observacao`. Unique por par.
Regra R1: soma de `percentual_margem` ≤ `max_comprometimento_salarial`
(quando ambos informados).

### 2.5 `convenio_instituicoes` — vínculo Convênio×IF

`convenio_id`, `financial_institution_id` FK `financial_institutions`,
`canais_quitacao text[]`, `modo_orgaos` text check in (`exceto`,`somente`)
default `exceto`, `observacao`, `is_active`. Unique por par.
O roteiro operacional é um **documento** (2.9) com `tipo='roteiro'` e
`convenio_instituicao_id` apontando aqui.

### 2.6 `convenio_instituicao_publicos` — público que a IF atende neste convênio

`convenio_instituicao_id`, `publico_id`. Regra R2: subconjunto de
`convenio_publicos` do mesmo convênio. Vazio = atende todos os públicos do
convênio (a UI mostra isso explicitamente).

### 2.7 `convenio_instituicao_formas` — forma operada pela IF neste convênio

`convenio_instituicao_id`, `forma_contrato_id`, `margem_considerada`
numeric(5,2) NULL, `prazo_minimo`/`prazo_maximo` integer NULL,
`publicos_restritos uuid[]` NULL (ids de `publicos_atendidos`; NULL = herda
2.6), `observacao`. Unique por par.
Regras: R3 forma ∈ `convenio_formas_contrato` do convênio; R4
`margem_considerada` ≤ `percentual_margem` da forma no convênio (quando
ambos informados); R5 prazos dentro do intervalo geral (quando informados);
R6 `publicos_restritos` ⊆ público do vínculo (ou do convênio, se vínculo
vazio).

### 2.8 `orgaos_empregadores` (cadastro, submenu Convênios › Órgãos / Empregadores) + `convenio_instituicao_orgaos`

`orgaos_empregadores`: `convenio_id` FK (pai: SIAPE, CLT…), `nome`, `cnpj`
text NULL (14 dígitos), `observacao`, `is_active`, `deleted_at`. Unique
(convenio_id, lower(trim(nome))).
`convenio_instituicao_orgaos`: `convenio_instituicao_id`, `orgao_id`. A
semântica vem de `modo_orgaos` do vínculo: `exceto` = "a IF NÃO atende
estes"; `somente` = "a IF atende APENAS estes". O agente só pergunta o órgão
do cliente quando o convênio tem pelo menos uma restrição cadastrada.

### 2.9 `convenio_documentos` — decretos, roteiros e outros

| coluna | obs |
|---|---|
| `convenio_id` | FK |
| `tipo` | check in (`decreto`,`roteiro`,`outro`) |
| `convenio_instituicao_id` | FK NULL — obrigatório quando `tipo='roteiro'` |
| `titulo` | obrigatório |
| `texto` | integral colado (NULL se só link/arquivo) |
| `url` | link externo (normalizado por `normalizarUrl`) |
| `arquivo_path`, `arquivo_nome`, `arquivo_mime`, `arquivo_tamanho` | Storage, bucket privado `convenio-documentos` (path `convenios/<convenio_id>/<doc_id>/<nome>`) |
| `texto_extraido` | resultado da extração (PDF/link) — cache para a IA |
| `resumo_ia` | resumo gerado |
| `ia_status` | check in (`nao_lido`,`processando`,`concluido`,`erro`), `ia_erro` text, `ia_modelo` text, `ia_lido_em` timestamptz |
| `ordem` int, `is_active` | |

Pelo menos um de `texto`/`url`/`arquivo_path` é obrigatório.

### 2.10 `faq_itens` — FAQ das duas visões

| coluna | obs |
|---|---|
| `escopo` | check in (`geral`,`convenio`) |
| `convenio_id` | FK; NOT NULL quando `escopo='convenio'`, NULL quando `geral` |
| `entidade_tipo` | check in (`instituicao_financeira`,`forma_contrato`,`averbadora`) NULL. **Geral:** obrigatório (é a dona da FAQ). **Convênio:** opcional (é o contexto da exceção) |
| `entidade_id` | uuid NULL; obrigatório junto com `entidade_tipo` (integridade validada na action — FK polimórfica não é possível) |
| `categoria` | text (datalist com categorias já usadas) |
| `pergunta`, `resposta` | obrigatórios |
| `ordem` int | |
| `origem` | check in (`manual`,`ia`) default `manual` |
| `documento_id` | FK `convenio_documentos` NULL — de qual documento a IA gerou |
| `status` | check in (`rascunho`,`ativo`,`arquivado`) default `ativo` (IA cria como `rascunho`) |
| `created_by`, `updated_by` | FK `users` |

Índices: (escopo, entidade_tipo, entidade_id), (convenio_id).
Check de consistência no banco: `escopo='geral'` ⇒ convenio_id IS NULL AND
entidade_tipo IS NOT NULL; `escopo='convenio'` ⇒ convenio_id IS NOT NULL.

### 2.11 `convenio_faq_vinculos` — FAQ geral importada no convênio

`convenio_id`, `faq_item_id` (FK `faq_itens` com escopo geral),
`created_by`. Unique por par. A UI só oferece FAQs gerais das entidades
ligadas ao convênio (averbadora dele, IFs em 2.5, formas em 2.4), mas o
banco não impede vincular outra.

### 2.12 `regionalismos` (menu Cadastros › Regionalismo) — dois níveis

| coluna | obs |
|---|---|
| `nivel` | check in (`estado`,`cidade`) |
| `uf` | char(2) obrigatório |
| `cidade` | text; NULL quando `nivel='estado'`; unique (uf, lower(trim(cidade))) com deleted_at null; unique parcial (uf) quando nivel='estado' |
| `girias` | jsonb `[ {expressao, significado, uso} ]` |
| `tom_conversa` | text — como falar (ex.: "informal, usa 'tu', chimarrão como referência") |
| `tracos_culturais` | text[] |
| `caracteristicas` | text[] (litoral, serra, capital, universitária, agro…) — cidade |
| `shoppings`, `pontos_turisticos`, `vias_importantes`, `cidades_vizinhas` | text[] — cidade |
| `dados_demograficos`, `observacoes` | text |
| `is_active`, `deleted_at` | |

Teste de aceitação fixado com o Bruno: registro **RS** ("bah", "trilegal",
"já tomou um chimarrão?") e registro **SP** ("que isso mano", "se pá",
"firmeza", "embaçado", "rolê", "trampo").

### 2.13 `feriados` (menu Cadastros › Feriados, 3 abas)

`abrangencia` check in (`nacional`,`estadual`,`municipal`), `uf` (NULL só
nacional), `cidade` (só municipal), `nome`, `dia` int, `mes` int, `ano` int
NULL (NULL = recorrente todo ano), `ponto_facultativo` bool, `observacao`,
`is_active`, `deleted_at`. Check de coerência abrangência×uf×cidade. Seed
com os feriados nacionais fixos.

## 3. Regras de negócio (duas camadas)

Camada 1 — **server action** valida e devolve mensagem amigável (padrão do
Workspace). Camada 2 — **trigger** no banco como rede de segurança (R1, R3,
R4, R5 já cobertos por CHECK/trigger; R2/R6 por trigger). Diferença para o
modelo da Alicia: nada é obrigatório, as regras só disparam quando os dois
lados estão informados, e a alteração do pai (teto, público, formas do
convênio) **revalida os filhos** e devolve a lista do que ficou inconsistente
em vez de bloquear silenciosamente.

Escrita atômica: RPC `convenio_bc_salvar_secao(p_convenio_id, p_secao,
p_payload jsonb)` em plpgsql, uma seção por vez (publicos | formas |
instituicoes | orgaos | documentos-meta | faq), chamada apenas pela action
com admin client (nenhum GRANT a `anon`/`authenticated`). Substitui o
"apaga tudo e recria" global por substituição **por seção**, mantendo ids
das demais.

## 4. Resolução do Regionalismo (para o agente)

```
entrada: convenio_id, cidade_cliente?, uf_cliente?
1. se cidade/uf do cliente conhecidos → regionalismo(cidade) ∪ regionalismo(estado) ∪ feriados(municipal+estadual+nacional)
2. senão, se convenio.abrangencia ∈ {municipal, estadual} → usa cidade/uf DO CONVÊNIO (mesma união)
3. senão (nacional sem cidade) → só feriados nacionais + tom neutro
```
Mesclagem: cidade sobrescreve/complementa estado (gírias somam; tom da
cidade prevalece se existir). Sem vínculo manual convênio↔regionalismo.

## 5. Dossiê — `convenio_conhecimento(p_convenio_id, p_cidade, p_uf)`

Função SQL `STABLE SECURITY DEFINER` (sem GRANT a anon/authenticated;
chamada pelo servidor) que devolve jsonb:

```
{
  convenio: { dados básicos + abrangência + público elegível + teto/prazos + observações },
  averbadora: { nome, site, tipo_autenticacao, vigencia_horas },
  formas: [ { forma, percentual_margem, observacao } ],
  instituicoes: [ { if: {nome, ...}, canais_quitacao, publicos (ou "todos"),
                    modo_orgaos, orgaos: [...],
                    roteiro: { titulo, resumo_ia | texto, url },
                    formas: [ { forma, margem_considerada, prazo_min, prazo_max, publicos_restritos } ] } ],
  decretos: [ { titulo, resumo_ia | texto, url } ],
  faq: [ { pergunta, resposta, categoria, contexto: {tipo, nome} | null, origem: "convenio" | "geral" } ],
  regionalismo: { ...resultado da seção 4 },
  feriados_proximos: [ { nome, data, abrangencia } ],   // próximos 45 dias
  completude: { publico, formas, instituicoes, decretos, faq, regionalismo: bool, score: 0-100 }
}
```
`faq` = FAQ do convênio (status ativo) + FAQ gerais vinculadas (2.11). Cada
item carrega o contexto para o agente distinguir regra do banco X de regra
do convênio. Versão **markdown** (`convenio_conhecimento_md`) gerada na
aplicação a partir do JSON — é o texto que vai para o prompt/embedding.

Endpoint para o agente: `GET /api/conhecimento/convenios/:id?cidade=&uf=`
(+ `GET /api/conhecimento/convenios` lista com completude), Bearer
`CONHECIMENTO_SERVICE_TOKEN` (padrão dos crons/admin API). Consumidor
inicial: CRM AlvoConsig (agente WhatsApp). Embeddings ficam para depois — o
dossiê inteiro cabe no contexto de um modelo atual.

## 6. Jarvis leitor (documentos → resumo + FAQ rascunho)

- `ia_config` ganha `modelo_leitura` (slug OpenRouter; pode ser pago na
  mesma chave) e `modelo_leitura_max_tokens`. Card "IA do Workspace" mostra
  o campo. Se vazio, usa a lista de fallback atual (com aviso de qualidade).
- Pipeline (server action `lerDocumentoComJarvis(documento_id)`):
  1. Texto: `texto` colado > `arquivo_path` (PDF via `pdf-parse`; DOCX via
     `mammoth`; txt/md direto) > `url` (fetch server-side, HTML→texto).
     Resultado cacheado em `texto_extraido`.
  2. Fatiamento por ~12k tokens; resumo por fatia → resumo final.
  3. Geração de FAQ (JSON estrito: categoria/pergunta/resposta), 5–15 itens,
     com instrução de "não inventar valores; se o documento não diz, não
     responde".
  4. Grava `resumo_ia`, `ia_status`, e os itens em `faq_itens` com
     `origem='ia'`, `status='rascunho'`, `documento_id`, escopo `convenio`;
     roteiro → `entidade_tipo='instituicao_financeira'` + id da IF.
  5. UI: painel "Rascunhos da IA" na sub-aba FAQ com aprovar / editar /
     descartar em lote. Nada de rascunho entra no dossiê.
- Sem fila: roda na action com timeout (Vercel 60s+; documento grande →
  processa por fatias em chamadas sucessivas com `ia_status='processando'`).

## 7. Telas

### 7.1 Convênios — subsistema em tela cheia

- `/convenios` — listagem atual + colunas **Abrangência** e **Completude BC**
  (barra/score) + filtro "com/sem base de conhecimento". Botões "Novo" e
  "Editar" levam a página cheia (o modal atual é aposentado).
- `/convenios/novo` — só aba Dados Básicos. **Ao salvar (novo ou edição) volta
  para a listagem `/convenios`** (decisão do Bruno, 10/09 — a listagem é a base;
  a Base de Conhecimento se preenche entrando pelo Editar). Em convênio novo o
  redirect é `replace`, para o "voltar" não cair num formulário já submetido.
- `/convenios/[id]` — layout com sidebar/abas (mesmo padrão de
  `instituicoes-financeiras/[id]`):
  - **Dados Básicos** — exatamente o formulário atual (CNPJ.ws, tipo→esfera,
    averbadora/site/autenticação) + endereço, nº servidores, abrangência.
  - **Base de Conhecimento** — sub-abas:
    1. *Público* — teto/prazos gerais + checklist de `publicos_atendidos`.
    2. *Formas & Margens* — grade formas permitidas (checklist de
       `formas_contrato` ativas) com % de margem; soma × teto ao vivo.
    3. *Instituições* — lista de vínculos; ao abrir um: canais, público
       (checklist só dentro do público do convênio), roteiro (documento com
       texto/link/upload + "Ler com o Jarvis"), **matriz Forma × (margem,
       prazo, público)** só entre as formas permitidas, restrições de
       órgãos (modo + seleção de `orgaos_empregadores` do convênio, com
       "cadastrar novo" inline). Visão geral: **matriz IF × Forma** no topo
       da sub-aba.
    4. *Órgãos / Restrições* — lista de órgãos do convênio e em quais IFs
       aparecem (leitura + atalho para o cadastro).
    5. *Decretos* — documentos tipo decreto (texto/link/upload, resumo IA,
       "Ler com o Jarvis").
    6. *FAQ* — (a) FAQ do convênio com contexto opcional; (b) painel
       "Importar FAQ geral" listando as gerais das entidades ligadas, com
       checkbox por item e "importar todas da IF X"; (c) "Rascunhos da IA".
    7. *Documentos* — documentos tipo `outro`.
    8. *Prévia do dossiê* — renderiza `convenio_conhecimento_md` com um
       seletor de cidade/UF de teste (para ver o regionalismo aplicado).
- Submenus (sidebar Convênios): Esferas, Tipos de Convênio, **Públicos
  Atendidos**, **Órgãos / Empregadores** (lista global com coluna
  convênio-pai + filtro).

### 7.2 Aba FAQ nas entidades

Componente compartilhado `<FaqEditor escopo="geral" entidadeTipo=… entidadeId=… />`
- Instituições Financeiras → `/instituicoes-financeiras/[id]` nova seção
  "FAQ (regra geral)".
- Formas de Contrato → `/comissionamento/formas-contrato` ganha ação "FAQ"
  por forma (drawer).
- Averbadoras → `/averbadoras` ação "FAQ" por averbadora (drawer).
Mostra em cada item em quantos convênios está importado.

### 7.3 Cadastros novos (divisão Cadastros)

- `/regionalismo` — lista por UF/cidade com abas Estados | Cidades;
  formulário com editores de lista (gírias com significado/uso) e texto.
- `/feriados` — abas Nacionais | Estaduais | Municipais; calendário do ano
  como visão auxiliar.

### 7.4 IA do Workspace

Card ganha "Modelo de leitura de documentos" (+ botão testar).

## 8. Permissões (REGRA FIXA — 4 pontos na mesma entrega)

| Chave | Usa em | Nova? |
|---|---|---|
| `workspace-convenios` | `/convenios/**` (inclui Públicos e Órgãos) | não |
| `workspace-regionalismo` | `/regionalismo` | **sim** (seed do root) |
| `workspace-feriados` | `/feriados` | **sim** (seed do root) |
| `sistema-config-instituicoes` | aba FAQ da IF | não |
| `sistema-config-credito` | FAQ das formas | não |
| `workspace-averbadoras` | FAQ das averbadoras | não |
| `sistema-config-ia` | modelo de leitura | não |
| `CONHECIMENTO_SERVICE_TOKEN` (env) | `/api/conhecimento/**` | env nova na Vercel |

`usuarios/page.tsx`: `workspace-regionalismo` e `workspace-feriados` sob
`cat-div-cadastros`, level 1. `divisoes.ts`: itens em Cadastros; sub-itens
novos sob Convênios. `permissions.ts`: exatos + prefixos.

## 9. Fases e divisão de trabalho

| Fase | Conteúdo | Fable | Sonnet |
|---|---|---|---|
| **1 — Núcleo** | Migration A (2.1–2.8 + triggers R1–R6 + RPC por seção); página cheia `/convenios/[id]` com Dados Básicos + sub-abas Público, Formas & Margens, Instituições (na Fase 1 o vínculo tem canais/público/matriz/órgãos; o roteiro entra na Fase 2 como documento), Órgãos; submenus Públicos e Órgãos; listagem com completude parcial | migration, RPC, roteiro | telas + actions |
| **2 — Documentos & FAQ** | Migration B (2.9–2.11 + bucket); sub-abas Decretos, Documentos, FAQ (duas visões + importação); FAQ nas 3 entidades; roteiro no vínculo | migration, bucket, revisão | telas + actions + FaqEditor |
| **3 — Regionalismo & Feriados** | Migration C (2.12–2.13 + seeds nacionais + perms); menus; resolução da seção 4 | migration, seed, perms | telas |
| **4 — Jarvis leitor** | `ia_config.modelo_leitura`, extração, resumo, FAQ rascunho, painel de rascunhos | pipeline IA + segurança | UI do painel |
| **5 — Dossiê & agente** | `convenio_conhecimento` (json+md), prévia na tela, endpoint `/api/conhecimento`, consumo no CRM AlvoConsig | função SQL, endpoint, token | prévia |

Cada fase = uma worktree/branch (`convenio-bc/fase-N`), merge pequeno,
migration aplicada no merge. Fase 1 pode começar imediatamente; 2 e 3 são
independentes entre si (3 pode andar em paralelo em outra sessão).

## 10. Decisões fixadas (não reabrir)

1. Esferas, Tipos, Formas de Contrato e IFs: **usar os cadastros existentes**;
   nada da lista da Alicia é importado.
2. Público Atendido é cadastro global **sem** vínculo a esfera/tipo, com
   situação funcional, regime jurídico e tipo de provimento.
3. Órgãos/Empregadores só de **exceção**; modo `exceto` (padrão) ou `somente`
   por vínculo Convênio×IF.
4. Regionalismo é do **cliente** (cidade/UF), com fallback pela cidade do
   convênio só se abrangência municipal/estadual; feriados idem, um cadastro
   com 3 abas.
5. FAQ em duas visões: geral (na entidade, importada por seleção) e do
   convênio (com contexto opcional). Sem importação automática.
6. Decretos e roteiros são documentos (texto e/ou link e/ou upload) com
   leitura pelo Jarvis; IA gera **rascunho**.
7. Convênio em tela cheia; Dados Básicos = obrigatório; BC = opcional com
   score de completude.
8. Nada exposto a `anon`/`authenticated`; agente consome via endpoint com
   token de serviço.

## 11. Pendências fora desta spec

- Categorias de FAQ: texto livre com datalist agora; cadastro só se virar
  problema.
- Embeddings/RAG vetorial: só quando o dossiê não couber no contexto.
- Portal Parceiro / CLT-NuAzul consumindo o mesmo endpoint: depois do
  AlvoConsig.
- Valor de `modelo_leitura` (qual modelo pago): Bruno escolhe na hora da
  Fase 4.
