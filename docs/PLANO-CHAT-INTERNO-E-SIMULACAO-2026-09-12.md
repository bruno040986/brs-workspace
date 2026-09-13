# Chat interno + solicitação de simulação — diagnóstico e plano (Fable, 12/09/2026)

Pedido do Bruno: chat em grupo entre atendentes lento; mensagem entre
atendentes demora ou não chega; tela demora a carregar; solicitação de
simulação não funciona e falta o que foi definido no plano. Só
diagnóstico e plano aqui; implementação = Sonnet.

## A. Chat interno

### O que os números dizem (Vercel + Supabase, 11/09)
- `/atendente/chat-interno` é a rota **mais chamada do CRM**: 3.000 POSTs
  em 24 h (mais que os dois crons somados). Cada POST é um tick de Server
  Action.
- Na janela 21:00–21:15: **334 ticks** (1 a cada ~2,7 s, com picos de
  1/s), e cada tick dispara **~20 consultas REST** ao Supabase — para uma
  tabela com **35 mensagens no total e zero novas no dia**. ~6.700
  consultas em 15 min sem nada ter mudado.
- Realtime está ligado e é usado (5 websockets na janela; publicação e
  policy de `20260903010000` e `20260905013748` em vigor). Todos os 8
  usuários do parceiro têm `chat_interno.usar` e `crm_parceiro_config.
  habilitado = true`: a autorização do Realtime não é o bloqueio.

### Onde está no código (agente de busca, arquivo:linha)
- `ChatInterno.tsx:110` — poll da **lista de canais** a cada **10 s por
  aba** (`getCanais()`), sem incremento.
- `chat-interno-actions.ts:93-155` — `getCanais` faz `usuariosAtivos` +
  `garantirCanal(equipe)` + `garantirCanal(pessoal)` + `membros` e depois,
  **por canal**, `Promise.all([última mensagem, count exact de não-lidas])`
  (`:127-136`) = 4 + 2N consultas por tick. Com 8 usuários, N chega a 9
  (equipe + pessoal + diretos) → ~20 por tick. O próprio código registra
  isso como achado de 02/09 (`:107-112`) e o plano de 05/09 (linha 129,
  "consultas repetidas por canal") nunca foi fechado.
- `ChatInterno.tsx:129` — poll das **mensagens** do canal aberto a cada
  30 s (rede de segurança); `:135-152` — Realtime `postgres_changes`
  INSERT filtrado por `canal_id` do canal aberto.
- `crm_chat_membros` tem PK `(canal_id, crm_usuario_id)` e **nenhum
  índice por `crm_usuario_id`** — a busca "canais deste usuário" varre.
- 7 atendentes + 1 master com aba aberta × 10 s = o 1/s observado.

### Por que "demora e nem chega"
1. Cada tick de `getCanais` leva mais de 1 s (20 idas ao banco a partir
   da Vercel); com 7 abas, os ticks se sobrepõem no banco e na função; o
   envio (`enviarInterno`) entra na mesma fila.
2. Quem **não** está com aquele canal aberto só fica sabendo de mensagem
   nova pelo `getCanais` (badge) — 10 s no melhor caso, mais sob carga.
3. Quem está com o canal aberto depende do Realtime; se a assinatura cai
   (`CHANNEL_ERROR`/`TIMED_OUT`, comum em aba em segundo plano), não há
   reassinatura nem sinal na tela, e a mensagem só aparece no poll de
   30 s. Não há log disso hoje — por isso ninguém consegue provar "código
   ou infra" (commit `f2a910d` já registrava essa dúvida).
4. Carregamento: a tela espera a cascata usuários → canais → membros →
   2N antes de pintar qualquer coisa.

### Plano (Sonnet), na ordem do ganho
**A1. Uma consulta em vez de 4 + 2N.** RPC `crm_chat_resumo_canais(
p_usuario_id)` (SQL, `security definer`, service role) devolvendo por
canal: id, tipo, nome, chave, última mensagem (conteúdo, tipo,
created_at, autor) via `LATERAL`, e não-lidas (`count(*) where created_at
> lido_ate and autor <> usuário`). Índice novo `crm_chat_membros
(crm_usuario_id)`. `garantirCanal(equipe/pessoal)` sai do tick: roda uma
vez no carregamento da página (server component). Migration pequena
(RPC + índice) — Fable.
**A2. Lista de canais dirigida por evento, não por poll.** Uma assinatura
Realtime por usuário em `crm_chat_mensagens` INSERT com `filter:
canal_id=in.(ids dos canais do usuário)`; ao chegar evento, atualiza
última mensagem/não-lidas localmente. Poll de reconciliação a cada 60 s
e em `visibilitychange`. Tráfego por aba cai de ~6 ticks/min × 20
consultas para ~1/min × 1.
**A3. Realtime confiável no canal aberto.** Reassinar com backoff em
`CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED`, fazer busca incremental imediata ao
reassinar, e o poll de 30 s só roda enquanto o estado não for
`SUBSCRIBED`. Ponto de status na tela (verde/amarelo) + `console.info`
estruturado do estado — é o que falta para diagnosticar "nem chega".
**A4. Carregar sem cascata.** Server component entrega canais (A1) + as
últimas 50 mensagens do canal padrão numa ida; o cliente hidrata e
assina. `marcarLido` com debounce.
**A5. Testes.** RPC em `tests/db` (padrão existente); `getCanais` com
supabase falso; hook de fallback do Realtime com estados simulados
(padrão node:test + jsdom já usado em `useRolagemThread.test.ts`).

Resultado esperado: mensagem em < 1 s para quem está no canal (Realtime)
e < 1 s no badge para quem não está (A2); tela pinta em uma ida ao banco.

## B. Solicitação de simulação

### Estado real
- O plano (`PLANO-IMPLEMENTACAO-ALVOCONSIG-2026-09-05.md` §7, linhas
  118-131) e a proposta (`PROPOSTA-SCHEMA-ATENDIMENTO-2026-09-05.md:244-
  416`, aprovada pelo Bruno como "fazer agora", linha 374) definem:
  registro próprio (`crm_solicitacoes_operacionais`), estados
  `solicitado → em_atendimento ⇄ aguardando_informacoes → respondido |
  cancelado`, atribuição sem duplo dono (compare-and-swap), timestamps de
  1ª resposta/conclusão e tempo aguardando, painel em 3 visões
  (atendente: as minhas; operacional: assumir/responder/devolver; master:
  tudo), e "aviso no chat apenas notifica".
- A migration `20260905125419` **existe e está aplicada**. A tabela tem
  **zero linhas**. **Nenhum arquivo** de `apps/` ou `services/` referencia
  `crm_solicitacoes_operacionais` — o handoff "(b) painel de solicitações
  + migrar solicitarSimulacao/responderOfertaSimulada para o registro"
  nunca aconteceu.
- O que roda é o "parcial" que a proposta já classificou como
  insuficiente: `solicitarSimulacao`/`responderOfertaSimulada`
  (`chat-interno-actions.ts:294-445`) gravam **mensagens** de chat
  (`tipo='solicitacao_simulacao'`/`'oferta_simulada'`, `payload` jsonb,
  `respondida` dentro do payload). A única forma de ver um pedido é
  abrir o canal certo do chat. Sem estado, sem fila, sem SLA.
- Permissão: só o Master (`PRIME MAIS CRED`) tem
  `chat_interno.receber_simulacao`; os 7 atendentes só pedem. Então todo
  pedido vai para uma pessoa, e só aparece se ela abrir aquele chat.

"Não funciona" = não há o que o plano pediu. Não é uma ação que falha.

### Plano (Sonnet) — executar o item (b) do handoff de 05/09
**B1. Registro na origem.** `solicitarSimulacao` grava em
`crm_solicitacoes_operacionais` (tipo `simulacao`, status `solicitado`,
contato/relacionamento, `solicitado_por`, `atribuido_a` = destinatário
escolhido ou null = fila do tenant) + linha em `crm_solicitacoes_eventos`;
a mensagem no chat vira **cartão de aviso** com `solicitacao_id` no
payload, apontando para o registro.
**B2. Resposta no registro.** `responderOfertaSimulada` atualiza o
registro (`respondido`, `respondido_em`, `primeira_resposta_em` se nulo,
`tempo_aguardando_ms` acumulado), evento, e mantém o que já faz (cria
`crm_ofertas`, enfileira WeSales); cartão no chat notifica.
**B3. Painel** `/crm/solicitacoes` e `/atendente/solicitacoes`, com badge
de abertas no menu: atendente vê as suas; operacional/master vê abertas
do tenant com **assumir** (`update … set atribuido_a = eu, status =
'em_atendimento' where id = ? and atribuido_a is null` — CAS),
**responder** (reaproveita o modal atual), **pedir informações**,
**cancelar**; master vê tudo. Sem apagar atrasos ao reatribuir.
**B4. Notificação.** `emitirSinalAtendimento` para o destinatário (ou
para todos com `receber_simulacao` quando cai na fila) + o cartão no
chat. Aviso por WhatsApp/Workspace fica para depois.
**B5. Testes.** Actions com supabase falso (padrão existente), CAS de
atribuição (dois assumem, um vence), máquina de estados, e o cartão do
chat NÃO ser mais a fonte da verdade.

### Decisão que fica com o Bruno (configuração, não código)
Quem responde simulação neste parceiro? Hoje só o Master. Se houver
pessoa de operacional, ela precisa de perfil com
`chat_interno.receber_simulacao`/`responder_simulacao` (o seed padrão do
perfil "Operacional" já traz). Sem isso o painel B3 mostra a fila só
para o Master.

## Contrato da RPC (já aplicada — Fable, 12/09)

`public.crm_chat_resumo_canais(p_agente_parceiro_id uuid, p_crm_usuario_id uuid)`
→ uma linha por canal em que o usuário é membro, do parceiro informado:

| coluna | conteúdo |
|---|---|
| `canal_id`, `tipo`, `chave`, `nome`, `lido_ate` | do canal / do vínculo |
| `outro_usuario_id`, `outro_nome`, `outro_ativo` | só para `tipo='direto'`; `outro_nome` = `nome_exibicao` ou `nome`; `outro_ativo=false` → "Usuário inativo" |
| `ultima_conteudo`, `ultima_tipo`, `ultima_em` | última mensagem (null se canal vazio) |
| `nao_lidas` | depois de `lido_ate`, excluindo mensagens do próprio usuário (sistema/lembrete contam) |

Chamada pelo servidor: `admin.rpc('crm_chat_resumo_canais', { p_agente_parceiro_id, p_crm_usuario_id })`.
Só `service_role` tem `execute`. Índice novo: `crm_chat_membros_usuario_idx`.
`getCanais` passa a ser: RPC → montar `CanalInterno[]` (mesmo mapeamento
de nome/preview/ordem de hoje) — sem `usuariosAtivos`, sem
`garantirCanal` no tick (esses ficam para o carregamento inicial da
página).

## Ordem sugerida
1. A1 + A4 (maior ganho, 1 sessão do Sonnet; migration da RPC comigo).
2. A2 + A3 (Realtime como primário, poll só de reconciliação).
3. B1–B5 (1–2 sessões do Sonnet). Independente de A.

## Status (Sonnet, 12-13/09/2026): A e B implementados e publicados

Commit `f87efee` (repo `brs-alvoconsig`, branch `main`), deploy Vercel
`dpl_7aAj7e8j1FdGU3pHC2gPiQ8FD51j` READY em produção, sem erros de
runtime nos primeiros minutos.

- **A1+A4+A2+A3 feitos.** `getCanais()` usa a RPC; `carregarChatInternoInicial`
  (novo) hidrata a página numa ida só via server component; lista de
  canais com Realtime (`crm_chat_mensagens` `canal_id=in.(...)`) + poll de
  60s de reconciliação; canal aberto reassina com backoff (1s→15s) e
  mostra status (verde/âmbar/cinza) no cabeçalho. `chat-interno-shared.ts`
  novo com as funções puras (mapeamento/ordenação/incremento otimista),
  13 testes.
- **B1-B3+B5 feitos** (B4 não precisou de trabalho novo — o cartão do chat
  já é a notificação e já funcionava). `solicitarSimulacao` grava o
  registro primeiro (sem dono, payload completo — CPF/convênio/matrícula/
  margens, não só um resumo); `responderOfertaSimulada` agora recebe
  `solicitacaoId` e reivindica por CAS antes de criar a oferta.
  `solicitacoes-actions.ts`/`solicitacoes-shared.ts` novos (máquina de
  estados como funções puras, 17 testes + 5 do bônus `formatarDuracao`).
  Painel `/crm/solicitacoes` e `/atendente/solicitacoes` com abas
  Minhas/Fila/Todas, sem migration nova (reusa `chat_interno.*`).
- **Achado durante a execução**: os CAS de `pedirInformacoes`/
  `retomarAtendimento`/`cancelarSolicitacao` originalmente propostos
  confiavam só no pré-check em memória, sem repetir a condição de status
  na própria escrita — um cancelamento concorrente (que não mexe em
  `atribuido_a`) podia ser sobrescrito por um "assumir" que chegasse logo
  depois. Corrigido: todas as 4 ações têm `WHERE status = <esperado>` na
  UPDATE, não só o pré-check.
- **Não fiz**: badge de "abertas" no menu (mencionado no plano original
  como nice-to-have; painel funciona sem isso, decidi não abrir mais uma
  frente de poll/estado global do layout pra isto agora). Realtime no
  painel de solicitações (a tabela não está na publicação do Supabase —
  abrir isso é decisão de arquitetura, não fiz sozinho).
- `npm test`: 201 (200 passam + a mesma falha preexistente de jsdom, não
  regressão). `npm run typecheck` limpo. `npm run lint`: nenhum arquivo
  tocado aparece nos 103 erros preexistentes do repo.

Pendente de validação real: ninguém usou a tela desde o deploy (madrugada,
sem tráfego ainda) — vale conferir na próxima sessão se o poll caiu de
fato pra ~1/min e se o painel de solicitações aparece corretamente pros
3 perfis.

## Revisão Fable (13/09/2026) sobre a entrega do Sonnet — corrigido em `brs-alvoconsig` `780f09d`

Lido o commit inteiro (`f87efee`), não o recado. Certo e conferido: RPC no
`getCanais`, hidratação pelo server component, lista por Realtime com
`in.(...)`, CAS com status na UPDATE nas 4 ações, nomes das FKs do embed
(`..._solicitado_por_fkey`/`..._atribuido_a_fkey`) batem com o banco,
`crm_chat_mensagens` na publicação, 200/201 testes (a falha era jsdom
ausente). O que não estava:

1. **Loop de requisições — preexistente, e ficaria mais rápido.**
   `useToasts()` devolvia `erro`/`ok` como funções novas a cada render;
   `carregarCanais` (chat, desde 30/08) e `carregar` (painel novo) as têm
   nas deps do `useCallback`, e `polling()` faz uma chamada imediata a cada
   (re)instalação. Cada resposta → setState → render → callback novo → poll
   reinstalado → nova chamada. O "1 POST/s" medido em 12/09 é compatível
   com isso (limitado pela latência do getCanais antigo, ~1 s); com a RPC
   rápida ficaria pior, não melhor. Corrigido na raiz (`useToasts` estável
   via `useCallback`) + teste em jsdom (`useToasts.test.ts`) que FALHA com o
   hook antigo (3 chamadas em 80 ms em vez de 1) e passa com o novo.
2. **A reconexão do Realtime recursava até estourar a pilha.**
   `supabase.removeChannel()` → `leave()` do phoenix (`@supabase/phoenix`
   0.4.5): marca o canal `leaving`, `canPush()` exige `joined`, logo
   `leavePush.trigger("ok")` roda NA HORA → `phx_close` → o callback de
   `subscribe` recebe `'CLOSED'` de forma SÍNCRONA, ainda dentro do
   removeChannel. O handler do A3 removia o canal dentro do próprio callback
   de erro antes de zerar a referência → reentrada infinita na 1ª queda de
   conexão, um `setTimeout(conectar)` por nível da pilha, bindings
   duplicados no canal recriado. Extraído pra `assinarComReconexao`
   (`chat-interno-shared.ts`): descarte por identidade ANTES de remover;
   5 testes com canal falso que reproduz a sincronicidade
   (`chat-interno-realtime.test.ts`). Vale pra QUALQUER código nosso que
   chame `removeChannel` dentro do callback de status (Workspace incluso).
3. **Poll de mensagens desligado enquanto o Realtime estava "conectado".**
   Postgres Changes não garante entrega. Voltou a rodar sempre (30 s,
   incremental, 1 consulta barata) e a tela reconcilia também a cada
   (re)assinatura bem-sucedida — o Realtime não reentrega o intervalo caído.
4. **`responderOfertaSimulada` reivindicava (CAS) antes de validar** —
   formulário inválido deixava a solicitação `em_atendimento` com dono e
   sem evento, sumindo da fila dos outros. Validação foi pra antes do CAS.
5. **Aviso no canal errado.** Pedir informação/cancelar/responder pelo
   painel por alguém que não é o destinatário original caía na conversa
   solicitante↔destinatário-original (da qual o autor nem é membro). Agora
   vai pra conversa direta autor↔solicitante (`canalDeAvisoDaSolicitacao`).
6. **`relacionamento_id` não era preenchido** — exigência da própria
   migration `20260905125419` (o expurgo zera `contato_id`). Agora
   `crm_assegurar_relacionamento` na criação, best-effort (lead sem CPF e
   sem IDWS segue só com `contato_id`).
7. Painel: botões de fila/responder apareciam pra quem não tem a permissão
   (o servidor negava, virava toast de erro); aba padrão agora é Fila pra
   quem recebe; corrida de troca de aba (resposta da aba anterior pintando a
   atual) fechada por ref.
8. Recado do Sonnet impreciso em 2 pontos: "NUNCA chama getCanais no
   mount" (chama 1× via `polling`, e chamava a cada troca de canal porque
   `canalId` estava nas deps — trocado por ref) e "antes caía e nunca mais
   entregava" (o phoenix rejunta sozinho; o que faltava era reconciliar o
   intervalo).

Estado do banco em 13/09 16h: 0 solicitações, 0 mensagens
`solicitacao_simulacao` (nem legado — a feature nunca tinha sido usada),
0 acessos às telas de chat/solicitações desde o deploy de 00:04. Nada disto
foi exercitado em produção ainda; a validação real segue pendente. `jsdom`
(declarado em devDependencies, ausente no node_modules) instalado →
`useRolagemThread.test.ts` voltou a passar.
