-- HelpDesk do grupo (spec da sessão CRM AlvoConsig, 02/09/2026): registro
-- central de bugs/pedidos de qualquer sistema, substituindo a planilha.
-- Máquina de estados: aberto → plano_proposto → aprovado → em_execucao →
-- concluido (rejeitado a qualquer momento antes de concluído). A parte
-- "Claude investiga/implementa" roda POR FORA (sessão agendada, via service
-- role) — por isso as notificações são TRIGGER no banco: disparam
-- independente de quem escreveu (tela ou robô).

create table if not exists public.helpdesk_tickets (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text not null default '',
  url text not null default '',
  menu_contexto text not null default '',
  sistema text not null check (sistema in ('workspace', 'alvoconsig', 'clt_orchestrator', 'portal_parceiro', 'outro')),
  urgente boolean not null default false,
  status text not null default 'aberto'
    check (status in ('aberto', 'plano_proposto', 'aprovado', 'rejeitado', 'em_execucao', 'concluido')),
  plano_proposto text,
  comentario_solucao text,
  aberto_por uuid not null references public.users (id),
  aprovado_por uuid references public.users (id),
  created_at timestamptz not null default now(),
  plano_em timestamptz,
  aprovado_em timestamptz,
  concluido_em timestamptz
);

create index if not exists idx_helpdesk_status on public.helpdesk_tickets (status, created_at desc);
create index if not exists idx_helpdesk_aberto_por on public.helpdesk_tickets (aberto_por);

-- Sem policy de propósito: leitura/escrita passam pelas server actions
-- (admin client) e pela sessão agendada (service role).
alter table public.helpdesk_tickets enable row level security;

-- ---------------------------------------------------------------------------
-- Notificações via sino (workspace_notifications) por TRIGGER
-- ---------------------------------------------------------------------------
create or replace function app_private.helpdesk_notificar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  destinos uuid[];
begin
  -- quem pode aprovar (perfil OU permissão individual helpdesk-aprovar)
  select array_agg(distinct u.id) into destinos
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

  if tg_op = 'INSERT' then
    -- ticket novo → avisa os aprovadores (urgente ganha destaque no título)
    insert into public.workspace_notifications (user_id, type, title, body, href, entity_type, entity_id, actor_user_id)
    select d, 'helpdesk_aberto',
           case when new.urgente then '🚨 Ticket URGENTE aberto' else 'Novo ticket no HelpDesk' end,
           new.titulo, '/helpdesk', 'helpdesk_ticket', new.id, new.aberto_por
    from unnest(coalesce(destinos, '{}')) d
    where d <> new.aberto_por;
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'plano_proposto' then
      insert into public.workspace_notifications (user_id, type, title, body, href, entity_type, entity_id)
      select d, 'helpdesk_plano', 'Plano proposto aguardando aprovação', new.titulo, '/helpdesk', 'helpdesk_ticket', new.id
      from unnest(coalesce(destinos, '{}')) d;
    elsif new.status in ('concluido', 'rejeitado') then
      insert into public.workspace_notifications (user_id, type, title, body, href, entity_type, entity_id)
      values (
        new.aberto_por,
        'helpdesk_' || new.status,
        case when new.status = 'concluido' then 'Seu ticket foi concluído ✅' else 'Seu ticket foi rejeitado' end,
        new.titulo, '/helpdesk', 'helpdesk_ticket', new.id
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_helpdesk_notificar on public.helpdesk_tickets;
create trigger trg_helpdesk_notificar
  after insert or update on public.helpdesk_tickets
  for each row execute function app_private.helpdesk_notificar();

-- ---------------------------------------------------------------------------
-- Permissões: helpdesk-abrir (todo usuário do chat interno) e
-- helpdesk-aprovar (só root — Bruno concede a mais gente pela tela).
-- ---------------------------------------------------------------------------
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, 'helpdesk-abrir', true, true, false, false, false
from public.profile_permissions pp
where pp.resource_name = 'conversas' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, 'helpdesk-abrir', true, true, false, false, false
from public.user_permissions up
where up.resource_name = 'conversas' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include;

insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, 'helpdesk-aprovar', true, true, true, false, false
from public.profile_permissions pp
where pp.resource_name = 'sistema-usuarios-root' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, 'helpdesk-aprovar', true, true, true, false, false
from public.user_permissions up
where up.resource_name = 'sistema-usuarios-root' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

notify pgrst, 'reload schema';
