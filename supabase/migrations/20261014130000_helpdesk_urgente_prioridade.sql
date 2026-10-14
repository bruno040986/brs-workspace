-- HelpDesk: insert que só conhece `urgente` (sessão externa) passa a gravar
-- prioridade = 'impede', mantendo as duas colunas coerentes.
create or replace function app_private.helpdesk_prioridade_urgente()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.urgente is true and new.prioridade = 'atrapalha' then
    new.prioridade := 'impede';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_helpdesk_prioridade_urgente on public.helpdesk_tickets;
create trigger trg_helpdesk_prioridade_urgente
  before insert on public.helpdesk_tickets
  for each row execute function app_private.helpdesk_prioridade_urgente();
