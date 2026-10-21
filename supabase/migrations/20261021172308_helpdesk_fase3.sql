-- HelpDesk fase 3: comentários, histórico de status, reabrir, notificações em
-- todas as etapas e fila de e-mail. ADITIVA e idempotente (pode rodar 2x).
-- Tudo por TRIGGER: vale igual para a tela (server actions) e para a rotina
-- do Claude (service role). Contrato da rotina: docs/HELPDESK-ROTINA-CLAUDE.md
--
-- Atores: a rotina grava via service role (sem auth.uid()), então "quem fez"
-- vem de (1) app.helpdesk_por, setado só pela RPC helpdesk_reabrir, ou
-- (2) aprovado_por quando a mudança é aprovar/rejeitar. Senão fica null
-- (= Claude/sistema).

-- ---------------------------------------------------------------------------
-- Tabelas (RLS ligada SEM policies, como helpdesk_tickets: acesso só por
-- server action com admin client e pela rotina via service role)
-- ---------------------------------------------------------------------------
create table if not exists public.helpdesk_comentarios (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.helpdesk_tickets (id) on delete cascade,
  autor_tipo text not null check (autor_tipo in ('usuario', 'claude')),
  autor_id uuid references public.users (id) on delete set null,
  texto text not null check (char_length(btrim(texto)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists idx_helpdesk_comentarios_ticket on public.helpdesk_comentarios (ticket_id, created_at);
alter table public.helpdesk_comentarios enable row level security;

-- Append-only na prática: só o trigger insere. plano/solução anteriores
-- guardam o que a reabertura limpa do ticket (nada se perde).
create table if not exists public.helpdesk_historico (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.helpdesk_tickets (id) on delete cascade,
  de text,
  para text not null,
  por uuid references public.users (id) on delete set null,
  plano_anterior text,
  solucao_anterior text,
  created_at timestamptz not null default now()
);
create index if not exists idx_helpdesk_historico_ticket on public.helpdesk_historico (ticket_id, created_at);
alter table public.helpdesk_historico enable row level security;

create table if not exists public.helpdesk_email_fila (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  ticket_id uuid not null references public.helpdesk_tickets (id) on delete cascade,
  assunto text not null,
  corpo text not null,
  created_at timestamptz not null default now(),
  enviado_em timestamptz,
  erro text
);
create index if not exists idx_helpdesk_email_pendentes
  on public.helpdesk_email_fila (created_at) where enviado_em is null and erro is null;
alter table public.helpdesk_email_fila enable row level security;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Quem pode aprovar (perfil OU permissão individual) — mesma regra de antes.
create or replace function app_private.helpdesk_aprovadores()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct u.id), '{}')
  from public.users u
  where coalesce(u.active, true)
    and (
      exists (
        select 1 from public.user_permissions up
        where up.user_id = u.id and up.resource_name = 'helpdesk-aprovar' and coalesce(up.can_view, false)
      )
      or exists (
        select 1 from public.profile_permissions pp
        where pp.profile_id = u.profile_id and pp.resource_name = 'helpdesk-aprovar' and coalesce(pp.can_view, false)
      )
    );
$$;

create or replace function app_private.helpdesk_ator(n public.helpdesk_tickets, o public.helpdesk_tickets)
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('app.helpdesk_por', true), '')::uuid,
    case when n.status in ('aprovado', 'rejeitado') and n.aprovado_em is distinct from o.aprovado_em then n.aprovado_por end
  );
$$;

-- Sino + fila de e-mail para os mesmos destinos (menos o próprio ator).
-- O e-mail leva só título do ticket e evento — nunca descrição/prints.
create or replace function app_private.helpdesk_avisar(
  p_destinos uuid[], p_tipo text, p_evento text, p_ticket_id uuid, p_ticket_titulo text, p_ator uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.workspace_notifications (user_id, type, title, body, href, entity_type, entity_id, actor_user_id)
  select d, p_tipo, p_evento, p_ticket_titulo, '/helpdesk', 'helpdesk_ticket', p_ticket_id, p_ator
  from (select distinct unnest(coalesce(p_destinos, '{}')) as d) x
  where d is not null and d is distinct from p_ator;

  insert into public.helpdesk_email_fila (user_id, ticket_id, assunto, corpo)
  select u.id, p_ticket_id, left('[HelpDesk] ' || p_evento, 200),
         'Ticket: ' || left(p_ticket_titulo, 200) || E'\nEvento: ' || p_evento
  from public.users u
  where u.id = any (coalesce(p_destinos, '{}'))
    and u.id is distinct from p_ator
    and coalesce(u.active, true)
    and coalesce(btrim(u.email), '') <> '';
end;
$$;

-- ---------------------------------------------------------------------------
-- Notificações do ticket (substitui a da migration 20260903000000; mantém
-- tipos e títulos antigos e acrescenta aprovado, em_execucao e reaberto)
-- ---------------------------------------------------------------------------
create or replace function app_private.helpdesk_notificar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ator uuid;
begin
  if tg_op = 'INSERT' then
    perform app_private.helpdesk_avisar(
      app_private.helpdesk_aprovadores(), 'helpdesk_aberto',
      case when new.urgente then '🚨 Ticket URGENTE aberto' else 'Novo ticket no HelpDesk' end,
      new.id, new.titulo, new.aberto_por);
    return new;
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;
  v_ator := app_private.helpdesk_ator(new, old);

  if new.status = 'plano_proposto' then
    perform app_private.helpdesk_avisar(app_private.helpdesk_aprovadores(), 'helpdesk_plano',
      'Plano proposto aguardando aprovação', new.id, new.titulo, v_ator);
  elsif new.status = 'aberto' and old.status in ('concluido', 'rejeitado') then
    perform app_private.helpdesk_avisar(app_private.helpdesk_aprovadores(), 'helpdesk_reaberto',
      'Ticket reaberto', new.id, new.titulo, v_ator);
  elsif new.status in ('aprovado', 'em_execucao', 'concluido', 'rejeitado') then
    perform app_private.helpdesk_avisar(array[new.aberto_por], 'helpdesk_' || new.status,
      case new.status
        when 'aprovado' then 'O plano do seu ticket foi aprovado'
        when 'em_execucao' then 'Seu ticket está em execução'
        when 'concluido' then 'Seu ticket foi concluído ✅'
        else 'Seu ticket foi rejeitado'
      end,
      new.id, new.titulo, v_ator);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_helpdesk_notificar on public.helpdesk_tickets;
create trigger trg_helpdesk_notificar
  after insert or update on public.helpdesk_tickets
  for each row execute function app_private.helpdesk_notificar();

-- ---------------------------------------------------------------------------
-- Histórico de status (criação + toda mudança, de qualquer origem)
-- ---------------------------------------------------------------------------
create or replace function app_private.helpdesk_registrar_historico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.helpdesk_historico (ticket_id, de, para, por, created_at)
    values (new.id, null, new.status, new.aberto_por, new.created_at);
  elsif new.status is distinct from old.status then
    insert into public.helpdesk_historico (ticket_id, de, para, por, plano_anterior, solucao_anterior)
    values (
      new.id, old.status, new.status, app_private.helpdesk_ator(new, old),
      case when new.plano_proposto is distinct from old.plano_proposto then old.plano_proposto end,
      case when new.comentario_solucao is distinct from old.comentario_solucao then old.comentario_solucao end
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_helpdesk_historico on public.helpdesk_tickets;
create trigger trg_helpdesk_historico
  after insert or update of status on public.helpdesk_tickets
  for each row execute function app_private.helpdesk_registrar_historico();

-- Tickets antigos: criação + estado atual (pelos carimbos), uma vez só.
insert into public.helpdesk_historico (ticket_id, de, para, por, created_at)
select t.id, null, 'aberto', t.aberto_por, t.created_at
from public.helpdesk_tickets t
where not exists (select 1 from public.helpdesk_historico h where h.ticket_id = t.id)
union all
select t.id, null, t.status, null, coalesce(t.concluido_em, t.aprovado_em, t.plano_em, t.created_at)
from public.helpdesk_tickets t
where t.status <> 'aberto'
  and not exists (select 1 from public.helpdesk_historico h where h.ticket_id = t.id);

-- ---------------------------------------------------------------------------
-- Comentário notifica solicitante + aprovadores (menos o autor). Na
-- reabertura o aviso "Ticket reaberto" já cobre: o comentário do motivo cala.
-- ---------------------------------------------------------------------------
create or replace function app_private.helpdesk_comentario_notificar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
begin
  if coalesce(current_setting('app.helpdesk_reabrindo', true), '') = 'on' then
    return new;
  end if;
  select id, titulo, aberto_por into t from public.helpdesk_tickets where id = new.ticket_id;
  perform app_private.helpdesk_avisar(
    array[t.aberto_por] || app_private.helpdesk_aprovadores(), 'helpdesk_comentario',
    case when new.autor_tipo = 'claude' then 'Claude comentou no ticket' else 'Novo comentário no ticket' end,
    t.id, t.titulo, new.autor_id);
  return new;
end;
$$;

drop trigger if exists trg_helpdesk_comentario_notificar on public.helpdesk_comentarios;
create trigger trg_helpdesk_comentario_notificar
  after insert on public.helpdesk_comentarios
  for each row execute function app_private.helpdesk_comentario_notificar();

-- ---------------------------------------------------------------------------
-- Reabrir (atômico): motivo vira comentário, ticket volta a 'aberto' e os
-- campos do ciclo anterior são limpos — ficam em helpdesk_historico
-- (plano_anterior/solucao_anterior). Permissão (solicitante ou aprovador)
-- é checada na server action; aqui só service_role executa.
-- ---------------------------------------------------------------------------
create or replace function public.helpdesk_reabrir(p_ticket_id uuid, p_motivo text, p_por uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from public.helpdesk_tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'Ticket não encontrado.';
  end if;
  if v_status not in ('concluido', 'rejeitado') then
    raise exception 'Só é possível reabrir ticket concluído ou rejeitado.';
  end if;

  perform set_config('app.helpdesk_por', p_por::text, true);
  perform set_config('app.helpdesk_reabrindo', 'on', true);

  insert into public.helpdesk_comentarios (ticket_id, autor_tipo, autor_id, texto)
  values (p_ticket_id, 'usuario', p_por, 'Reaberto: ' || btrim(p_motivo));

  update public.helpdesk_tickets
     set status = 'aberto', plano_proposto = null, plano_em = null, comentario_solucao = null,
         aprovado_por = null, aprovado_em = null, concluido_em = null
   where id = p_ticket_id;

  perform set_config('app.helpdesk_por', '', true);
  perform set_config('app.helpdesk_reabrindo', '', true);
end;
$$;

revoke all on function public.helpdesk_reabrir(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.helpdesk_reabrir(uuid, text, uuid) to service_role;

notify pgrst, 'reload schema';
