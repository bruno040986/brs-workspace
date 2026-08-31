-- BRS Messenger — Fase 1 da reforma do Atendimento (design aprovado 31/08/2026):
-- assinatura de WhatsApp por usuário, metadados por conversa do Chatwoot
-- (vínculo genérico Parceiro/IF/Promotora, observações, protocolo único) e
-- chat Interno ganhando grupo "Equipe BRS" + canal pessoal "Você".

-- ---------------------------------------------------------------------------
-- 1. Assinatura nas mensagens de WhatsApp da BRS (ex.: "Michael - Suporte").
--    Campo livre: o usuário escreve como quer aparecer; vazio = nome do cadastro.
-- ---------------------------------------------------------------------------
alter table public.users
  add column if not exists nome_exibicao text null;

-- ---------------------------------------------------------------------------
-- 2. Metadados por conversa do Chatwoot (qualquer canal: Baileys, Z-API,
--    360dialog, site). Chave = conta + id da conversa no Chatwoot, porque nem
--    toda conversa tem linha em chat_conversas (só as dos canais do engine).
-- ---------------------------------------------------------------------------
create sequence if not exists public.chat_protocolo_seq;

create table if not exists public.chat_conversa_meta (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.chat_contas (id) on delete cascade,
  chatwoot_conversation_id integer not null,
  -- Vínculo genérico com uma entidade do Workspace (tipo + id, sem FK por tabela
  -- de propósito: promotoras/IFs/parceiros têm ciclos de vida próprios e o
  -- futuro robô de fluxo consome esse par direto).
  entidade_tipo text null check (entidade_tipo in ('parceiro', 'instituicao', 'promotora')),
  entidade_id uuid null,
  observacoes text not null default '',
  protocolo text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conta_id, chatwoot_conversation_id),
  constraint chat_conversa_meta_entidade_coerente check ((entidade_tipo is null) = (entidade_id is null))
);
create index if not exists chat_conversa_meta_entidade_idx on public.chat_conversa_meta (entidade_tipo, entidade_id);
create unique index if not exists chat_conversa_meta_protocolo_idx on public.chat_conversa_meta (protocolo);

create or replace function public.chat_gerar_protocolo()
returns trigger
language plpgsql
as $$
begin
  if new.protocolo is null or new.protocolo = '' then
    new.protocolo := to_char(timezone('America/Sao_Paulo', now()), 'YYYYMMDD') || lpad(nextval('public.chat_protocolo_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

do $$ begin
  create trigger chat_conversa_meta_protocolo before insert on public.chat_conversa_meta
    for each row execute function public.chat_gerar_protocolo();
exception when duplicate_object then null; end $$;

-- protocolo é preenchido pelo trigger; permitir insert sem valor
alter table public.chat_conversa_meta alter column protocolo drop not null;
alter table public.chat_conversa_meta alter column protocolo set default '';

do $$ begin
  create trigger set_timestamp_chat_conversa_meta before update on public.chat_conversa_meta
    for each row execute function trigger_set_timestamp();
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 3. Interno: grupo "Equipe BRS" (todos os usuários ativos) e canal "Você"
--    (kind 'self', 1 participante) — mesmo esquema workspace_chat_* já em uso.
-- ---------------------------------------------------------------------------
-- 3a. Grupo Equipe BRS (uma vez). created_by = usuário ativo mais antigo.
do $$
declare
  v_grupo uuid;
  v_dono uuid;
begin
  select id into v_grupo from public.workspace_chat_conversations where kind = 'equipe' limit 1;
  if v_grupo is null then
    select id into v_dono from public.users where active is not false order by created_at nulls last, id limit 1;
    if v_dono is not null then
      insert into public.workspace_chat_conversations (kind, created_by) values ('equipe', v_dono) returning id into v_grupo;
    end if;
  end if;
  if v_grupo is not null then
    insert into public.workspace_chat_participants (conversation_id, user_id)
    select v_grupo, u.id from public.users u where u.active is not false
    on conflict do nothing;
  end if;
end $$;

-- 3b. Canal "Você" de cada usuário ativo existente.
insert into public.workspace_chat_conversations (kind, created_by)
select 'self', u.id
from public.users u
where u.active is not false
  and not exists (
    select 1 from public.workspace_chat_conversations c
    join public.workspace_chat_participants p on p.conversation_id = c.id
    where c.kind = 'self' and p.user_id = u.id
  );

insert into public.workspace_chat_participants (conversation_id, user_id)
select c.id, c.created_by
from public.workspace_chat_conversations c
where c.kind = 'self'
  and not exists (select 1 from public.workspace_chat_participants p where p.conversation_id = c.id and p.user_id = c.created_by);

-- 3c. Usuário novo entra sozinho no Equipe BRS e ganha o "Você".
create or replace function public.workspace_chat_ao_criar_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grupo uuid;
  v_self uuid;
begin
  select id into v_grupo from public.workspace_chat_conversations where kind = 'equipe' limit 1;
  if v_grupo is not null then
    insert into public.workspace_chat_participants (conversation_id, user_id) values (v_grupo, new.id) on conflict do nothing;
  end if;
  insert into public.workspace_chat_conversations (kind, created_by) values ('self', new.id) returning id into v_self;
  insert into public.workspace_chat_participants (conversation_id, user_id) values (v_self, new.id) on conflict do nothing;
  return new;
end;
$$;

do $$ begin
  create trigger workspace_chat_novo_usuario after insert on public.users
    for each row execute function public.workspace_chat_ao_criar_usuario();
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 4. RLS do meta: leitura/escrita só via service role (server actions com
--    requirePermission na aplicação) — sem policies pra authenticated.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  t := app_private.enable_rls_if_exists('chat_conversa_meta');
end $$;
