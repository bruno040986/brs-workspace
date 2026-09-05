# Proposta de schema — etapa 5 (ferramentas de atendimento externo)

Data: 05/09/2026, sessão Sonnet. Rascunho de SQL para revisão do Fable — nada
aqui foi aplicado. Cobre os itens da seção 5 do
[plano](PLANO-IMPLEMENTACAO-ALVOCONSIG-2026-09-05.md) que não dá pra fechar
com o schema atual do `brs-alvoconsig`/`brs-workspace`. O restante da seção 5
(o que dava pra fazer sem migration) já foi implementado — ver
[handoff](HANDOFF-ALVOCONSIG-2026-09-05.md).

## 1. Disputa de atribuição não é atômica (achado novo, ligado à seção 5)

`atribuirConversa` (`brs-alvoconsig/apps/web/src/lib/crm/atendimento-actions.ts:489`)
lê o assignee atual no Chatwoot, decide a mensagem (assumiu/transferiu) e só
depois escreve — sem trava entre as duas chamadas. Dois atendentes clicando
"assumir" ao mesmo tempo podem os dois ver "✅ atendimento assumido por você",
com o Chatwoot fica com o último que escreveu. Isso é o Chatwoot (sistema
externo) quem guarda o assignee, então uma trava no nosso Postgres não torna a
escrita no Chatwoot atômica por si só — mas serializa as CHAMADAS que fazem
essa escrita, o que já elimina a janela de corrida na prática (só uma
`atribuirConversa` por conversa roda por vez; a segunda vê o resultado da
primeira antes de decidir o que fazer).

```sql
alter table public.chat_conversas
  add column atribuicao_lock_por uuid null references public.crm_usuarios(id),
  add column atribuicao_lock_expira timestamptz null;

-- Reivindicação atômica (uma única UPDATE): quem não conseguir, sabe na hora
-- que outro atendente está processando a mesma transferência.
create function public.chat_conversa_atribuicao_lock(p_id uuid, p_usuario uuid, p_segundos integer default 15)
returns boolean language sql security definer set search_path = '' as $$
  update public.chat_conversas set atribuicao_lock_por = p_usuario,
    atribuicao_lock_expira = clock_timestamp() + make_interval(secs => greatest(5, least(p_segundos, 60)))
  where id = p_id and (atribuicao_lock_por is null or atribuicao_lock_expira < clock_timestamp())
  returning true;
$$;

create function public.chat_conversa_atribuicao_liberar(p_id uuid, p_usuario uuid)
returns void language sql security definer set search_path = '' as $$
  update public.chat_conversas set atribuicao_lock_por = null, atribuicao_lock_expira = null
  where id = p_id and atribuicao_lock_por = p_usuario;
$$;

revoke all on function public.chat_conversa_atribuicao_lock(uuid,uuid,integer), public.chat_conversa_atribuicao_liberar(uuid,uuid) from public,anon,authenticated;
grant execute on function public.chat_conversa_atribuicao_lock(uuid,uuid,integer), public.chat_conversa_atribuicao_liberar(uuid,uuid) to service_role;
```

**Uso em `atribuirConversa`:** reivindicar o lock antes de `obterConversa`; se
`false`, devolver "Outro atendente está processando esta conversa agora,
tente de novo em instantes." (não é erro, é "tente já já"); liberar em
`finally` (sucesso ou falha) pra não travar a conversa se algo no meio
explodir.

**Aceite:** duas chamadas simultâneas pra assumir a mesma conversa — só uma
"ganha"; a outra recebe a mensagem de disputa, não uma falsa confirmação.

## 2. Tags por conversa (seção 5, ainda não existe)

```sql
create table public.crm_tags (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros(id),
  nome text not null,
  cor text not null default '#94a3b8',
  created_at timestamptz not null default now(),
  unique(agente_parceiro_id, nome)
);
create table public.chat_conversa_tags (
  conversa_id uuid not null references public.chat_conversas(id) on delete cascade,
  tag_id uuid not null references public.crm_tags(id) on delete cascade,
  criado_por uuid null references public.crm_usuarios(id),
  created_at timestamptz not null default now(),
  primary key(conversa_id, tag_id)
);
alter table public.crm_tags enable row level security;
alter table public.chat_conversa_tags enable row level security;
revoke all on public.crm_tags, public.chat_conversa_tags from public, anon, authenticated;
grant select, insert, update, delete on public.crm_tags, public.chat_conversa_tags to service_role;
```

Segue o padrão já usado nas tabelas de atendimento (RLS ligado, zero policy —
tudo servido por Server Action/service role com filtro de parceiro na app;
comentário original em `20260830090000_crm_atendimento.sql`).

**Aceite:** criar/editar/excluir tag do parceiro; aplicar/remover tag numa
conversa; tag de um parceiro nunca aparece pra outro.

## 3. Agendamento individual persistente (seção 5, distinto do disparo em massa)

Mensagem agendada pra UMA conversa (não confundir com `crm_disparo_fila`, que
é campanha). Mesmo padrão de lease/claim que acabou de entrar em produção pra
disparo (`crm_disparo_claim`/`finish`, migration `crm_disparo_duravel`) —
reaproveitar o desenho, não a tabela, já que os campos são bem diferentes.

```sql
create table public.chat_mensagens_agendadas (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros(id),
  chatwoot_conversation_id integer not null,
  instancia_id uuid not null references public.chat_instancias(id),
  criado_por uuid not null references public.crm_usuarios(id),
  telefone_e164 text not null,
  texto text,
  midia jsonb,
  agendado_para timestamptz not null,
  status text not null default 'pendente' check(status in ('pendente','enviado','cancelado','falhou','incerto')),
  lease_token uuid,
  lease_until timestamptz,
  ultimo_erro text,
  enviado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index chat_mensagens_agendadas_pendentes_idx on public.chat_mensagens_agendadas (agendado_para) where status = 'pendente';
alter table public.chat_mensagens_agendadas enable row level security;
revoke all on public.chat_mensagens_agendadas from public, anon, authenticated;
grant select, insert, update on public.chat_mensagens_agendadas to service_role;

-- claim/finish: mesmo contrato de crm_disparo_claim/finish (lease vencida
-- nunca volta sozinha se sends_external; ver 20260905013755_crm_disparo_duravel.sql).
```

**Por que precisa de tabela (não dá pra fazer só no cliente):** "revalidar
acesso, alocação e disponibilidade da instância no horário de envio" (plano,
seção 5) exige um WORKER rodando no horário agendado, não só o navegador
aberto — se o atendente fechar a aba, a mensagem tem que sair mesmo assim.

**Aceite:** agendar, cancelar, reagendar; revalidação no envio rejeita se a
instância caiu ou o atendente perdeu acesso à conversa entre o agendamento e o
disparo; reinício do worker não perde nem duplica.

## Itens que NÃO precisam de schema (backlog pra próxima sessão Sonnet)

- **Rascunho por conversa/usuário**: dá pra fazer só com `localStorage`
  (perda ao trocar de aparelho é aceitável pra rascunho). Não comecei porque
  `ConversaCentro.tsx` tem dois `<textarea>` controlados pelo mesmo estado
  `texto` em pontos diferentes do JSX (around linhas 404 e 608) e eu não tinha
  certeza de QUAL fluxo cada um atende sem ver a tela rodando — investigar
  isso antes de mexer.
- **Responder mensagem citada + ver contexto da citação**: `enviarMensagem`
  do engine já aceita `atributos` (`content_attributes`) livre — Chatwoot
  aceita `in_reply_to` nesse campo nativamente. Provavelmente dá pra fazer
  sem schema novo, só wiring (UI pra escolher a mensagem, engine repassar o
  atributo, render mostrar o preview da citada). Não tentei por ser
  transversal (CRM + engine) e eu não ter como validar visualmente o resultado.
- **Pesquisar mensagens**: Chatwoot tem endpoint de busca
  (`GET /api/v1/accounts/{id}/search?q=`) — dá pra expor como mais um
  `resource` em `/api/crm/atendimento`, mesmo padrão do que já existe.
- **Galeria de arquivos/imagens/documentos**: sem endpoint dedicado no
  Chatwoot; teria que agregar anexos das mensagens já paginadas. Sem schema
  novo, mas pode ficar lento em conversas muito longas sem um índice —
  medir antes de decidir se precisa de tabela própria.
- **Ordenar fila por espera (maior/menor)**: a API de conversas do Chatwoot já
  devolve `waiting_since` no payload (não lido hoje —
  `ChatwootConversa` em `lib/chat/chatwoot.ts:237` não declara o campo, mas ele
  vem no JSON). Dá pra tentar ler e ordenar por ele sem migration; falta
  confirmar ao vivo se o Chatwoot desta instalação realmente zera esse campo
  só com resposta humana (não com o eco do próprio disparo) antes de confiar
  nele pro "não contar mensagem técnica".
- **Sidebar recolhível + navegação por teclado + estados vazio/carregamento/
  erro**: não achei nenhum recolhimento de sidebar hoje no atendimento
  (`FilaConversas.tsx`/`AtendimentoShell.tsx`). É trabalho de UI puro, mas é
  a tela mais usada do CRM — melhor fazer com o navegador aberto do que às
  cegas; não tentei nesta sessão.

## Etapa 6 (disparos e métricas por instância) — 05/09, sessão Sonnet

Levantamento sobre `brs-alvoconsig`. A fórmula de rotação e o saco de delays
(seção 6 do plano) já estavam corretos — conferidos linha por linha contra o
exemplo canônico do plano (10 números, 30 templates: rodadas T1–T10, T11–T20,
T21–T30, T2–T11) e cobertos por teste novo em `disparo.test.ts`. **Implementado
nesta sessão:**

- **Worker persistente de disparo dentro do engine**
  (`services/engine/src/disparo-worker.ts`), atrás de `ENGINE_DISPARO_WORKER`
  (desligado). Resolve "cron de minuto não serve pra cadências de cinco
  segundos": o cron do Next.js só pode ser acionado de fora em intervalos de
  minuto; o engine já é processo sempre no ar (Railway), então o worker pode
  reivindicar a fila a cada 1-2s. Usa a MESMA RPC do cron
  (`crm_disparo_claim`/`finish`) e a MESMA rota de envio
  (`/instancias/:id/enviar`, chamada em loopback) — nada de lógica de envio
  duplicada, só a composição da mensagem (variáveis do template) precisou ser
  espelhada, porque o build do engine não inclui `apps/web` (ver comentário no
  arquivo). Cron do Next.js continua sendo o caminho ativo até este worker ser
  testado com carga real.
- **Prévia das rodadas** no wizard de campanha
  (`NovaCampanhaWizard.tsx`), usando `montarRotacao` direto — mostra os pares
  número×template das primeiras rodadas antes de criar a campanha.
- **Painel "Envios do disparo"** em `CampanhaDetalhe.tsx`: contagem por status
  (pendente/enviando/enviado/incerto/falhou/cancelado) e próximo horário
  agendado. `getProgressoDisparo` tinha DOIS bugs — não existia nenhuma tela
  que a chamasse (função morta) e ela contava em memória (`select('status')`
  sem paginação, undercontava campanhas grandes) sem incluir o status
  `incerto` (que eu adicionei na migration de disparo durável). Trocado por
  `count: 'exact', head: true` por status — não depende do limite de linhas do
  PostgREST (exigência explícita da seção 6).
- **Só uma campanha de disparo ativa por parceiro** (decisão do Bruno,
  05/09/2026, durante a revisão desta sessão): a cadência do worker
  (`crm_disparo_cadencia`) é por PARCEIRO, não por campanha — duas ativas ao
  mesmo tempo embaralhariam a rotação uma da outra, competindo pelo mesmo
  espaço de envio. `existeDisparoAtivo` (`disparo-shared.ts`) trava criação
  (`criarCampanhaParceiro`) e retomada (`mudarStatus`) no servidor;
  `CampanhasHub.tsx` desabilita o tile "WhatsApp não oficial" (badge "em
  andamento") e o botão Retomar de campanhas pausadas do mesmo tipo;
  `CampanhaDetalhe.tsx` faz o mesmo pro botão Retomar da própria tela. O
  Bruno cogitou permitir campanhas simultâneas com conjuntos de números
  disjuntos (ex.: tenant com 15 números rodando 7+8 em campanhas separadas)
  — plausível, mas exige mudar a cadência de por-parceiro pra por-conjunto-
  de-instâncias, o que é o item 2 abaixo tocado ("versionar pool") mais um
  pouco: ficou combinado fazer a trava simples agora e avaliar a evolução
  depois, sem represar a fundação do chat esperando por ela.

**Não fiz — precisam de decisão de produto antes de virar código:**

1. **Fluxo técnico entre números controlados.** O plano pede: depois de um
   envio elegível pra lead, até 4 números do MESMO tenant recebem mensagem e
   respondem em tempos sorteados; com menos de 5 números elegíveis o fluxo
   fica suspenso; nunca cria novo ciclo a partir de resposta técnica; conta
   separado do indicador comercial; **desligado até teste real autorizado**.
   Isso é código que manda o PRÓPRIO sistema iniciar conversas sem gatilho de
   atendente — categoria diferente de tudo que existe hoje no CRM (que só
   reage a ação humana ou a mensagem do cliente). Antes de desenhar o schema
   quero confirmação explícita do Bruno sobre o objetivo exato (dar atividade
   orgânica aos números pra reduzir risco de bloqueio do WhatsApp?) e os
   limites numéricos (quantos ciclos por dia, por número, etc. — o plano não
   define, só diz "impor limites").
2. **Versionar edição do pool de templates em campanha ativa.** Hoje
   `editarCampanhaParceiro` só edita nome/descrição/atendentes — trocar
   instâncias/templates de uma campanha JÁ criada não é possível (a fila
   inteira é materializada de uma vez em `persistirComposicaoDisparo`, na
   criação). "Edição gera versão nova aplicada em limite definido da rodada"
   pressupõe uma feature de editar-em-andamento que ainda não existe; construir
   as duas juntas é mais SQL novo (`crm_campanha_disparo_templates` já tem
   `ordem`, mas nenhuma coluna de versão/vigência) — falta decidir o que
   "limite definido da rodada" quer dizer na prática (a partir do próximo
   `n` múltiplo de N? a partir da próxima campanha?).
3. **Limite de envios por instância** (achado 6 do plano: "limites por
   instância e recuperação de leases" — a recuperação de lease já está feita
   desde a migration de disparo durável; o limite numérico por instância,
   não). Sem um número (quantos por hora/dia por número pra não levar
   bloqueio), não dá pra codificar sem chutar um valor.


## Etapa 7 (painéis de simulação/digitação e chat interno) — 05/09, sessão Sonnet

Levantamento sobre `brs-alvoconsig`. Diferente das etapas 4-6, quase tudo que
falta aqui esbarra em schema ou numa decisão de segurança — não é trabalho
que dá pra fechar só escrevendo TS. Documentando em vez de arriscar.

**Já está feito** (de sessão anterior, conferido agora):
- Cursor do chat interno com desempate por `(created_at, id)`, paginação de
  histórico antigo (`antesDe`) e recuperação de lacunas (`depoisDe`) —
  achado 17 da auditoria — em `chat-interno-cursor.ts` +
  `getMensagensInterno`, com teste próprio, e de fato ligado em
  `ChatInterno.tsx` (não é função morta).
- "Revogação de acesso alcança banco/Realtime" — corrigido na migration
  `crm_chat_autorizacao` (etapa 4 desta sessão): a policy de SELECT de
  `crm_chat_mensagens` agora exige `chat_interno.usar` + tenant habilitado,
  não só participação no canal.
- "Leitura por usuário" — `crm_chat_membros.lido_ate` já dá a cada usuário
  seu próprio marcador de leitura por canal (`marcarLido`).

**Existe uma versão parcial de "solicitação operacional"**, mas apoiada em
cima do chat interno em vez de ser um registro próprio: `solicitarSimulacao`/
`responderOfertaSimulada` (`chat-interno-actions.ts`) gravam a solicitação e
a resposta como MENSAGENS (`crm_chat_mensagens.tipo = 'solicitacao_simulacao'`
/`'oferta_simulada'`, com `payload` jsonb). Funciona pra registrar e notificar,
mas descumpre duas coisas que o plano pede explicitamente: "não depender de
encontrar uma mensagem pra recuperar o trabalho operacional" (aqui depende —
é a própria mensagem que é o registro) e "painel compartilhado por escopo...
sem abrir cada conversa" (não existe painel nenhum — pra ver solicitações
pendentes hoje só abrindo o canal). Sem estado formal (solicitado/em
atendimento/aguardando informações/respondido/cancelado) nem timestamps de
primeira resposta/conclusão.

### Proposta de schema — solicitação operacional como registro próprio

```sql
create table public.crm_solicitacoes_operacionais (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros(id),
  contato_id uuid not null references public.crm_contatos(id),
  tipo text not null check (tipo in ('simulacao','digitacao')),
  solicitado_por uuid not null references public.crm_usuarios(id),
  atribuido_a uuid null references public.crm_usuarios(id),
  status text not null default 'solicitado'
    check (status in ('solicitado','em_atendimento','aguardando_informacoes','respondido','cancelado')),
  -- digitacao referencia a oferta ESCOLHIDA + snapshot das condições aceitas
  -- no momento (o valor pode mudar depois; o pedido não).
  oferta_id uuid null references public.crm_ofertas(id),
  snapshot_condicoes jsonb null,
  payload jsonb not null default '{}'::jsonb,
  canal_chat_interno_id uuid null references public.crm_chat_canais(id),
  criado_em timestamptz not null default now(),
  primeira_resposta_em timestamptz null,
  concluido_em timestamptz null,
  -- soma de todo tempo em 'aguardando_informacoes' — não apagar ao reatribuir.
  tempo_aguardando_ms bigint not null default 0,
  aguardando_desde timestamptz null
);
create index crm_solicitacoes_operacionais_parceiro_idx on public.crm_solicitacoes_operacionais (agente_parceiro_id, status, criado_em desc);
create index crm_solicitacoes_operacionais_atribuido_idx on public.crm_solicitacoes_operacionais (atribuido_a, status) where status not in ('respondido','cancelado');
alter table public.crm_solicitacoes_operacionais enable row level security;
revoke all on public.crm_solicitacoes_operacionais from public, anon, authenticated;
grant select, insert, update on public.crm_solicitacoes_operacionais to service_role;

create table public.crm_solicitacoes_eventos (
  id uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.crm_solicitacoes_operacionais(id) on delete cascade,
  autor_crm_usuario_id uuid null references public.crm_usuarios(id),
  status_de text null,
  status_para text not null,
  nota text null,
  created_at timestamptz not null default now()
);
alter table public.crm_solicitacoes_eventos enable row level security;
revoke all on public.crm_solicitacoes_eventos from public, anon, authenticated;
grant select, insert on public.crm_solicitacoes_eventos to service_role;
```

Painel por escopo é uma consulta por `atribuido_a` (visão do atendente),
`status in ('solicitado','em_atendimento','aguardando_informacoes')` sem
filtro de usuário (visão operacional) e sem filtro nenhum (master, tenant
inteiro) — não precisa de tabela extra, só de uma tela nova. **Aceite do
plano** ("dupla atribuição não cria dois responsáveis") pede um `update ...
where atribuido_a is null` (compare-and-swap) na hora de assumir, mesmo
padrão da atribuição de conversa (proposta 1 deste documento).

### Digitando com expiração — decisão de segurança, não só de schema

Duas formas de fazer, nenhuma "só TypeScript":
1. **Coluna** (`crm_chat_membros.digitando_ate timestamptz`) + Realtime via
   `postgres_changes` — mesmo padrão já usado em todo o resto do chat,
   revogação de acesso já coberta pela policy existente. Mais tráfego de
   UPDATE (um a cada tecla, com debounce).
2. **Broadcast efêmero** do Realtime (sem gravar nada) — mais leve, mas
   broadcast NÃO passa pela policy de RLS da tabela; teria que configurar
   canal privado com Realtime Authorization (`realtime.messages`), que hoje
   não existe neste projeto (só `postgres_changes` é usado, em nenhum lugar
   do código há canal broadcast). Fazer sem essa autorização deixaria
   qualquer usuário autenticado escutar/fingir "digitando" em canal que não
   participa — regressão de segurança, não vou fazer sem migration.

Recomendo a opção 1 (reaproveita o modelo de segurança já validado).

### Novos tipos de mídia no chat interno

`crm_chat_mensagens.tipo` tem CHECK fechado
(`'texto','solicitacao_simulacao','oferta_simulada','lembrete','sistema'`) —
adicionar `'imagem'/'audio'/'documento'` é `alter table ... drop constraint
... add constraint` (migration pequena). Também falta decidir bucket: pode
reaproveitar `parceiro-midias` (já existe, já tem URL assinada resolvida) com
um prefixo `chat-interno/<canal_id>/`, sem bucket novo. Depois disso é UI —
`ConversaCentro.tsx` já tem upload de imagem/documento e gravação de áudio
prontos (achado 06 da auditoria já resolvido lá); o plano pede
explicitamente reaproveitar esses componentes em vez de reconstruir.

### Resumo do que falta pra fechar a etapa 7

| Item | Precisa de | Bloqueado por |
|---|---|---|
| Solicitação/digitação como registro próprio + painel 3 visões | 2 tabelas (acima) | decisão do Bruno |
| Digitando com expiração | 1 coluna | decisão do Bruno (qual das duas formas) |
| Mídia no chat interno (imagem/áudio/documento/figurinha) | `alter` no `tipo` + decisão de bucket | decisão do Bruno; depois é UI reaproveitando componentes existentes |
| Cursor/paginação/revogação | nada | já feito |

## Decisões do Bruno + revisão Fable — 05/09/2026 (tarde)

Bruno decidiu (sessão Fable, mesma conversa):

| Item | Decisão | Migration (rascunho testado) |
|---|---|---|
| Atribuição atômica de conversa | **fazer agora** | `20260905125418_chat_conversas_atribuicao_lock` — só 2 colunas; a trava é um UPDATE condicional na app, sem função |
| Solicitação operacional como registro próprio + painel | **fazer agora** | `20260905125419_crm_solicitacoes_operacionais` — 2 tabelas |
| Mídia no chat interno | **fazer agora** | `20260905125420_crm_chat_mensagens_midia` — abre o CHECK de tipo; bucket `parceiro-midias` reaproveitado |
| Limite de envios por instância | **campo por parceiro na aba AlvoConsig do Agente Corban** | `20260905125421_crm_disparo_limite_por_instancia` — coluna + `crm_disparo_claim` reescrito pra respeitar o teto |
| Fluxo técnico entre números controlados | **desenhar agora, deixar desligado** | `20260905125422_crm_disparo_trafego_tecnico` — 4 colunas de config (flag off por parceiro) + tabela própria + `origem='tecnico'` |
| Tags, agendamento individual, "digitando" | segunda rodada | (rascunhos acima continuam valendo) |
| Versionar pool em campanha ativa | adiado (a edição do pool não existe) | — |
| Campanhas simultâneas com números disjuntos | adiado; trava "uma por vez" já em produção no código | — |

**Revisão Fable do rascunho do Sonnet (o que mudou):**
1. `crm_solicitacoes_operacionais.contato_id` era NOT NULL sem `on delete` — o
   expurgo de campanha (`crm_campanha_encerrar` apaga `crm_contatos`) ia
   FALHAR na primeira solicitação existente. Virou nullable + `set null`, com
   `relacionamento_id` (identidade estável de `crm_relacionamentos`, preenchida
   por `crm_assegurar_relacionamento` na criação) segurando a pessoa. Mesmo
   ajuste em `oferta_id` (`crm_ofertas` cascateia com o contato). Testado:
   deletar o contato deixa a solicitação de pé com o snapshot.
2. Atribuição atômica não precisa de `security definer`: um UPDATE com
   `where atribuicao_lock_por is null or atribuicao_lock_expira < now()` já é
   atômico. Menos superfície.
3. Teto por instância entra DENTRO de `crm_disparo_claim` (não na app): o item
   cujo número bateu o teto hoje é pulado e o próximo pendente do parceiro
   com saldo é reivindicado. Só `status='enviado'` conta; `incerto` não
   (não dá pra afirmar que saiu). Dia civil de São Paulo.
4. Tráfego técnico: `chat_conversas.origem` ganha `'tecnico'` — o Atendimento
   tem que filtrar `origem <> 'tecnico'` SEMPRE (não é "disparo sem
   resposta": nunca entra na fila) e o engine, ao receber inbound de um jid
   que é número de disparo do próprio tenant, não pode marcar `respondida`.
   Ciclo só nasce de envio a lead, nunca de linha técnica (sem laço).

**Onde estão:** `supabase/migrations/20260905125418`…`125422` (worktree
`brs-workspace-chat`, branch codex). Validadas com bootstrap + 8 aplicadas +
testes atuais + 5 pendentes + cenários novos, tudo em rollback. **Não
aplicadas** — push só depois do merge em main, pela pasta principal.

**Próximo passo:** branch `codex` de volta → mover pra `supabase/migrations/`
→ commit → Bruno aprova `db push` → handoff pro Sonnet implementar:
(a) `atribuirConversa` com a trava; (b) painel de solicitações (3 visões) +
migrar `solicitarSimulacao`/`responderOfertaSimulada` pra gravar no registro
e só notificar no chat; (c) upload/gravação no chat interno reaproveitando
`ConversaCentro.tsx`; (d) campo "máx. envios/dia por número" e os 4 campos
do tráfego técnico na aba AlvoConsig (Workspace: `AlvoconsigTab.tsx` +
`alvoconsig-actions.ts`) e em `limites-parceiro.ts` (CRM); (e) worker do
tráfego técnico no engine, atrás da flag por parceiro.
