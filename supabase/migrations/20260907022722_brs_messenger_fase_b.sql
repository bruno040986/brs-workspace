-- BRS Messenger — Fase B (07/09/2026): paridade da conversa individual.
-- Revisão Fable da proposta do Sonnet (docs/PROPOSTA-SCHEMA-BRS-MESSENGER-FASE-B.md):
-- (1) vínculo/departamento/atendente padrão por CONTATO; (2) respostas rápidas
-- próprias com categoria/escopo/anexo; (3) agendamento de ação com lease +
-- RPCs de claim/finish (atomicidade entre workers, FOR UPDATE SKIP LOCKED);
-- (4) ticks e reações (o engine grava quando emitir ack/reaction — ficam vazias
-- até lá). Sem permissão nova: tudo sob `conversas`/`central-conversas`.
-- Regras do Messenger ≠ CRM (spec §0): tabelas próprias, nada de papel/disparo.

-- ===========================================================================
-- 1) Metadados por CONTATO (irmã de chat_conversa_meta; chave = meta.sender.id)
-- ===========================================================================
create table if not exists public.chat_contato_meta (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.chat_contas (id) on delete cascade,
  chatwoot_contact_id integer not null,
  entidade_tipo text null check (entidade_tipo in ('parceiro', 'instituicao', 'promotora')),
  entidade_id uuid null,
  departamento_padrao_id uuid null references public.chat_departamentos (id) on delete set null,
  atendente_padrao_chatwoot_id integer null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conta_id, chatwoot_contact_id),
  constraint chat_contato_meta_entidade_coerente check ((entidade_tipo is null) = (entidade_id is null))
);
create index if not exists chat_contato_meta_entidade_idx on public.chat_contato_meta (entidade_tipo, entidade_id);

do $$ begin
  create trigger set_timestamp_chat_contato_meta before update on public.chat_contato_meta
    for each row execute function trigger_set_timestamp();
exception when duplicate_object then null; end $$;

-- ===========================================================================
-- 2) Respostas rápidas (categoria + escopo por departamento + anexo)
-- ===========================================================================
create table if not exists public.chat_resposta_categorias (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.chat_contas (id) on delete cascade,
  nome text not null,
  ordem integer not null default 0,
  created_at timestamptz not null default now(),
  unique (conta_id, nome)
);

create table if not exists public.chat_respostas_rapidas (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.chat_contas (id) on delete cascade,
  nome text not null,
  atalho text not null,                    -- digitado no composer, ex.: "/bomdia"
  texto text not null,
  categoria_id uuid null references public.chat_resposta_categorias (id) on delete set null,
  arquivo_url text null,                   -- bucket parceiro-midias
  ativo boolean not null default true,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conta_id, atalho)
);
create index if not exists chat_respostas_rapidas_conta_idx on public.chat_respostas_rapidas (conta_id, ativo);

-- Sem linha = visível a todos os departamentos.
create table if not exists public.chat_resposta_departamentos (
  resposta_id uuid not null references public.chat_respostas_rapidas (id) on delete cascade,
  departamento_id uuid not null references public.chat_departamentos (id) on delete cascade,
  primary key (resposta_id, departamento_id)
);

do $$ begin
  create trigger set_timestamp_chat_respostas_rapidas before update on public.chat_respostas_rapidas
    for each row execute function trigger_set_timestamp();
exception when duplicate_object then null; end $$;

-- ===========================================================================
-- 3) Agendamento de ação por conversa (mensagem | lembrete interno) + lease
-- ===========================================================================
create table if not exists public.chat_acoes_agendadas (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.chat_contas (id) on delete cascade,
  chatwoot_conversation_id integer not null,
  criado_por uuid not null references public.users (id),
  acao text not null check (acao in ('mensagem', 'lembrete_interno')),
  texto text null,
  agendado_para timestamptz not null,
  status text not null default 'pendente' check (status in ('pendente', 'executado', 'cancelado', 'falhou')),
  lease_token uuid null,
  lease_until timestamptz null,
  ultimo_erro text null,
  executado_em timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chat_acoes_agendadas_pendentes_idx on public.chat_acoes_agendadas (agendado_para) where status = 'pendente';
create index if not exists chat_acoes_agendadas_conversa_idx on public.chat_acoes_agendadas (chatwoot_conversation_id, status);

do $$ begin
  create trigger set_timestamp_chat_acoes_agendadas before update on public.chat_acoes_agendadas
    for each row execute function trigger_set_timestamp();
exception when duplicate_object then null; end $$;

-- Claim atômico: N workers concorrentes nunca pegam a mesma ação
-- (FOR UPDATE SKIP LOCKED). Lease vencida volta a ser elegível — o worker
-- decide se reexecuta ou marca 'falhou' (mensagem já pode ter saído).
create or replace function public.chat_acoes_agendadas_claim(p_limite integer default 20, p_lease_segundos integer default 120)
returns setof public.chat_acoes_agendadas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid := gen_random_uuid();
begin
  return query
  with cand as (
    select id
    from public.chat_acoes_agendadas
    where status = 'pendente'
      and agendado_para <= now()
      and (lease_until is null or lease_until < now())
    order by agendado_para
    limit greatest(1, least(coalesce(p_limite, 20), 100))
    for update skip locked
  )
  update public.chat_acoes_agendadas a
  set lease_token = v_token,
      lease_until = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_segundos, 120), 900))),
      updated_at = now()
  from cand
  where a.id = cand.id
  returning a.*;
end;
$$;

create or replace function public.chat_acoes_agendadas_finish(p_id uuid, p_token uuid, p_status text, p_erro text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean := false;
begin
  if p_status not in ('executado', 'falhou', 'cancelado') then
    raise exception 'status invalido: %', p_status;
  end if;
  update public.chat_acoes_agendadas
  set status = p_status,
      ultimo_erro = p_erro,
      executado_em = case when p_status = 'executado' then now() else executado_em end,
      lease_token = null,
      lease_until = null,
      updated_at = now()
  where id = p_id and lease_token = p_token and status = 'pendente'
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

revoke all on function public.chat_acoes_agendadas_claim(integer, integer) from public, anon, authenticated;
revoke all on function public.chat_acoes_agendadas_finish(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.chat_acoes_agendadas_claim(integer, integer) to service_role;
grant execute on function public.chat_acoes_agendadas_finish(uuid, uuid, text, text) to service_role;

-- ===========================================================================
-- 4) Ticks (✓/✓✓/lida/falhou) e reações — gravados pelo engine (Fase 4 dele)
-- ===========================================================================
create table if not exists public.chat_mensagem_status (
  chatwoot_message_id integer primary key,
  conta_id uuid not null references public.chat_contas (id) on delete cascade,
  status text not null check (status in ('enviado', 'entregue', 'lido', 'falhou')),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.chat_mensagem_reacoes (
  id uuid primary key default gen_random_uuid(),
  chatwoot_message_id integer not null,
  conta_id uuid not null references public.chat_contas (id) on delete cascade,
  jid text not null,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (chatwoot_message_id, jid)
);
create index if not exists chat_mensagem_reacoes_msg_idx on public.chat_mensagem_reacoes (chatwoot_message_id);

-- ===========================================================================
-- RLS — server-only (actions com requirePermission; engine com service role)
-- ===========================================================================
do $$ declare t text; begin t := app_private.enable_rls_if_exists('chat_contato_meta'); end $$;

alter table public.chat_resposta_categorias enable row level security;
alter table public.chat_respostas_rapidas enable row level security;
alter table public.chat_resposta_departamentos enable row level security;
alter table public.chat_acoes_agendadas enable row level security;
alter table public.chat_mensagem_status enable row level security;
alter table public.chat_mensagem_reacoes enable row level security;

revoke all on public.chat_contato_meta, public.chat_resposta_categorias, public.chat_respostas_rapidas,
  public.chat_resposta_departamentos, public.chat_acoes_agendadas, public.chat_mensagem_status,
  public.chat_mensagem_reacoes from public, anon, authenticated;
grant select, insert, update, delete on public.chat_contato_meta, public.chat_resposta_categorias,
  public.chat_respostas_rapidas, public.chat_resposta_departamentos, public.chat_acoes_agendadas,
  public.chat_mensagem_status, public.chat_mensagem_reacoes to service_role;

notify pgrst, 'reload schema';
