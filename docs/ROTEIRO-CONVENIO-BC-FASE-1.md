# ROTEIRO — Convênio Base de Conhecimento, Fase 1 (núcleo) — execução Sonnet

> Spec-mãe: `docs/SPEC-CONVENIO-BASE-CONHECIMENTO.md` (ler §0, §2.1–2.8, §3, §7.1, §9).
> Schema: migration `20260910002812_convenio_bc_fase1.sql` (APLICADA). Nenhuma
> permissão nova nesta fase — tudo sob `workspace-convenios`.
> Worktree: `../brs-workspace-convenio-bc` (branch `convenio-bc/fase-1`).
> Padrões: server actions `'use server'` com `createAdminClient()` + `requirePermission`
> como em `convenios/actions.ts`; UI segue `averbadoras/page.tsx` e o editor de
> IF (`instituicoes-financeiras/_components/InstituicaoEditor.tsx`).

## Entregáveis (nesta ordem)

### (a) Cadastros de apoio — `convenios/cadastros-actions.ts` + 2 páginas

1. **Públicos Atendidos** — `/convenios/publicos/page.tsx`. Tabela `publicos_atendidos`.
   Actions: `getPublicos()`, `salvarPublico({id?, nome, situacao_funcional, regime_juridico,
   tipo_provimento, descricao})`, `setPublicoStatus(id, ativo)`, `getPublicosAtivos()`.
   Os 3 campos classificatórios são `<input list=…>` com datalist dos valores distintos
   já gravados (action `getPublicosSugestoes()` devolve `{situacoes[], regimes[], provimentos[]}`).
   23505 → "Já existe um público com esse nome."
2. **Órgãos / Empregadores** — `/convenios/orgaos/page.tsx`. Tabela `orgaos_empregadores`.
   Lista global com coluna Convênio-pai + filtro por convênio. Actions: `getOrgaos(convenioId?)`,
   `salvarOrgao({id?, convenio_id, nome, cnpj?, observacao?})` (CNPJ só dígitos, 14, opcional;
   busca CNPJ.ws opcional como em averbadoras), `setOrgaoStatus`, `getOrgaosAtivos(convenioId)`.
   Soft delete via `is_active` (não usar deleted_at na UI).
3. Sidebar: em `src/lib/nav/divisoes.ts`, sob Convênios, acrescentar os filhos
   "Públicos Atendidos" (`/convenios/publicos`) e "Órgãos / Empregadores" (`/convenios/orgaos`),
   ambos `perms: [view('workspace-convenios')]`. `permissions.ts` já cobre por prefixo `/convenios`
   — conferir que o prefixo existe na lista (linha ~236) e não criar chave nova.

### (b) Convênio em tela cheia — `/convenios/novo` e `/convenios/[id]`

4. **Listagem** (`convenios/page.tsx`): "Novo" → `router.push('/convenios/novo')`; "Editar" →
   `/convenios/[id]`. Remover o modal de cadastro (o formulário migra para o componente abaixo).
   Acrescentar colunas **Abrangência** e **Completude BC** (`bc_score` 0–100 vindo de
   `getConvenios`: +25 público, +25 formas, +25 instituições, +25 teto/prazos informados —
   Fase 2 acrescenta decretos/FAQ, renormaliza).
5. **Componente** `convenios/_components/ConvenioEditor.tsx` (client) com duas abas no topo:
   **Dados Básicos** | **Base de Conhecimento** (BC desabilitada em `/novo` até salvar; ao salvar
   em `/novo`, `router.replace('/convenios/<id>?aba=bc')`).
   - *Dados Básicos*: o formulário atual do modal, inteiro (CNPJ.ws, tipo→esfera, cidade/UF/CEP,
     averbadora/site/autenticação, códigos) + novos campos `endereco` (ViaCEP sugere ao sair do
     CEP se vazio), `numero_servidores`, `abrangencia` (select municipal/estadual/nacional; ao
     trocar o tipo, sugerir pela esfera só se o usuário não mexeu). `salvarConvenio` em
     `convenios/actions.ts` ganha esses campos.
   - *Base de Conhecimento*: sub-abas (estado em `?sub=`): **Público** · **Formas & Margens** ·
     **Instituições** · **Órgãos / Restrições**. Cada sub-aba salva a SUA seção (botão Salvar
     próprio), nunca o convênio inteiro.
6. **Actions BC** — novo arquivo `convenios/bc-actions.ts` (RESOURCE `workspace-convenios`):
   - `getConvenioBc(convenioId)` → `{ geral: {max_comprometimento_salarial, prazo_minimo_geral,
     prazo_maximo_geral, bc_observacoes}, publicos: [{publico_id, observacao}],
     formas: [{forma_contrato_id, percentual_margem, observacao}],
     instituicoes: [{id, financial_institution_id, canais_quitacao, modo_orgaos, observacao,
     is_active, publicos: uuid[], orgaos: uuid[], formas: [{forma_contrato_id, margem_considerada,
     prazo_minimo, prazo_maximo, publicos_restritos: uuid[]|null, observacao}]}] }`.
   - `salvarConvenioBcGeral(convenioId, geral)` → `update convenios` (teto/prazos/observações).
     Antes de gravar, **revalidar filhos** (R1, R4, R5) e, se algo ficar inconsistente, devolver
     `{success:false, error, inconsistencias: string[]}` sem gravar — a UI lista e pede ajuste.
   - `salvarConvenioBcSecao(convenioId, secao: 'publicos'|'formas'|'instituicoes', payload)` →
     valida R1–R6 em TypeScript com mensagens amigáveis (a trigger é só rede de segurança; se
     ela estourar, traduzir `check_violation` → mostrar `error.message` que já vem em PT) e chama
     `supabase.rpc('convenio_bc_salvar_secao', { p_convenio_id, p_secao, p_payload })`.
   - Listas de apoio: `getFormasContratoAtivas()` (tabela `formas_contrato`, `is_active`),
     `getInstituicoesAtivas()` (`financial_institutions` `is_active` e `deleted_at is null`,
     campos `id, name, logo_url`), reutilizar `getPublicosAtivos`, `getOrgaosAtivos`.

### (c) Sub-abas (UX mínima aceitável)

7. **Público**: bloco "Teto e prazos gerais" (teto %, prazo mín/máx, observações → seção geral)
   + checklist de públicos ativos com campo observação por item (→ seção publicos).
8. **Formas & Margens**: tabela com todas as `formas_contrato` ativas, checkbox "permitida",
   input % margem (só habilitado se permitida), observação. Rodapé mostra **soma × teto** ao
   vivo (vermelho se exceder). → seção formas.
9. **Instituições**: topo = **matriz IF × Forma** (linhas: IFs vinculadas; colunas: formas
   permitidas do convênio; célula = margem% / prazo ou "—"). Abaixo, lista de vínculos com
   "Adicionar IF" (select das ativas ainda não vinculadas). Ao expandir um vínculo:
   canais de quitação (tag-list), público atendido (checklist SÓ dos públicos do convênio; vazio
   = "atende todos"), restrições de órgãos (select `modo_orgaos` + checklist dos órgãos do
   convênio + botão "cadastrar órgão" que abre modal inline usando `salvarOrgao`), e a grade
   de formas operadas (checkbox por forma permitida; margem considerada ≤ margem do convênio na
   forma; prazos dentro do geral; "restringir público" opcional com checklist ⊆ público do
   vínculo). Salvar → seção instituicoes com o array COMPLETO de vínculos (a RPC remove os que
   saíram). Roteiro operacional NÃO entra nesta fase (Fase 2, como documento).
10. **Órgãos / Restrições**: leitura — lista dos órgãos do convênio e em quais IFs aparecem e em
    que modo; link para `/convenios/orgaos?convenio=<id>`.

### (d) Fechamento

11. `npx tsc --noEmit` limpo; `npm run build` na worktree.
12. Teste manual: criar convênio novo em `/convenios/novo` → cair na BC → preencher público,
    formas com soma > teto (deve bloquear com mensagem) e ≤ teto (salva) → vincular 2 IFs com
    formas diferentes → matriz reflete. Editar teto para abaixo da soma → ação devolve
    inconsistências e não grava.
13. Commit na branch; avisar o Fable para revisão antes do merge.

## Regras de validação (TypeScript, mesmas da trigger)

- R1 soma(percentual_margem) ≤ teto (quando teto informado).
- R2 publicos do vínculo ⊆ publicos do convênio.
- R3 formas do vínculo ⊆ formas permitidas.
- R4 margem_considerada ≤ percentual_margem da forma (quando ambos).
- R5 prazo_minimo ≥ prazo_minimo_geral e prazo_maximo ≤ prazo_maximo_geral (quando ambos).
- R6 publicos_restritos ⊆ publicos do vínculo (ou do convênio se vínculo vazio).
- Mensagens em PT-BR, apontando a IF/forma envolvida.

## Não fazer

- Não criar enum/lista no código para público, forma, esfera ou IF.
- Não expor RPC ou tabelas a `anon`/`authenticated`.
- Não apagar o modal antes de o `ConvenioEditor` cobrir 100% dos campos atuais.
- Não tocar em `usuarios/page.tsx`/`permissions.ts` para criar chave (não há chave nova).
