# Handoff para revisão seletiva do Astra — CRM AlvoConsig, 09–14/09/2026

> Cobre tudo que entrou no `brs-alvoconsig` (e as migrations correspondentes
> no `brs-workspace`) desde a última revisão do Astra até agora. Repos:
> `brs-alvoconsig` (`apps/web` = CRM Next.js na Vercel; `services/engine` =
> ponte Baileys/Chatwoot no Railway) e `brs-workspace` (só as migrations do
> Supabase compartilhado que sustentam essas features).
>
> Estrutura pedida pelo Bruno: (1) o que mudou desde a última revisão,
> (2) o que está publicado, (3) o que foi efetivamente testado — e, por
> separação, o que NÃO foi.

## 0. Ponto de partida

Última revisão do Astra encontrada no histórico: commit `4b889d8`
("2537 rodada 2 (revisão Astra)"), **09/09/2026 23:20**. Tudo a partir daí
(`4b889d8..HEAD` no `brs-alvoconsig`, `HEAD` = `7845402`) é o escopo deste
handoff: **28 commits**, 09/09 23:20 → 14/09 14:46.

Nesse meio tempo o Fable cobriu revisão em dois pontos (marcados abaixo como
"já revisado") enquanto o Astra estava sem créditos (`astra-sem-creditos-
fable-revisor`), mas a maior parte do período — em especial os dois últimos
dias — **não teve revisão nenhuma além do próprio autor**. É onde eu
concentraria a atenção seletiva.

## 1. O que mudou, por bloco

### 1.1 Conexão/LID (09–11/09) — PARCIALMENTE revisado

| Commit | O quê |
|---|---|
| `50d809f` | LID: rota de leitura autorizada (onWhatsApp) pra correlacionar com retries |
| `3122172` | Rolagem: conta mensagens novas por conjunto de chaves, não por posição |
| `eb510a8` | Alias LID↔telefone: grava o que já vem de graça (best-effort) |
| `91e364a` | Engine: instância nunca mais fica presa em "conectando" (timeout em `fetchLatestBaileysVersion`) |
| `ec93a36` → `4fe14ce` | Rota temporária de teste de endereçamento LID×telefone (criada e removida no mesmo dia) |
| `76eafbc` | Engine: erro de stream sem código (500) não apaga mais o pareamento |
| `6a6c93b` | Engine: socket substituído não sobrescreve mais o estado do novo dono |
| **`868b8cd`** | **Revisão Fable** desta rodada — 4 correções (vigia não respeitava reconexão desativada, entre outras) |

Tudo até `6a6c93b` foi coberto pela revisão do Fable em `868b8cd`. **A partir
daqui, nada mais no bloco de conexão foi revisado por ninguém além do autor:**

| Commit | O quê | Risco |
|---|---|---|
| `eaeba5b` (11/09) | **Vínculo lead↔conversa nunca era gravado**: `upsert({...}, {onConflict:'id'})` estourava NOT NULL porque o Postgres valida a linha candidata ANTES de checar o conflito. Causou 143 erros em produção na homologação de 11/09 e atendentes vendo "conversa fora da carteira" nos próprios leads. Corrigido pra UPDATE condicional. | Foi um bug real em produção, achado pelo Bruno — merece checagem de que não há outro `upsert` com o mesmo padrão (`onConflict:'id'` com coluna NOT NULL fora do payload). |
| `0fa9b87` + `eb47f49` (11/09) | Alias LID↔telefone: inbound por `@lid` sem `sender_pn` passa a cair na conversa do telefone (memória em processo + tabela `chat_contato_alias`, best-effort). Achado real: 3 de 5 leads externos testados na homologação viraram conversa órfã na 2ª resposta. | Toca diretamente em pra-quem-vai-a-resposta; nunca teve segundo par de olhos. |

### 1.2 Chat interno — performance + solicitações (12–13/09) — PARCIALMENTE revisado

| Commit | O quê |
|---|---|
| `f87efee` | Mata o N+1 do poll de 10s (RPC `crm_chat_resumo_canais`) + solicitação de simulação vira registro de verdade |
| **`780f09d`** | **Revisão Fable** sobre `f87efee` — achou a causa raiz real do "1 POST/s" (loop em `useToasts`, não o poll), recursão no `removeChannel()` do Realtime, ordem do CAS |

`462a51c` (13/09, "Chat interno v2": mídia — arquivo/imagem/colar/áudio/
emoji/figurinha —, solicitação sem lead + anexos, botão sai do chat) **veio
depois da revisão do Fable e nunca foi revisado por ninguém.**

### 1.3 Plano v3 — disparo, atendimento, instância, simulação, figurinhas, conversa única (13–14/09) — NÃO revisado

Bloco inteiro sem segunda revisão (o Fable só cobriu as migrations em
`03691e8`, não o código do `apps/web`/`services/engine` abaixo). É o maior
bloco do período — 13 commits em ~2 dias, um deles (`0788bc2`) já é a
correção de um bug do commit anterior (`10d0183`) pego em produção 20 min
depois do deploy:

| Commit | O quê | Nota |
|---|---|---|
| `10d0183` | Elegibilidade de disparo (aquecimento 48h, fail-closed com pausa/re-rota), atribuição automática da conversa de disparo | — |
| **`0788bc2`** | **Correção do próprio `10d0183`**: aquecimento media a partir de `conectada_em` (carimbo de posse do socket, reescrito em TODO deploy) em vez de `pareada_em` — o deploy de 14/09 01:13 UTC travou os 8 números em "aquecimento" de uma vez, e a liberação manual do operador seria apagada pela próxima queda/deploy | Achado e corrigido no mesmo dia; área sensível (mexe com dinheiro/campanha real), sugiro prioridade alta |
| `e8d986a` | §2.1: `podeAgirNaConversa` vira definição única de "é minha" (antes leitura e resposta usavam critérios diferentes) | — |
| `1e1cc58` | §2.3: abas Meus/Fila/Campanha; Fila nunca mostra disparo mesmo sem dono | — |
| `77ec9e0` + `670e75f` | §3.3–3.5: motivo de reconexão, cadastro do chip, card com mostradores/recargas/histórico, liberar para disparo (backend + tela) | — |
| `a8ca8bd` | §4: simulação v3 (forma parcela×valor liberado, máscara monetária, IF no lugar do texto livre) | — |
| `533c2f9` + `8e25a05` | §5: figurinhas — biblioteca do parceiro + proxy GIPHY (chave no Workspace) | — |
| `39a2dac` | Modal por portal (`createPortal`) — corrige janela presa atrás de card com `backdrop-blur` | Achado pelo Bruno via screenshot |
| `2bc0ef4` | **§6, o mais delicado**: "uma conversa por lead" — quando o rodízio troca de número, adota a conversa existente em vez de abrir outra; muda a regra de qual instância manda a resposta | Ver §3 abaixo — teste real de troca de número NUNCA foi feito |
| `f54d57c` + `7845402` (14/09, hoje) | Bug reportado pelo Bruno: modal "Solicitar simulação" aberto do Atendimento não trazia CPF/nascimento/margens do lead; depois, filtro de Instituição Financeira pelo convênio do lead (decisão do Bruno: só tabela com convênio explícito) | Meus commits desta sessão, sem segundo par de olhos ainda |

### 1.4 Migrations no `brs-workspace` (mesmo escopo, todas aplicadas segundo os commits)

| Migration | Sustenta |
|---|---|
| `20260911222625_chat_contato_alias.sql` + `20260911223100_..._seed_homologacao_disparo.sql` | Alias LID↔telefone (1.1) |
| `20260913021429_crm_chat_resumo_canais.sql` + `20260913021650_..._cast_seguro.sql` | RPC de performance do chat interno (1.2) |
| `20260913165513_crm_solicitacoes_sem_lead_e_anexos.sql` | Solicitação sem lead + anexos (1.2) |
| `20260913213348_operadoras_telefonia.sql`, `20260913213349_chat_instancias_ciclo_vida.sql`, `20260913213350_crm_chat_figurinhas.sql`, `20260913213351_chat_conversa_checkpoints.sql`, `20260913213844_giphy_config.sql` | Ciclo de vida da instância, figurinhas, checkpoint (1.3) |
| `20260913221955_chat_instancias_pareada_em.sql` | Correção do aquecimento (`0788bc2`) |

Não estão no escopo (pertencem ao Workspace/BRS Messenger interno, sistema
diferente): `20260913222218_realtime_praise_chat_interno.sql`,
`20260914091154_realtime_chat_status_reacoes.sql`, e tudo de Convênio/Base
de Conhecimento e Averbadoras do mesmo período.

## 2. O que está publicado agora

- **Vercel (`brs-alvoconsig`, produção):** deployment `dpl_DC8Luv4h9Rb6ZsXopDByXoPGXRJM`,
  `READY`, commit `7845402` (`HEAD` de `main`) — ou seja, **todo o bloco
  acima está no ar**, nada ficou represado em branch.
- **Railway (`engine`, produção):** deployment `368e791e-8520-4ada-8406-
  66a919206a5c`, `SUCCESS`, criado 14/09 15:16 UTC — corresponde ao último
  commit que tocou `services/engine` no período (`2bc0ef4`, §6). Os 3
  commits seguintes (`f54d57c`, `7845402`) só tocam `apps/web`, então não
  exigiam novo deploy do engine.
- **Migrations:** aplicadas segundo o texto de cada commit/plano (não
  reconsultei o banco agora — não tenho acesso MCP ao Supabase deste
  projeto nesta sessão, só ao do CLT-orchestrator). Se o Astra tiver esse
  acesso, vale conferir `supabase migration list` antes de revisar o código
  que depende delas.

## 3. O que foi efetivamente testado — e o que não foi

**Automatizado:** suíte única (`node scripts/test.mjs`, engine+web juntos)
em **288/288** no commit mais recente. Cresceu ao longo do período conforme
cada commit — a maioria da lógica pura ganhou teste ao lado (`disparo.ts`
8 testes, `conversa-unica.ts` 7, `alias-lid`/`bridge-alias-lid` 6+4,
`ehConversaMinha`/`ehConversaDeFila` 6, `autorizacao-agir` 4, etc.). Typecheck
e lint limpos em todo commit.

**O que ficou de fora do automatizado, por design do repo** (convenção já
observada em revisões anteriores: lógica pura ganha teste, UI e chamada a
banco não): os commits só-de-tela (`670e75f`, `39a2dac`, partes de `8e25a05`,
`f54d57c`, `7845402`) subiram com "nenhum teste novo" declarado no próprio
commit — validados por typecheck+lint+suíte-não-quebrou, não por asserção
nova.

**O que NÃO foi validado por um humano de verdade usando o sistema** (nenhum
item abaixo teve alguém clicando como usuário real, além do Bruno pegando o
bug visual do modal por screenshot):

- **§6 "uma conversa por lead" (`2bc0ef4`)** — o próprio plano exige um teste
  de envio cruzado com 2 números de disparo reais + 1 celular pessoal antes
  de confiar nisso; **nunca foi feito**, documentado como pendência explícita
  no plano v3 §12.
- **Chat interno v2 (mídia, solicitação sem lead)** — conforme a última
  memória registrada (13/09 16h), 0 acessos às telas desde o deploy, 0
  solicitações, 0 mensagens de simulação.
- **Simulação v3, figurinhas/GIPHY, tela de instância (ciclo de vida)** —
  só chegaram ao ar nas últimas 24-30h; sem relato de uso real ainda.
- **Os dois bugs corrigidos hoje (CPF/nascimento/margens e filtro de IF por
  convênio)** — corrigidos e cobertos pela suíte existente, mas ninguém abriu
  o modal de verdade depois da correção pra confirmar visualmente. O filtro
  por convênio em particular depende da qualidade dos dados em
  `tabelas_comissao` (convênio explícito vs. em branco) — vale conferir com
  o Bruno se o cadastro real reflete a decisão ("só convênio explícito").

## 4. Onde eu pediria ao Astra pra olhar com lupa, em ordem de risco

1. **`services/engine/src/conversa-unica.ts` + `garantirConversa` em
   `bridge.ts`** (`2bc0ef4`) — decide por qual número uma resposta sai; erro
   aqui manda mensagem pelo número errado ou perde histórico. Zero teste real
   de troca de número ainda.
2. **`apps/web/src/lib/crm/disparo.ts` (`avaliarElegibilidadeDisparo`) e o
   par `10d0183`/`0788bc2`** — já teve um bug pego em produção no mesmo dia;
   mexe com campanhas reais e pausa fail-closed.
3. **`resolverLeadsDasConversas` (`eaeba5b`)** — o padrão de upsert que
   causou o bug (`onConflict:'id'` com coluna NOT NULL fora do payload) pode
   se repetir em outro lugar; vale um grep dirigido.
4. **Alias LID↔telefone (`0fa9b87`/`eb47f49`)** — cache em memória por
   processo + tabela best-effort; conferir o que acontece se os dois
   processos do Railway (deploy com sobreposição) divergirem no alias.
5. **`listarInstituicoesFinanceirasAtivas` com filtro por convênio
   (`7845402`, hoje)** — código novo sem segundo par de olhos; a query faz
   `!inner` join com `tabelas_comissao`, vale conferir se a policy/RLS do
   `financial_institutions` não bloqueia o `service_role` nesse padrão.

## 5. Decisões deliberadas (não são bugs)

- Filtro de Instituição Financeira por convênio é **estrito**: tabela de
  comissão com convênio em branco ("genérica") não conta, mesmo que a IF
  atenda esse convênio na prática. Decisão explícita do Bruno em 14/09.
- `chat_conversas.instancia_id` deixou de ser só espelho do inbox do
  Chatwoot — agora é a fonte de verdade de "qual número atende"; qualquer
  código novo que precisar disso deve ler daí, nunca do `inbox_id`.
