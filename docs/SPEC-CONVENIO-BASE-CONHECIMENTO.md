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
- **A IA busca, o texto oficial é a fonte.** O Jarvis encontra normas na web,
  mas todo dado que vai para a BC sai do texto oficial baixado pelo servidor,
  com citação literal conferida e ente verificado (§6). Nunca da resposta da IA.
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
| `logradouro`, `numero`, `complemento`, `bairro` | text | endereçamento completo (+ `cidade`/`uf`/`cep` que já existiam). **CNPJ.ws é a fonte primária** (`normalizeCnpjWsCompleto` devolve os quatro); ViaCEP é fallback ao editar o CEP e só preenche campo vazio. Editados nos **Dados Básicos**. Substituíram o campo único `endereco`, que concatenava logradouro+bairro (migration `20260910140628`) |
| `numero_servidores` | integer | editado na **Base de Conhecimento** (sub-aba Público) |
| `max_comprometimento_salarial` | numeric(5,2) | teto % da margem total |
| `prazo_minimo_geral` / `prazo_maximo_geral` | integer | meses; check min ≤ max |
| `abrangencia` | text check in (`municipal`,`estadual`,`nacional`) | backfill inicial pela esfera do tipo; editado na **Base de Conhecimento** (sub-aba Público) |
| `bc_observacoes` | text | notas livres da base de conhecimento |

`abrangencia` e `numero_servidores` moram nesta tabela mas pertencem à seção
"geral" da BC (`salvarConvenioBcGeral`): `saveConvenio` **não** os grava, senão
salvar o cadastro básico sobrescreveria o valor da BC com o estado velho do
formulário.

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

## 6. Jarvis pesquisador (decisão do Bruno, 10/09/2026 — substitui o "Jarvis leitor")

**Fluxo:** Dados Básicos → **Pesquisa (Jarvis)**, primeiro passo da BC → o
Jarvis busca na web as normas oficiais do ente → o servidor baixa o texto
oficial e confere o ente → o Jarvis extrai sugestões **só do texto baixado**,
cada uma com citação literal → o humano aceita, edita ou rejeita → só o aceito
entra na BC. O usuário completa o que o Jarvis não achou. O botão "Ler com o
Jarvis" de um documento já anexado usa o mesmo pipeline, sem a etapa de busca
(`origem='documento'`).

**Por que o texto oficial é a fonte, e não a resposta da IA.** Teste do Bruno
com o Gemini para Cubatão/SP (10/09): o decreto principal citado (nº
11.731/2026) é de **Itajubá-MG**; os "35% empréstimo / 40% total" não estão no
texto; e "é proibida a portabilidade" era "portabilidade **automática**". Se
isso entrasse na BC, o agente informaria margem errada a servidor de outra
cidade.

### 6.1 Modelos e custo

`ia_config.modelo_pesquisa` (busca; o sistema liga
`plugins: [{ id: 'web', max_results: 5 }]` do OpenRouter, então qualquer
modelo serve) e `ia_config.modelo_leitura` (extração; sem web). Pagos, na mesma
chave OpenRouter do Jarvis — aprovado pelo Bruno em 10/09 **só para esta
função**; o chat do Jarvis continua na lista gratuita. Campo vazio = recurso
desligado, com aviso na tela. Custo por pesquisa: 1 chamada de busca + 1 de
extração por fonte (máx. 8 fontes reportadas — a busca em si consulta 5
resultados, número menor que o de fontes, para conter contexto/custo) —
ordem de centavos por convênio, conforme o modelo escolhido.

**Modelo de raciocínio ⇒ sempre `reasoning: { effort: 'low' }` (achado real,
11/09/2026).** Em modelos como GPT-5.x/Claude com extended thinking, `max_tokens`
cobra raciocínio + resposta JUNTOS — sem capar o esforço, o modelo pode gastar
o orçamento inteiro "pensando" (pior ainda com o plugin de busca) e devolver
`content` vazio, sem nunca escrever o JSON pedido. Foi exatamente o que
aconteceu na 1ª pesquisa real (GPT-5.2 como `modelo_pesquisa`): 3 tentativas,
mesma falha determinística, **US$0,72 gastos sem resultado nenhum** — retentar
uma falha determinística só repete o gasto, não corrige nada. Por isso:
`chamarIaJson` sempre manda `reasoning: { effort: 'low' }` (parâmetro
ignorado pelo OpenRouter em modelos sem suporte a raciocínio); `MAX_TENTATIVAS`
caiu de 3 para 2; e o erro de "modelo não devolveu resposta" agora distingue
`finish_reason === 'length'` (estourou `max_tokens`) do resto, citando o
modelo e o limite usado.

### 6.2 Etapas (tabela `convenio_pesquisas`)

Cada chamada avança **uma** etapa sob lease (`convenio_pesquisas_claim`), em
até ~50 s:

1. **buscando** — prompt com nome, razão social, CNPJ, tipo/esfera,
   cidade/UF; pede JSON de normas `{url, titulo, tipo_norma, numero, ano,
   ente}` sobre consignação em folha **do ente** (federais só se o convênio
   for federal), preferindo diário oficial, portal da prefeitura/câmara e
   repositórios de leis. Grava até 8 fontes `candidata` (dedupe por URL).
2. **baixando** (uma fonte por passo) — download server-side protegido (§6.4);
   PDF → texto com `pdf2json` (já no projeto); HTML → texto; original guardado
   no bucket em `convenios/<id>/pesquisa/<fonte_id>/<nome>`; PDF sem camada de
   texto (escaneado) → `sem_texto`.
3. **verificação do ente** — determinística, sem IA: texto normalizado
   (minúsculas, sem acento); captura "prefeitura / prefeito / município /
   câmara municipal de X" (municipal), "estado de X" / "governo do estado de
   X" (estadual), "presidente da república" / "congresso nacional"
   (federal). Ente detectado ≠ ente do convênio → `ente_divergente`, com
   motivo legível ("o texto é de Itajubá-MG"); confere → `verificada`; sem
   menção → `nao_verificada` (o humano pode confirmar lendo a fonte).
4. **extraindo** (uma fonte verificada ou confirmada por passo) —
   `modelo_leitura` recebe o texto + catálogos com ids (`formas_contrato` e
   `publicos_atendidos` ativos) + valores atuais da BC; devolve JSON
   `{sugestoes: [{secao, campo, valor, citacao, artigo}], faq: [...],
   nao_encontrado: [...]}`. Validação no servidor: **a citação tem que ser
   substring do texto** (normalizando espaços e caixa) — senão a sugestão é
   descartada e contada no resumo; ids têm que existir no catálogo (sem
   mapeamento → `forma:?` / `publico:?`, e o humano escolhe na revisão);
   percentual 0 < p ≤ 100; prazos inteiros > 0.
5. **concluida** — resumo + `nao_encontrado` (o que o usuário precisa completar).

Falha numa etapa: `tentativas + 1`; na 3ª falha → `erro`, com mensagem.

### 6.3 Revisão e aplicação

Sugestões agrupadas por seção; conflitos (mesmo campo, fontes diferentes) lado
a lado com número/ano da norma. **Aceitar:** (a) importa a fonte como
`convenio_documentos` (tipo `decreto` para normas; url + arquivo +
`texto_extraido`; fonte → `importada`), se ainda não importada; (b) aplica com
**escrita pontual** — nunca pela RPC `convenio_bc_salvar_secao`, que substitui
a seção inteira: geral → update da coluna (valida R1/R5); formas → upsert do
par forma/percentual (a trigger R1 continua valendo); públicos → insert `on
conflict do nothing`; FAQ → `faq_itens` escopo `convenio`, `origem='ia'`,
`status='ativo'`, com `documento_id`; observação → acrescenta em
`bc_observacoes` com a referência da norma; (c) demais pendentes do mesmo
campo → `substituida`. "Aceitar todas desta fonte" aplica uma a uma e relata
falhas. `convenio_bc_sugestoes` é a trilha de auditoria: quem aceitou, o que
foi aplicado, de qual texto.

### 6.4 Segurança

- Download só `http`/`https`; DNS resolvido e bloqueio de faixas privadas,
  loopback, link-local e CGNAT (10/8, 172.16/12, 192.168/16, 127/8,
  169.254/16, 100.64/10, 0/8, ::1, fc00::/7, fe80::/10); redirects manuais
  (máx. 3, rechecando cada destino); timeout 20 s; máx. 15 MB; só PDF, HTML e
  texto. (URL vem de saída de IA — sem isso seria SSRF.)
- Texto da web é **dado, nunca instrução** (prompt injection): o prompt diz
  isso, a saída é validada estruturalmente, a citação é conferida e nada é
  aplicado sem aceite humano.
- Chave do provedor só no servidor (cofre); logo, **testar em produção** (o
  `.env.local` não tem a `CRM_CREDENTIALS_KEY` real).

### 6.5 Execução

`POST /api/convenios/[id]/pesquisa` (iniciar) e
`POST /api/convenios/[id]/pesquisa/avancar` (um passo), `maxDuration = 60`. A
tela chama `avancar` em laço enquanto estiver aberta; o cron
`/api/cron/convenio-pesquisas` (a cada 2 min) retoma pesquisas paradas por lease
vencido. No máximo uma pesquisa ativa por convênio (índice único).

### 6.9 Desenho original (substituído em 10/09 — mantido só como histórico)

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
    0. *Pesquisa (Jarvis)* — **primeira sub-aba** (decisão 10/09): botão
       "Pesquisar com o Jarvis", progresso, fontes encontradas (com status
       do ente) e fila de sugestões para aceitar/editar/rejeitar (§6).
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

Card ganha "Modelo de pesquisa (com busca na web)" e "Modelo de leitura de
documentos" (`ia_config.modelo_pesquisa` / `modelo_leitura`), com o aviso de
que são pagos e usados só pela pesquisa de convênios.

## 8. Permissões (REGRA FIXA — 4 pontos na mesma entrega)

| Chave | Usa em | Nova? |
|---|---|---|
| `workspace-convenios` | `/convenios/**` (inclui Públicos e Órgãos) | não |
| `workspace-regionalismo` | `/regionalismo` | **sim** (seed do root) |
| `workspace-feriados` | `/feriados` | **sim** (seed do root) |
| `sistema-config-instituicoes` | aba FAQ da IF | não |
| `sistema-config-credito` | FAQ das formas | não |
| `workspace-averbadoras` | FAQ das averbadoras | não |
| `sistema-config-ia` | modelos de pesquisa e leitura | não |
| `workspace-convenios` (regra de rota, não chave nova) | `/api/convenios/**` (pesquisa do Jarvis) | não |
| `CONHECIMENTO_SERVICE_TOKEN` (env) | `/api/conhecimento/**` | env nova na Vercel |

`usuarios/page.tsx`: `workspace-regionalismo` e `workspace-feriados` sob
`cat-div-cadastros`, level 1. `divisoes.ts`: itens em Cadastros; sub-itens
novos sob Convênios. `permissions.ts`: exatos + prefixos.

## 9. Fases e divisão de trabalho

| Fase | Conteúdo | Fable | Sonnet |
|---|---|---|---|
| **1 — Núcleo** | Migration A (2.1–2.8 + triggers R1–R6 + RPC por seção); página cheia `/convenios/[id]` com Dados Básicos + sub-abas Público, Formas & Margens, Instituições (na Fase 1 o vínculo tem canais/público/matriz/órgãos; o roteiro entra na Fase 2 como documento), Órgãos; submenus Públicos e Órgãos; listagem com completude parcial | migration, RPC, roteiro | telas + actions |
| **2 — Documentos & FAQ** | Migration B (2.9–2.11 + bucket); sub-abas Decretos, Documentos, FAQ (duas visões + importação); FAQ nas 3 entidades; roteiro no vínculo | migration, bucket, revisão | telas + actions + FaqEditor |
| **3 — Jarvis pesquisador** (antecipada em 10/09; era a 4) | Migration `20260910224854` (pesquisas, fontes, sugestões, modelos no `ia_config`); pipeline busca → download → verificação do ente → extração com citação; sub-aba Pesquisa; "Ler com o Jarvis" | migration, segurança (SSRF, injeção), revisão | pipeline + telas |
| **4 — Regionalismo & Feriados** (era a 3) | Migration C (2.12–2.13 + seeds nacionais + perms); menus; resolução da seção 4 | migration, seed, perms | telas |
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
9. Jarvis pesquisador (10/09): a IA busca, o **texto oficial baixado** é a
   fonte; citação literal conferida no texto; ente verificado sem IA; tudo
   passa por aceite humano; modelo pago só na pesquisa (o chat segue gratuito).
   É o primeiro passo da BC depois dos Dados Básicos.

## 11. Pendências fora desta spec

- Categorias de FAQ: texto livre com datalist agora; cadastro só se virar
  problema.
- Embeddings/RAG vetorial: só quando o dossiê não couber no contexto.
- Portal Parceiro / CLT-NuAzul consumindo o mesmo endpoint: depois do
  AlvoConsig.
- Quais modelos pagos usar em `modelo_pesquisa` / `modelo_leitura`: o Bruno
  escolhe no card IA do Workspace ao testar a Fase 3 (a conta OpenRouter
  precisa ter crédito — modelos pagos e o plugin de busca não usam a cota
  gratuita).
- OCR de PDF escaneado (fontes `sem_texto`): depois.
