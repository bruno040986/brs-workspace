# SPEC — Visão de Oferta por rentabilidade + Seleção de Tabelas (CRM AlvoConsig)

Data: 02/10/2026. Autor: investigação somente leitura (nenhum código, migration ou commit).
Repos lidos: `brs-alvoconsig` (main, 98463fd), `brs-workspace` (main) e a worktree
`brs-workspace-comissao` (branch `comissao/oferta-e-publicacao`, só o plano).
Tudo que não foi confirmado no código está marcado como **ASSUNÇÃO**.

> **Antes de codar:** este Next é o 16.2.12 e tem breaking changes. O executor lê
> `brs-alvoconsig/apps/web/node_modules/next/dist/docs/` (pelo menos `01-app`, nas partes de
> Server Actions / `'use server'` e Route Handlers) antes de mexer em action ou rota.
> Regra do grupo: worktree própria por sessão (ex.: `brs-alvoconsig-visao-oferta`, branch
> `crm/visao-oferta-rentabilidade`). Vercel já está em `gru1`.

---

## 0. Resumo

- **Entrega 1:** critério "Maior rentabilidade" (repasse do parceiro em R$, desempate por
  maior valor liberado), filtro de prazo mín./máx. e "melhor oferta por forma + Ver mais".
  **Não precisa de migration no CRM**: tudo cabe em `crm_campanhas_parceiro.config.visaoOferta`
  (jsonb). A rentabilidade **soma comissão + emissão + seguro** (quando houver cada parte). Ela usa o
  cálculo oficial do Workspace se já estiver na main; senão, usa um modo provisório definido em §2.4 (dívida
  marcada, com teste de comparação).
- **Entrega 2:** etapa opcional "Seleção de Tabelas". Também cabe no `config` (jsonb), então
  não precisa de migration.
- **Permissões:** nenhum menu é criado, movido ou renomeado. A etapa nova fica dentro do
  assistente que já existe, protegido por `campanhas.criar_editar` (`lib/crm/permissoes.ts:18`).
  **Os 4 pontos da regra fixa (`SYSTEM_MODULES`, `divisoes.ts`, `permissions.ts`, seed) não mudam.**
  Nenhuma chave de `PERMISSOES_CRM` muda.
- **O CRM nunca exibe R$ ou % de repasse** (decisão 4). O browser recebe só a posição na ordem. A visão com
  valores é do usuário master e fica no Portal Parceiro, fora deste escopo.

---

## 1. Mapa do código atual

### 1.1 Assistente "Criar campanha" (CRM)
| O quê | Onde |
|---|---|
| Assistente inteiro (client) | `apps/web/src/components/crm/campanhas/NovaCampanhaWizard.tsx` |
| Chaves das etapas | `:34` `type PassoChave = 'filtros' \| 'atendentes' \| 'disparo' \| 'visaoOferta' \| 'revisar'` |
| Lista de etapas (Disparo só para `whatsapp_nao_oficial`) | `:45-54` |
| Estado da Visão de Oferta | `:71` `useState<VisaoOfertaConfig>(VISAO_OFERTA_PADRAO)` |
| "Reaproveitar campanha" restaura `config.visaoOferta` | `:102-119` |
| Envio (`criarCampanhaParceiro`) | `:166-191` (passa `visaoOferta` em `:180`) |
| UI da Visão de Oferta | `:430-528`. Select de ordenamento em `:471-481`, com "Menor valor liberado" em `:477` |
| UI de Revisar (nome, descrição, roteiros; **não há resumo da Visão de Oferta**) | `:530-552` |
| Gate do "Avançar" (a Visão de Oferta não tem validação) | `:556-563` |

### 1.2 Tipos, normalização e ordenamento (compartilhado client/server)
`apps/web/src/lib/crm/visao-oferta.ts` (sem `'use server'`/`'use client'`):
- `:16` `OrdenamentoOferta = 'menor_valor' | 'menor_taxa' | 'maior_valor' | 'maior_taxa'`
- `:20-26` `VisaoOfertaConfig { ofertasPorIf, ofertasPorFormaContrato, ordenamento, seguro, ordemFormasContrato }`
- `:32-44` `VISAO_OFERTA_PADRAO` (`ordenamento: 'menor_valor'`). O comentário diz que "menor valor = maior
  comissão". **Isso fica desatualizado** pela decisão nova, e o mesmo texto aparece em `atendimento-shared.ts:172-177`.
- `:54-68` `normalizarVisaoOferta` (valor desconhecido → padrão; limite por forma ≤ limite por IF)
- `:77-90` `ordenarOfertas` (sort por valor ou taxa; oferta sem taxa vai para o fim)
- `:109-159` `agruparOfertasParaAccordion` (filtro de seguro → ordenação → agrupa IF→forma → aplica os limites)

### 1.3 Gravação
- `apps/web/src/lib/crm/campanhas-actions.ts` (`'use server'`):
  - `:55-74` `FiltrosCampanha` (convênio é **opcional**, `convenioId` nulo = todos)
  - `:126-180` `aplicarFiltros` (query em `crm_contatos`)
  - `:240-254` `CriarCampanhaInput` (`visaoOferta?: Partial<VisaoOfertaConfig>`)
  - `:258-385` `criarCampanhaParceiro`: **os leads são materializados na criação** (`:299-310`, até 20.000)
    e o `config` é gravado com `visaoOferta: normalizarVisaoOferta(...)` (`:326-330`)
  - `:505` `editarCampanhaParceiro`: edita **só** nome, descrição e atendentes. **Hoje não existe edição de
    Visão de Oferta nem de filtros de campanha criada.**
- Coluna: `crm_campanhas_parceiro.config jsonb not null default '{}'`
  (`brs-workspace/supabase/migrations/20260829150000_crm_campanhas_parceiro.sql:42`).

### 1.4 Atendimento (onde a Visão de Oferta é aplicada)
- `apps/web/src/lib/crm/atendimento-actions.ts` (`'use server'`), `montarLeadResumo` em `:133-229`:
  - `:146-155` lê `crm_ofertas` do lead (`tabela_comissao_id`, `prazo`, `valor_liberado`, `com_seguro`…,
    `order valor_liberado desc`) **e** `resolverVisaoOferta` em paralelo
  - `:159-198` monta `OfertaCard[]`. **Nenhum campo de comissão é lido.**
  - `:204-228` devolve `LeadResumo` com **todas** as ofertas + `visaoOferta`
- `resolverVisaoOferta`: `apps/web/src/lib/crm/atendimento-shared.ts:178-183`
- Tipos: `apps/web/src/lib/crm/atendimento-types.ts:9-28` (`OfertaCard`), `:46-48` (`ofertas`, `visaoOferta`)
- Quem chama: `app/api/crm/atendimento/route.ts:52` (resource `resumo`) e `LigacaoCentro.tsx:60`
- **Ordenamento, filtro de seguro e limites rodam NO BROWSER:** `components/crm/atendimento/OfertasAccordion.tsx:28`
  (`useMemo(() => agruparOfertasParaAccordion(ofertas, config))`), renderizado por `PainelLead.tsx:268`.
  O 1º card de cada forma recebe `destaque` (`OfertasAccordion.tsx:72`).
- Outras superfícies com ordem fixa por maior valor, **fora do escopo**: variáveis do roteiro
  (`atendimento-actions.ts:1835`), simulador (`:1724`) e `getLead` (`lib/crm/actions.ts:187-222`, `:322`).

### 1.5 Origem das ofertas
- `crm_ofertas` (`brs-workspace/supabase/migrations/20260829100000_crm_ofertas.sql`) é uma **foto tirada na
  alocação**: uma linha por (lead × tabela × prazo). Ela é gerada no Workspace em
  `src/app/api/alvoconsig/campanhas/route.ts` (`montarLinhasOfertas` `:69-160`) via
  `src/lib/alvoconsig/ofertas.ts:100-152` (todo coeficiente vigente do convênio × margem).
  O REFIN vem do inventário WeSales, às vezes com `tabela_comissao_id` (`resolverOfertasRefin`) e às vezes sem
  (`route.ts:124-149`, `tabela_comissao_id: null`). Simulação online e import também podem vir sem tabela.
- Coeficientes vigentes no CRM: `apps/web/src/lib/crm/coeficientes.ts:36-91`. Ele filtra a vigência do
  **coeficiente**, mas **não** `tabelas_comissao.vigencia_inicio/fim` (colunas novas, migration
  `20260930173000_comissionamento_codigos_promotora_vigencias.sql:8-11`) nem `deleted_at`.
- **ASSUNÇÃO:** nenhuma rotina atualiza `crm_ofertas` de um lead já alocado quando aparece tabela nova (o cron
  `rollup-ofertas` só reconcilia estágio). Então "tabela nova entra sozinha" vale para ofertas que já existam ou
  que entrem por nova alocação/simulação, não gera oferta nova para lead antigo.

### 1.6 Comissão e repasse (Workspace, mesmo Supabase)
- Tabelas: `tabelas_comissao` (`20260823120000_comissionamento_arw.sql:97-113`, depois + `promotora_id`,
  `oferta`, `vigencia_*`), `prazos_comissao` (`:127-149`: `forma_pagamento` ∈ `percentual|faixa_percentual|
  faixa_fixo|fixo`, `prazo_inicial/final`, `valor_inicial/final`, `comissao numeric(12,4)`, `emissao`, `seguro`,
  `is_active`; + `vigencia_inicio/fim` em `20260930173000:31-34`), `spreads` (recriada com arrays em
  `20260823170000_spreads_multiselecao.sql`; shape em `src/lib/comissionamento.ts:90-100`),
  `financial_institutions.imposto_comissao_percent numeric(6,3)` (`:43-44`),
  `agente_corban_tipos_agente.percentual_repasse numeric(6,2)` (`:23-24`).
- RLS dessas tabelas = permissão Workspace `sistema-config-credito` (`:214-222`). Usuário do CRM (parceiro) não
  tem essa permissão, **então o browser do parceiro não consegue ler comissão pelo PostgREST**. O CRM lê tudo
  com `createAdminClient()` (service role), só no servidor.
- Tipo de agente do parceiro: `agentes_parceiros.tipo_agente` (TEXT). O editor do Workspace grava o **id** do
  catálogo (`AgenteCorbanEditorClient.tsx:929-935, :1873`). **ASSUNÇÃO:** registros antigos ou vindos do ARW
  podem ter o **nome**; a resolução tenta id e depois nome (case-insensitive) e, sem casar, repasse = 0.
- Cálculo existente: `src/lib/comissionamento.ts:115-145` (`resolverSpreadTipoAgente`) e `:166-202`
  (`calcularGradeComissionamento`). **Defeito conhecido** (plano `brs-workspace-comissao/docs/
  PLANO-COMISSIONAMENTO-OFERTA-PUBLICACAO-2026-09-29.md` §A): `impostoPercent ?? 0` e `spread ?? 0` deixam o
  repasse positivo com insumo ausente. O plano define `repasseParceiro()` com falha fechada (insumo ausente → 0)
  e a view `tabelas_comissao_publicacao` (imposto da IF **ou** da promotora, pendências). **No main, só a fatia 1
  do plano está aplicada** (`20260929120335`: `oferta`/`nome_curto`). `promotoras.imposto_comissao_percent`,
  `spreads.pontos > 0`, a view e `repasseParceiro` **ainda não existem**.
- **Emissão e seguro** ficam na mesma linha de `prazos_comissao`
  (`20260823120000_comissionamento_arw.sql:139-143`):
  - `emissao numeric(12,4)`: **valor fixo em R$**. O rótulo da tela é "Emissão (Valor Fixo)"
    (`PrazoComissaoEditor.tsx:442`) e a grade usa `emPercentual={false}` (`:464`).
  - `seguro numeric(12,4)` + `forma_pagamento_seguro` ∈ `percentual|fixo|null`. Nulo é tratado como
    **percentual** (`PrazoComissaoEditor.tsx:263`, `seguroPercentual = form.forma_pagamento_seguro !== 'fixo'`).
  - Regra ARW das grades (`comissionamento.ts:159-165`; editor `:265-288`): **comissão** desconta imposto **e
    spread**, depois aplica %repasse (`usarSpread: true`). **Emissão e seguro** descontam **só o imposto** e
    aplicam %repasse (`usarSpread: false`).
  - O plano do Workspace (§B, "Cálculo") mantém essa regra e acrescenta: imposto ausente zera também emissão e
    seguro, e tabela com pendência zera **as três** grades.
- Escala: `comissao`, `imposto` e `spread` estão em **pontos percentuais** (ex.: 7.000 = 7%; repasse 100 = 100%).
  **ASSUNÇÃO:** o "gravado em centésimos" do briefing se refere a essa escala de 2-4 casas. Nada no schema indica
  um inteiro ×100.

### 1.7 O que o browser do parceiro recebe hoje
`LeadResumo.ofertas[]` com `OfertaCard` completo (`atendimento-types.ts:9-28`): IF, tabela, seguro, prazo, parcela,
valor liberado, taxa, validade, **coeficiente**, estágio e origem. Vão **todas** as ofertas do lead (os limites são só
visuais). **Nenhum valor de comissão, spread, imposto ou repasse sai para o cliente hoje, porque o CRM nunca lê
essas colunas.** Não encontrei vazamento atual.

---

## 2. Segurança do repasse

### 2.1 Regra
Comissão bruta, imposto, spread, líquido e `percentual_repasse` **nunca** saem do servidor do CRM. A ordenação por
rentabilidade é calculada no servidor. O browser recebe **só um inteiro de posição** (`posicaoRentabilidade`), nunca
o valor em R$ nem o %.

### 2.2 Onde roda
- Módulo novo **sem diretiva** `apps/web/src/lib/crm/rentabilidade.ts`, importado **só** por `atendimento-actions.ts`.
  **Não pode** ficar em arquivo `'use server'`: toda função exportada de um arquivo `'use server'` vira endpoint
  chamável pelo browser (confirmar na doc do Next 16, em `node_modules/next/dist/docs/01-app`). Função que devolve
  repasse exportada de lá seria vazamento direto.
- Não instalar `server-only` (não está no projeto). Proteção: não importar o módulo em nenhum `'use client'`.
  O critério de aceite inclui um `grep` disso.
- `visao-oferta.ts` (compartilhado) **não** importa `rentabilidade.ts`.

### 2.3 Cálculo (por oferta, só no servidor)
**Linha de prazo:** `prazos_comissao` com `tabela_comissao_id = oferta.tabela_comissao_id`, `is_active`,
`prazo_inicial ≤ oferta.prazo ≤ prazo_final` e vigência (`vigencia_inicio/fim` nulos ou contendo agora).
Para `forma_pagamento` `faixa_percentual`/`faixa_fixo`, também `valor_inicial ≤ valor_liberado ≤ valor_final`
(**ASSUNÇÃO:** a faixa é sobre o valor liberado). Se mais de uma linha casar, vale a de `vigencia_inicio` mais
recente e depois a de maior `updated_at`.

**Insumos comuns à tabela:** `impostoPercent`, `repasseCalculavel`, `spread` e `percentualRepasse` (origem em §2.4).

**Três componentes, cada um com repasse em R$** (`fator(x) = x × (1 − impostoPercent/100) × percentualRepasse/100`):
```
comissaoR$ = forma_pagamento ∈ {percentual, faixa_percentual}
               ? round2(max(0, comissao − comissao×imposto/100 − spread) × pct/100 × valor_liberado/100)
               : round2(max(0, comissao − comissao×imposto/100 − spread) × pct/100)   // fixo/faixa_fixo: R$ direto (decisão 2)
emissaoR$  = emissao não nulo ? round2(fator(emissao)) : ausente            // sempre R$ fixo, SEM spread
seguroR$   = seguro não nulo E entra-seguro(oferta)
               ? (forma_pagamento_seguro = 'fixo' ? round2(fator(seguro))
                                                   : round2(fator(seguro) × valor_liberado/100))   // nulo = percentual
               : ausente                                                                      // SEM spread
repasseReais = soma dos componentes presentes
```
- **Comissão** usa `repasseParceiro()` (falha fechada: imposto, spread ou pct ausente → 0; spread ≤ 0 → 0; piso 0).
  **Emissão e seguro** seguem a regra ARW: descontam só o imposto, sem spread. Imposto ou pct ausente → 0.
- **`repasseCalculavel = false`** (pendência da tabela) → os três componentes valem 0 e o repasse é **conhecido = 0**.
- **Seguro e o filtro Com/Sem/Ambas.** `entra-seguro(oferta)` = `oferta.comSeguro === true`. O componente seguro é
  da própria oferta (tabela com seguro), não da campanha:
  - "Sem seguro": só passam ofertas com `comSeguro !== true` (`visao-oferta.ts:113`), então o seguro **nunca entra**
    na soma;
  - "Com seguro": só passam ofertas com `comSeguro === true`, então o seguro **entra** quando a linha tiver valor;
  - "Ambas": cada oferta soma o seguro só se ela própria for com seguro.
  - `comSeguro = null` (desconhecido) → o seguro **não entra** (falha fechada: não somar prêmio que não se sabe se
    existe), mesmo com "Sem seguro" exibindo a oferta.
  - O filtro de seguro é aplicado no browser, mas a soma é decidida no servidor só pelo `comSeguro` da oferta, então
    o resultado é o mesmo. Não é preciso mandar o filtro ao servidor.
- **Só uma parte existe:** soma o que existir. Partes ausentes contam 0. Exemplo: só emissão → `repasseReais =
  emissaoR$`; só seguro numa oferta sem seguro → nenhuma parte entra → **conhecido = 0**, não desconhecido, porque a
  linha de prazo existe.
- **Desconhecido** (vai para o fim, §4): oferta sem `tabela_comissao_id`, sem linha de prazo que case, ou com linha em
  que `comissao`, `emissao` e `seguro` são todos nulos.
- **Base do seguro percentual = valor liberado** (mesmo critério da comissão, decisão (a)); confirmado pelo Bruno
  em 02/10/2026 (§7, decisão 9).
- Cópia das funções: `apps/web/src/lib/crm/comissionamento-repasse.ts` com o cabeçalho "cópia de
  brs-workspace/src/lib/comissionamento.ts — alterar nos 2 repos" (mesmo precedente do Portal no plano). Vão
  `repasseParceiro`, `resolverSpreadTipoAgente` e a regra de emissão/seguro. O teste vai junto. A soma dos 3
  componentes e o filtro `entra-seguro` ficam em `rentabilidade.ts` (regra só do CRM).

### 2.4 Cálculo oficial × modo provisório (decisão 1: subir já)
As tabelas que o Bruno ativa para o CRM estão corretas. O que falta na main é **código**: `repasseParceiro`, view
`tabelas_comissao_publicacao`, `promotoras.imposto_comissao_percent` e a trava `spreads.pontos > 0` (fatias 1-B1 e 2
do plano de comissionamento).

**Primeiro passo obrigatório do executor da F2:** verificar na main do `brs-workspace`:
```
grep -n "export function repasseParceiro" src/lib/comissionamento.ts
grep -ln "tabelas_comissao_publicacao" supabase/migrations/*.sql
npx supabase migration list      # a migration da view precisa constar como aplicada no remoto
```
- **Os três positivos → cálculo OFICIAL.** Copia `repasseParceiro` (e a regra de emissão/seguro, se o Workspace
  tiver criado função própria) **idêntica**. Lê `imposto_percent` e `repasse_calculavel` da view (service role,
  `in('tabela_comissao_id', ids)`). Não cria modo provisório.
- **Qualquer negativo → modo PROVISÓRIO**, com exatamente este comportamento, isolado numa função
  `insumosRepasseProvisorio()` em `rentabilidade.ts`:
  1. `promotora_id` da tabela não nulo → `repasseCalculavel = false` (repasse 0, porque não dá para saber se o imposto
     é da IF ou da promotora).
  2. `promotora_id` nulo → `impostoPercent = financial_institutions.imposto_comissao_percent` da IF da tabela.
     Se for nulo → `repasseCalculavel = false`.
  3. `spread` = `resolverSpreadTipoAgente(spreads vigentes, contexto da tabela, tipo do parceiro)`. Sem spread ou
     `pontos ≤ 0` → `repasseCalculavel = false` (espelha a pendência `forma_sem_spread`, que zera as três partes).
  4. `repasseParceiro` provisório = a fórmula do plano, transcrita literalmente.
  - Marcar a função e a cópia com `// DÍVIDA PROVISORIO-REPASSE: remover quando a view tabelas_comissao_publicacao e
    repasseParceiro chegarem na main do brs-workspace (plano de comissionamento, fatias 1-B1 e 2).` O mesmo texto
    entra no corpo do PR.
  - **Teste de comparação** `rentabilidade.provisorio.test.ts`: casos fixos (IF direta com imposto e spread; sem
    imposto; sem spread; spread 0; com promotora). Enquanto o oficial não existir ele fica com
    `test.skip('aguarda repasseParceiro oficial')`. Quando chegar, quem remover a dívida liga o teste antes de
    apagar o provisório. Ele exige: (a) **igualdade** nos casos sem promotora; (b) nos casos com promotora,
    `provisório ≤ oficial` (o provisório nunca paga a mais). Com o teste verde, apaga `insumosRepasseProvisorio` e o
    marcador.
- Segundo o plano, as 88 tabelas que o CRM usa hoje são do Santander e não têm pendência. Então o provisório deve dar
  o mesmo resultado que o oficial para elas.

---

## 3. Modelo de dados

**Sem migration nas duas entregas.** Tudo fica em `crm_campanhas_parceiro.config.visaoOferta` (jsonb) e é
normalizado por `normalizarVisaoOferta`. Se um dia for preciso índice/RPC (ver §4, performance), a migration sai do
`brs-workspace` principal com timestamp real (`date +%Y%m%d%H%M%S`), `npx supabase migration list` antes, e
`db push` **antes** do deploy do CRM.

### 3.1 `VisaoOfertaConfig` (campos novos, todos opcionais no jsonb)
```ts
export type OrdenamentoOferta = 'maior_rentabilidade' | 'menor_valor' | 'menor_taxa' | 'maior_valor' | 'maior_taxa'
export type VisaoOfertaConfig = {
  ofertasPorIf: QuantidadeOfertas
  ofertasPorFormaContrato: QuantidadeOfertas
  ordenamento: OrdenamentoOferta
  seguro: SeguroFiltro
  ordemFormasContrato: Produto[]
  prazoMin: number | null            // Entrega 1 — null = sem limite
  prazoMax: number | null            // Entrega 1
  // Entrega 2:
  selecaoTabelas: { modo: 'todas' } | { modo: 'somente', ids: string[] }
  semTabelaElegivel: 'aviso' | 'fallback_geral'   // chave por campanha; padrão 'aviso'
}
```
- "Ver mais" **não** vira campo (§5.1c).
- `OfertaCard` ganha `posicaoRentabilidade: number | null` (0 = mais rentável). Ele só é preenchido quando o
  ordenamento da campanha é `maior_rentabilidade`; nos outros casos é null e não há custo extra.
- `LeadResumo` ganha `avisoOfertas: 'sem_tabela_elegivel' | null` (Entrega 2) e `tabelasIgnoradas: number`
  (quantas ofertas foram removidas por tabela vencida/inativa; Entrega 2).

### 3.2 Compatibilidade
| Situação | Comportamento |
|---|---|
| Campanha existente (`ordenamento` gravado explicitamente pela normalização) | Mantém o critério gravado (ex.: `menor_valor`) |
| `prazoMin/prazoMax` ausentes | `null` → sem filtro (igual a hoje) |
| `selecaoTabelas` ausente | `{ modo: 'todas' }` |
| `semTabelaElegivel` ausente | `'aviso'` (irrelevante no modo `todas`) |
| Lead sem campanha / campanha sem `visaoOferta` | `VISAO_OFERTA_PADRAO`, que passa a ter `ordenamento: 'maior_rentabilidade'` (decisão 5). Campanhas com critério gravado não mudam |
| Campanha nova no assistente | Começa com `maior_rentabilidade` (estado inicial do assistente) |

Normalização: `prazoMin/Max` inteiro de 1 a 420 ou null. Se os dois existirem e `min > max`, o servidor **troca** os
dois (a tela bloqueia antes). `ids`: no máximo 2.000 strings uuid únicas. `'somente'` com lista vazia o servidor
**recusa** na criação (§4).

---

## 4. Regras e casos de borda

**Ordem do pipeline no servidor (`montarLeadResumo`):**
1. Lê `crm_ofertas` (igual a hoje).
2. *(E2)* Remove ofertas cuja tabela está inativa, excluída ou fora da vigência (`tabelas_comissao.is_active=false`,
   `deleted_at` não nulo, `vigencia_fim < agora`, `vigencia_inicio > agora`) → conta em `tabelasIgnoradas`.
3. *(E2)* Seleção: modo `somente` mantém só `tabela_comissao_id ∈ ids`. Se sobrar 0 ofertas e havia ofertas antes:
   `semTabelaElegivel='aviso'` → lista vazia + `avisoOfertas='sem_tabela_elegivel'`;
   `'fallback_geral'` → usa o conjunto do passo 2.
4. *(E1)* Se `ordenamento = maior_rentabilidade`: calcula `repasseReais` e grava `posicaoRentabilidade`.
5. Entrega ao browser. Seguro, prazo, ordenação estável pela posição e limites continuam em
   `agruparOfertasParaAccordion` (nenhum desses dados é sensível).

**Ordenação `maior_rentabilidade`:** `repasseReais desc`, depois `valorLiberado desc`, depois `prazo desc`, depois
`id` asc (ordem total determinística).
| Caso | Regra |
|---|---|
| Empate em R$ (soma comissão + emissão + seguro) | maior valor liberado; depois maior prazo |
| Repasse 0 (pendência zera as 3 partes; spread ≥ líquido sem emissão/seguro; tipo sem %) | conhecido = 0: fica abaixo das rentáveis, ordenada por valor |
| Comissão zerada pelo spread, mas com emissão e/ou seguro | soma só emissão + seguro (spread não as afeta), então pode ficar acima de 0 |
| Só emissão na linha de prazo | `repasseReais = emissaoR$` (constante, independe do valor liberado) |
| Seguro na linha, oferta sem seguro ou `comSeguro` nulo | seguro não entra; o resto soma normalmente |
| Mesma tabela/prazo nas versões com e sem seguro, com "Ambas" | a com seguro tende a vencer pela parcela do seguro; isso é o comportamento esperado da decisão 3 |
| Sem `tabela_comissao_id` (REFIN de inventário, import, simulação) ou sem `prazos_comissao` que case, ou linha com as 3 partes nulas | repasse **desconhecido** → depois das de repasse 0, ordenada por valor |
| Tipo de agente do parceiro não resolvido | todas desconhecidas → na prática vira "maior valor" (registrar `console.warn` uma vez por sessão, sem valores) |
| `valor_liberado` 0 | repasse 0 |

**Filtro de prazo (E1):** vale para ofertas com `prazo` conhecido. Oferta com `prazo` nulo **continua visível**, pela
mesma lógica do seguro "sem" (`visao-oferta.ts:112`, não esconder por falta de dado). Se o filtro zerar tudo, o
accordion mostra o aviso (§5.1).

**Gate de publicação:** pela regra corrigida de 29/09 não existe mais gate que esconda tabela. Tabela com pendência
**aparece** e tem repasse 0, então só cai na ordem. O CRM **não** esconde oferta por pendência e **não** mostra o
motivo (informação interna da BRS).

**Seleção (E2):**
- `somente` com 0 ids: o assistente bloqueia o "Avançar" ("Selecione ao menos uma tabela ou marque todas") e o
  servidor recusa.
- Filtros da etapa 1 mudam com a seleção já feita: a lista é recarregada. Ids que não aparecem mais são **removidos**
  do estado com o aviso "N tabela(s) selecionada(s) não se aplicam mais aos leads filtrados e foram retiradas". Se o
  modo `somente` ficar vazio por isso, volta para `todas` com o aviso "Nenhuma tabela da seleção anterior se aplica;
  voltamos para Todas as tabelas".
- Tabela vencida depois de criada a campanha: no atendimento cai no passo 2 (some). No modo `somente` isso pode
  levar ao aviso "sem tabela elegível". Na tela de seleção, a tabela vencida aparece com chip "Vencida", desmarcada e
  desabilitada.
- Id de tabela que muda (importador recria a tabela; limpeza de duplicatas do plano C2): modo `todas` não é afetado.
  No modo `somente`, o id antigo deixa de casar → aviso "sem tabela elegível". **Sem remapeamento automático**
  (YAGNI; a limpeza C2 move `crm_ofertas` para o id sobrevivente, então a seleção precisa ser refeita numa campanha
  nova). Decisão 6.
- Campanha em andamento: hoje não existe edição de Visão de Oferta (`campanhas-actions.ts:505`). **Fica assim**: as
  duas entregas valem só para campanha nova ou reaproveitada ("Reaproveitar" copia `visaoOferta` inteira, inclusive
  `selecaoTabelas`; os ids passam pela limpeza do item acima ao carregar a lista).
- Leads de convênios diferentes (filtro "Todos"): a lista junta as tabelas de todos os convênios dos leads, agrupadas
  por IF, com o convênio no chip da linha. Um lead só tem ofertas do próprio convênio, então a seleção de outro
  convênio não interfere nele.
- Lead sem convênio ou sem nenhuma oferta: não é "sem tabela elegível". Mostra o vazio de hoje ("Sem ofertas
  calculadas para este lead.").

**Oferta com estágio em andamento** (≠ `ofertas_disponiveis`/`reavaliar_ofertas_disponiveis`): hoje ela pode sumir
pelos limites. **Regra (decisão 7):** ela ignora seleção, prazo, seguro e limites e sempre aparece. Fica antes das
demais na sua forma, na ordem do critério. O contador "N ofertas" da IF/forma a inclui.

**Performance:**
- E1: no máximo +3 consultas por abertura de lead (`prazos_comissao in tabelaIds`, com `comissao, emissao, seguro,
  forma_pagamento, forma_pagamento_seguro, valor_inicial/final, prazo_*, vigencia_*`; `tabelas_comissao` + IF (ou a
  view, no modo oficial) para imposto/contexto; spreads + tipo do parceiro). Spreads e tipo de agente vão para `criarCacheTtl`
  (`lib/crm/cache-ttl.ts`) com TTL de 5 min por parceiro. Tudo em `Promise.all` com o que já roda em `:146`. Só
  executa quando o ordenamento é rentabilidade.
- E2 (lista do assistente): **não** varrer `crm_ofertas` dos leads (até 20 mil leads × dezenas de ofertas). A fonte
  é: convênios distintos dos leads filtrados (`aplicarFiltros` + `select convenio_id`, limite 20.000, mesmo custo de
  `criarCampanhaParceiro:301-308`) → `tabelas_comissao` desses convênios (não excluídas) + prazos de `coeficientes`
  vigentes. Centenas de linhas é aceitável: lista virtualizada desnecessária, basta seções recolhíveis por IF.
  **ASSUNÇÃO:** as tabelas de REFIN do inventário estão em `tabelas_comissao` do convênio (via
  `resolverOfertasRefin`); as que vêm sem tabela não aparecem na lista.
- **Ofertas sem `tabela_comissao_id` no atendimento (decisão 8):** `origem = 'simulacao_online'` **sempre** aparece
  (nos dois modos e mesmo com aviso de "sem tabela elegível"). As demais sem tabela (REFIN de inventário, import)
  aparecem **só no modo `todas`**. No modo `somente` elas não contam para evitar o aviso: lead que só tem esse tipo
  de oferta recebe o aviso.
- E2 (atendimento): o passo 2 precisa de `tabelas_comissao(id,is_active,deleted_at,vigencia_inicio,vigencia_fim)`
  por `in(tabelaIds)`. Dá para fundir com a consulta da E1.

---

## 5. UX

### 5.1 Entrega 1, etapa "Visão de Oferta"
a) Select "Ordenamento de Ofertas no Atendimento": **"Maior rentabilidade"** como 1ª opção. Ajuda abaixo:
"Prioriza o maior repasse para você em R$ (comissão, emissão e seguro, quando houver); em empate, o maior valor
liberado ao cliente." As demais opções seguem
iguais.
b) Bloco **"Prazo das ofertas"**: dois inputs numéricos, "Prazo mínimo (meses)" e "Prazo máximo (meses)",
placeholders "sem limite". Erro inline se min > max: "O prazo mínimo não pode ser maior que o máximo." e "Avançar"
desabilitado. Ajuda: "Ofertas fora desse intervalo não aparecem no Atendimento. Ofertas sem prazo informado
continuam aparecendo."
c) **"Ver mais" vira o padrão fixo do Atendimento, sem opção na campanha.** Motivo: não cria campo nem schema, não
cria mais uma decisão para o gestor, e os limites "por IF" e "por forma" já controlam quantas ofertas existem; o
"Ver mais" só decide quantas aparecem abertas. Em `OfertasAccordion`, cada forma mostra a 1ª oferta (a de
`destaque`, `:72`) e, se houver mais, um botão **"Ver mais N oferta(s)"** / **"Ver menos"**. O estado é local por
forma.
- Aviso no accordion quando o filtro de prazo zerou tudo e havia ofertas: "Nenhuma oferta dentro do prazo
  {min}–{max} meses definido nesta campanha."
- Nenhum valor de repasse aparece no card.

### 5.2 Entrega 2, etapa nova "Seleção de Tabelas"
Ordem: Filtros · Atendentes · [Disparo] · **Seleção de Tabelas** · Visão de Oferta · Revisar (6 etapas no disparo,
5 nos outros tipos; `PassoChave` ganha `'selecaoTabelas'`).
- Título "Seleção de Tabelas". Subtítulo: "Opcional. Por padrão a campanha trabalha com todas as tabelas. Use só
  para condição especial (uma tabela ou um grupo)."
- Barra global: contador **"Todas as tabelas (N)"** no modo `todas`, ou **"{k} de {N} tabelas selecionadas"** no modo
  `somente`; botões **"Marcar todas"** (volta para `todas`) e **"Desmarcar todas"**.
- Seções recolhíveis por IF (logo + nome + "{k}/{n}"). Dentro de cada uma:
  - Filtros locais: chips de **Forma de contrato** (do conjunto da seção), **Prazo** mín./máx. e busca por texto
    (nome/oferta/código).
  - Botões **"Marcar visíveis"** / **"Desmarcar visíveis"** (agem só nas linhas que o filtro mostra).
  - Lista única com checkbox. Linha: descrição da tabela (`oferta`/`nome`), forma, convênio, prazos (ex.:
    "84–96x" ou a lista), chip informativo "Com seguro"/"Sem seguro" (**não é filtro**), chip "Vencida" (desabilitada)
    quando for o caso.
- Desmarcar qualquer linha → modo `somente` com o resto. Marcar todas as linhas manualmente **não** volta para
  `todas`, só o botão "Marcar todas" volta (mantém a semântica "tabela nova não entra").
- Abaixo de "Selecionadas", a chave **"Se um lead não tiver nenhuma tabela desta seleção"**: (•) "Deixar sem oferta e
  avisar o atendente" (padrão) / ( ) "Mostrar as ofertas das outras tabelas". Só aparece no modo `somente`.
- Vazio (nenhuma tabela para os leads filtrados): "Nenhuma tabela vigente encontrada para os convênios dos leads
  filtrados. A campanha seguirá com as ofertas já calculadas de cada lead." "Avançar" livre.
- Carregando: skeleton por seção. Erro: "Não foi possível carregar as tabelas. Tente de novo." + botão.
- "Avançar" livre, exceto `somente` com 0 itens.
- A Visão de Oferta (etapa 5) ganha uma linha de contexto: "Aplicada sobre: Todas as tabelas" ou "Aplicada sobre
  {k} tabela(s) selecionada(s)".

**Atendimento (E2):**
- `avisoOfertas = 'sem_tabela_elegivel'` → caixa âmbar no lugar do accordion: "Sem tabela elegível nesta campanha
  para este lead. Fale com o gestor da campanha."
- `tabelasIgnoradas > 0` → rodapé discreto: "{n} oferta(s) ocultas por tabela vencida ou inativa."

### 5.3 Revisar (E1 + E2)
Card "Resumo das ofertas" (leitura) acima de nome/descrição:
- "Tabelas: Todas as tabelas" | "{k} tabela(s) selecionada(s) · sem tabela elegível: avisar/usar as outras"
- "Ordenamento: Maior rentabilidade"
- "Prazo: 84 a 96 meses" | "Prazo: sem limite"
- "Por IF: 4 · Por forma: 4 · Seguro: Ambas"
- "Ordem: Refinanciamento → Empréstimo Novo → Cartão RMC → Cartão RCC"

---

## 6. Plano de fatias (executor Sonnet, salvo indicação)

Worktree própria no `brs-alvoconsig` (CRM). Nenhuma fatia toca no `brs-workspace`, exceto a dependência externa
(fatias 1+2 do plano de comissionamento, já com dono e modelo definidos lá).

**F1, config + prazo + Ver mais (sem repasse).**
Arquivos: `lib/crm/visao-oferta.ts`, `lib/crm/visao-oferta.test.ts` (novo), `components/crm/campanhas/NovaCampanhaWizard.tsx`,
`components/crm/atendimento/OfertasAccordion.tsx`.
- `prazoMin/prazoMax` no tipo, na normalização e no filtro em `agruparOfertasParaAccordion`; inputs + validação no
  assistente; "Ver mais"; resumo em Revisar.
- Aceite: campanha antiga (`config.visaoOferta` sem os campos) renderiza igual a antes; min>max bloqueia o Avançar;
  oferta com prazo nulo continua visível; `npm test` e `npm run typecheck` verdes.
- Testes: normalização (ausente → null, troca de min>max, fora de 1..420 → null); filtro de prazo; prazo nulo mantido.

**F2, ordenamento por rentabilidade (servidor).** *Revisão Opus obrigatória (segurança/dinheiro).*
Arquivos: `lib/crm/comissionamento-repasse.ts` (cópia + teste), `lib/crm/rentabilidade.ts` (novo, sem diretiva),
`lib/crm/rentabilidade.test.ts`, `lib/crm/atendimento-actions.ts` (`montarLeadResumo`), `lib/crm/atendimento-types.ts`
(`posicaoRentabilidade`), `lib/crm/visao-oferta.ts` (novo valor + `ordenarOfertas` usando a posição;
`VISAO_OFERTA_PADRAO.ordenamento = 'maior_rentabilidade'`, decisão 5), `NovaCampanhaWizard.tsx` (opção + padrão
inicial). Se cair no modo provisório: também `lib/crm/rentabilidade.provisorio.test.ts`. Atualizar os comentários desatualizados (`visao-oferta.ts:32-37`,
`atendimento-shared.ts:172-177`).
- **Passo 0:** fazer a verificação de §2.4 e registrar no PR qual modo foi usado (oficial ou provisório).
- `rentabilidade.ts` exporta: a função pura `repasseOfertaReais(oferta, linhaPrazo, insumos) → number | null` (soma
  comissão + emissão + seguro de §2.3; null = desconhecido), a função pura
  `ordenarPorRentabilidade(ofertas, porId) → Map<id, posicao>` e o loader
  `carregarInsumosRepasse(admin, agenteParceiroId, tabelaIds)` (oficial pela view ou `insumosRepasseProvisorio`, §2.4).
- Aceite:
  - (a) `grep -rn "rentabilidade\|comissionamento-repasse" apps/web/src` não mostra import em arquivo `'use client'`
    nem export a partir de arquivo `'use server'`;
  - (b) a resposta de `GET /api/crm/atendimento?resource=resumo` não contém as chaves `comissao`, `repasse`, `spread`,
    `imposto`, `liquido`, `percentualRepasse` (conferir no DevTools e por teste);
  - (c) campanha com `menor_valor` não dispara as consultas novas.
- Testes mínimos (`node:test`, no padrão de `disparo.test.ts`):
  - `repasseParceiro`: entrada 3 / imposto 50 / spread 2 → 0; imposto null → 0; spread null → 0; spread 0 → 0;
    pct null → 0; caso Santander normal → valor.
  - `repasseOfertaReais` (componentes):
    - só comissão percentual → `liq × pct/100 × valor/100`;
    - comissão `fixo` → R$ direto, sem multiplicar pelo valor;
    - só emissão → `emissao × (1−imp/100) × pct/100`, **sem** spread;
    - seguro percentual numa oferta com `comSeguro=true` → entra; mesma linha com `comSeguro=false` ou `null` → não
      entra;
    - seguro `forma_pagamento_seguro` nulo → tratado como percentual; `fixo` → R$ direto;
    - spread maior que o líquido da comissão + emissão presente → comissão 0, soma = só emissão (> 0);
    - `repasseCalculavel=false` com as 3 partes preenchidas → 0 (conhecido);
    - imposto null → 0 nas 3 partes;
    - linha com as 3 partes nulas → null (desconhecido);
    - sem linha de prazo → null.
  - Ordenação: maior R$ vence mesmo com % menor (ex.: 2% de 10.000 > 3% de 5.000); a soma com emissão inverte uma
    ordem que só a comissão daria; empate em R$ → maior valor; empate total → maior prazo → id; repasse 0 antes de
    desconhecido; sem `tabela_comissao_id` → desconhecido; `faixa_percentual` fora da faixa → desconhecido; prazo fora
    de `prazo_inicial..final` → desconhecido.
  - Provisório (só se aplicável): os casos de §2.4 (promotora → 0; IF sem imposto → 0; sem spread/spread 0 → 0) e o
    teste de comparação com `test.skip` até o oficial existir.
  - Payload: monta `OfertaCard[]` a partir de insumos com comissão e confere com
    `JSON.stringify(...)` que nenhuma das chaves proibidas aparece, e que `posicaoRentabilidade` é inteiro.

**F3, Seleção de Tabelas: config + servidor do atendimento.** *Revisão Opus (regra de falha fechada).*
Arquivos: `visao-oferta.ts` (`selecaoTabelas`, `semTabelaElegivel`, normalização), `campanhas-actions.ts` (validação na
criação: `somente` com 0 → erro "Selecione ao menos uma tabela ou marque todas."),
`atendimento-actions.ts` (passos 2-3 de §4), `atendimento-types.ts` (`avisoOfertas`, `tabelasIgnoradas`),
`OfertasAccordion.tsx`/`PainelLead.tsx` (avisos).
- Aceite: campanha sem `selecaoTabelas` = `todas`; vencida some nos dois modos; `somente` sem casamento → aviso
  (padrão) ou fallback (chave ligada).
- Testes: função pura `aplicarSelecao(ofertas, tabelasMeta, config)`:
  - `todas` + tabela nova → aparece;
  - `somente` + tabela nova → não aparece;
  - vencida → some nos dois modos e é contada;
  - `somente` sem casamento + `aviso` → `[]` + aviso;
  - mesmo caso + `fallback_geral` → conjunto geral;
  - oferta sem `tabela_comissao_id`: `simulacao_online` aparece nos dois modos; REFIN/import sem tabela só em
    `todas` (decisão 8);
  - oferta com estágio ≠ disponível aparece mesmo fora da seleção, do prazo, do seguro e dos limites (decisão 7; a
    regra de limites fica em `agruparOfertasParaAccordion`, com teste em `visao-oferta.test.ts`).

**F4, Seleção de Tabelas: etapa do assistente.**
Arquivos: `campanhas-actions.ts` (nova action `listarTabelasParaSelecao(filtros, redistribuir)`, com
`exigirEditarCampanhas` e escopo `agente_parceiro_id`, que devolve **só** id, descrição, forma (produto), IF, logo,
convênio, prazos, `com_seguro`, `vencida`; **sem nenhuma coluna de comissão**), `NovaCampanhaWizard.tsx` (etapa,
estado, limpeza ao mudar filtros, Revisar). Se o assistente crescer demais, extrair
`components/crm/campanhas/SelecaoTabelas.tsx` (um componente só).
- Aceite: padrão "Todas as tabelas (N)" com Avançar livre; desmarcar → `somente`; "Marcar todas" → `todas`;
  "Marcar/Desmarcar visíveis" respeitam o filtro da seção; mudar o convênio na etapa 1 limpa ids e mostra o aviso;
  reaproveitar campanha restaura a seleção.
- Teste: função pura do reducer da seleção (toggle, marcar/desmarcar visíveis, marcar todas, limpeza por ids
  ausentes, `somente` vazio → `todas` com aviso).

Ordem: F1 → F2 → (merge/deploy da Entrega 1) → F3 → F4 → (merge/deploy da Entrega 2). F2 **não espera** o Workspace
(decisão 1: usa o oficial se já estiver na main, senão o provisório de §2.4); F1 não depende de nada. Revisão final pré-merge de cada entrega: Opus (Fable só se
houver migration, e não há).

---

## 7. Decisões fechadas (Bruno, 02/10/2026)

1. **Subir já.** As tabelas ativas para o CRM estão corretas. O que falta na main do Workspace é **código**
   (`repasseParceiro`, view `tabelas_comissao_publicacao`, imposto da promotora, trava `spread > 0`). O executor da
   F2 verifica primeiro (§2.4). Com o oficial na main, usa o oficial. Sem ele, usa o provisório exatamente como em
   §2.4, marcado como dívida `PROVISORIO-REPASSE`, com o teste de comparação provisório × oficial (igualdade sem
   promotora; provisório ≤ oficial com promotora).
2. **Comissão em valor fixo (`fixo`/`faixa_fixo`)** = repasse direto em R$, sem multiplicar pelo valor liberado.
3. **A rentabilidade soma comissão + emissão + seguro**, quando houver cada parte (§2.3):
   - comissão com spread;
   - emissão (R$ fixo) e seguro (percentual ou fixo) só com imposto, sem spread;
   - pendência da tabela zera as três partes;
   - o seguro só entra em oferta com `comSeguro === true`. Em "Sem seguro" ele nunca entra; com `comSeguro` nulo
     também não.
   - Observação mantida: no REFIN, `valor_liberado` é o troco (decisão (a) inalterada).
4. **O CRM nunca exibe R$ ou % de repasse**, para ninguém (gestor ou atendente). O browser recebe só
   `posicaoRentabilidade`. A visão com valores é do usuário master, no Portal Parceiro. Nenhuma chave nova em
   `PERMISSOES_CRM`.
5. **Lead sem campanha** usa "Maior rentabilidade" como padrão (`VISAO_OFERTA_PADRAO`).
6. **Sem remapear ids** de tabela no modo "somente estas". Id que muda leva ao aviso "sem tabela elegível" até a
   campanha ser recriada.
7. **Oferta em negociação** (estágio ≠ `ofertas_disponiveis`/`reavaliar_ofertas_disponiveis`) sempre aparece,
   ignorando seleção, prazo, seguro e limites.
8. **Ofertas sem `tabela_comissao_id`:** `simulacao_online` sempre aparece; as demais (REFIN de inventário, import)
   só no modo "todas".
9. **Seguro:** o percentual do seguro incide sobre o VALOR LIBERADO (mesma base da comissão) — confirmado pelo
   Bruno em 02/10/2026.
