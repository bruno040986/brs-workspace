-- HelpDesk: status "em_validacao" entre em_execucao e concluido.
-- Fluxo: o agente registra o resultado (em_execucao -> em_validacao); o aprovador
-- valida: "Solicitar alteração" (em_validacao -> em_execucao, motivo vira comentário,
-- responsável mantido) ou "Concluir" (em_validacao/em_execucao -> concluido, grava
-- concluido_em e concluido_por). Idempotente.

-- 1. CHECK de status: troca qualquer check do ticket que enumere os status.
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'public.helpdesk_tickets'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%em_execucao%'
  loop
    execute format('alter table public.helpdesk_tickets drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.helpdesk_tickets
  add constraint helpdesk_tickets_status_check
  check (status in ('aberto', 'plano_proposto', 'aprovado', 'rejeitado', 'em_execucao', 'em_validacao', 'concluido'));

-- 2. Quem concluiu + marca de "devolvido com alteração solicitada" (o MCP usa
--    para o agente achar o que voltou para ele).
alter table public.helpdesk_tickets
  add column if not exists concluido_por uuid references public.users (id) on delete set null,
  add column if not exists alteracao_solicitada_em timestamptz;

-- 3. Ator do histórico: inclui quem concluiu.
create or replace function app_private.helpdesk_ator(n public.helpdesk_tickets, o public.helpdesk_tickets)
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('app.helpdesk_por', true), '')::uuid,
    case when n.status in ('aprovado', 'rejeitado') and n.aprovado_em is distinct from o.aprovado_em then n.aprovado_por end,
    case when n.status = 'concluido' then n.concluido_por end
  );
$$;

-- 4. Transições (rede de segurança para tela, MCP e SQL manual) + limpeza das
--    marcas ao sair de em_execucao / do estado final (cobre o reabrir).
create or replace function app_private.helpdesk_validar_transicao()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status = 'aprovado' and new.aprovado_por is null then
    raise exception 'HelpDesk: aprovar exige aprovado_por (pessoa).';
  end if;
  if (old.status, new.status) in (
       ('aberto', 'plano_proposto'), ('plano_proposto', 'aprovado'),
       ('aprovado', 'em_execucao'), ('em_execucao', 'em_validacao'),
       ('em_validacao', 'em_execucao'), ('em_validacao', 'concluido'),
       ('em_execucao', 'concluido'))
     or (new.status = 'rejeitado' and old.status in ('aberto', 'plano_proposto', 'aprovado', 'em_execucao', 'em_validacao'))
     -- ticket assumido por PESSOA pode ser concluído sem o ciclo da IA (o MCP não conclui)
     or (new.status = 'concluido' and old.status in ('aberto', 'plano_proposto', 'aprovado') and new.responsavel_id is not null)
     or (new.status = 'aberto' and old.status in ('concluido', 'rejeitado')
         and coalesce(current_setting('app.helpdesk_reabrindo', true), '') = 'on') then
    if new.status <> 'em_execucao' then
      new.alteracao_solicitada_em := null;
    end if;
    if new.status <> 'concluido' then
      new.concluido_por := null;
    end if;
    return new;
  end if;
  raise exception 'HelpDesk: transição inválida % -> % (reabrir só por public.helpdesk_reabrir).', old.status, new.status;
end;
$$;

-- 5. Notificações: em_validacao avisa os aprovadores; devolver para em_execucao
--    não repete "em execução" ao solicitante (o comentário do motivo já avisa).
create or replace function app_private.helpdesk_notificar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ator uuid;
  v_rotulo text := app_private.helpdesk_codigo(new.controle_numero) || ' · ' || new.titulo;
begin
  if tg_op = 'INSERT' then
    perform app_private.helpdesk_avisar(
      app_private.helpdesk_aprovadores(), 'helpdesk_aberto',
      case when new.urgente then '🚨 Ticket URGENTE aberto' else 'Novo ticket no HelpDesk' end,
      new.id, v_rotulo, new.aberto_por);
    return new;
  end if;

  if new.responsavel_id is not null and new.responsavel_id is distinct from old.responsavel_id then
    perform app_private.helpdesk_avisar(array[new.aberto_por], 'helpdesk_assumido',
      'Seu ticket tem um responsável', new.id, v_rotulo, new.responsavel_id);
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;
  v_ator := app_private.helpdesk_ator(new, old);

  if new.status = 'plano_proposto' then
    perform app_private.helpdesk_avisar(app_private.helpdesk_aprovadores(), 'helpdesk_plano',
      'Plano proposto aguardando aprovação', new.id, v_rotulo, v_ator);
  elsif new.status = 'em_validacao' then
    perform app_private.helpdesk_avisar(app_private.helpdesk_aprovadores(), 'helpdesk_validacao',
      'Ticket aguardando validação', new.id, v_rotulo, v_ator);
  elsif new.status = 'aberto' and old.status in ('concluido', 'rejeitado') then
    perform app_private.helpdesk_avisar(array[new.aberto_por] || app_private.helpdesk_aprovadores(), 'helpdesk_reaberto',
      'Ticket reaberto', new.id, v_rotulo, v_ator);
  elsif new.status = 'em_execucao' and old.status = 'em_validacao' then
    null; -- alteração solicitada: o comentário com o motivo já notifica
  elsif new.status in ('aprovado', 'em_execucao', 'concluido', 'rejeitado') then
    perform app_private.helpdesk_avisar(array[new.aberto_por], 'helpdesk_' || new.status,
      case new.status
        when 'aprovado' then 'O plano do seu ticket foi aprovado'
        when 'em_execucao' then 'Seu ticket está em execução'
        when 'concluido' then 'Seu ticket foi concluído ✅'
        else 'Seu ticket foi rejeitado'
      end,
      new.id, v_rotulo, v_ator);
  end if;
  return new;
end;
$$;

-- 6. Solicitar alteração (atômico): comentário com o motivo + volta a em_execucao
--    mantendo responsavel_ia/responsavel_id. Só service_role (a action confere a permissão).
create or replace function public.helpdesk_solicitar_alteracao(p_ticket_id uuid, p_motivo text, p_por uuid)
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
  if v_status <> 'em_validacao' then
    raise exception 'Só é possível solicitar alteração de ticket em validação.';
  end if;
  if btrim(coalesce(p_motivo, '')) = '' then
    raise exception 'Informe o motivo da alteração.';
  end if;

  perform set_config('app.helpdesk_por', p_por::text, true);

  insert into public.helpdesk_comentarios (ticket_id, autor_tipo, autor_id, texto)
  values (p_ticket_id, 'usuario', p_por, 'Alteração solicitada: ' || btrim(p_motivo));

  update public.helpdesk_tickets
     set status = 'em_execucao', alteracao_solicitada_em = now()
   where id = p_ticket_id;

  perform set_config('app.helpdesk_por', '', true);
end;
$$;

revoke all on function public.helpdesk_solicitar_alteracao(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.helpdesk_solicitar_alteracao(uuid, text, uuid) to service_role;

notify pgrst, 'reload schema';
