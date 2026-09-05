-- ---------------------------------------------------------------------------
-- Trava de atribuição de conversa (plano AlvoConsig, seção 5: "tratar
-- disputa por atribuição de forma atômica"; achado da sessão Sonnet 05/09).
--
-- atribuirConversa lê o assignee no Chatwoot, decide a mensagem (assumiu/
-- transferiu) e só depois escreve — dois atendentes clicando "assumir" ao
-- mesmo tempo viam os dois "✅ assumido por você". O assignee mora no Chatwoot
-- (sistema externo), então não dá pra fazer a escrita dele ser atômica daqui;
-- o que dá é serializar as NOSSAS chamadas: só quem segurar a trava faz a
-- leitura+escrita, a segunda chamada vê a primeira já refletida.
--
-- Não precisa de função: a reivindicação é UM UPDATE condicional (atômico
-- por construção), feito pela app com service_role:
--   update chat_conversas set atribuicao_lock_por=$u, atribuicao_lock_expira=$agora+15s
--     where id=$conversa and (atribuicao_lock_por is null or atribuicao_lock_expira < $agora)
--     returning id;               -- 0 linhas = outro atendente está no meio
--   ...ler Chatwoot, atribuir, nota interna...
--   update chat_conversas set atribuicao_lock_por=null, atribuicao_lock_expira=null
--     where id=$conversa and atribuicao_lock_por=$u;   -- em finally, sempre
-- Expiração curta (15s) cobre processo que morre com a trava na mão.
-- ---------------------------------------------------------------------------
alter table public.chat_conversas
  add column if not exists atribuicao_lock_por uuid null references public.crm_usuarios (id) on delete set null,
  add column if not exists atribuicao_lock_expira timestamptz null;

comment on column public.chat_conversas.atribuicao_lock_por is
  'Usuário que está no meio de assumir/transferir esta conversa (trava curta); null = livre.';
comment on column public.chat_conversas.atribuicao_lock_expira is
  'Vencimento da trava de atribuição — vencida conta como livre.';
