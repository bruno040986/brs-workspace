-- HelpDesk combinada (branch helpdesk/combinada): traz da helpdesk/linha-do-tempo
-- o número de controle HD-0001, o responsável e as etapas, encaixados no
-- modelo da fase 3. ADITIVA e idempotente (pode rodar 2x). Decisões:
-- docs/HELPDESK-COMBINADA.md
--
-- NÃO cria helpdesk_eventos: a linha do tempo continua sendo
-- helpdesk_historico (agora também com eventos de responsável e etapa) +
-- helpdesk_comentarios. Visibilidade não muda: todos veem todos os tickets.

-- ---------------------------------------------------------------------------
-- 1. Número de controle (HD-0001). Mesmo nome de coluna/sequence da
--    linha-do-tempo: se aquela migration já rodou em algum banco, isto vira no-op.
-- ---------------------------------------------------------------------------
create sequence if not exists public.helpdesk_controle_seq;

alter table public.helpdesk_tickets add column if not exists controle_numero bigint;

-- Tickets existentes numerados por ordem de abertura (determinístico).
with ordenados as (
  select id, (select coalesce(max(controle_numero), 0) from public.helpdesk_tickets)
             + row_number() over (order by created_at, id) as numero
  from public.helpdesk_tickets
  where controle_numero is null
)
update public.helpdesk_tickets t set controle_numero = o.numero
from ordenados o where o.id = t.id;

do $$
declare
  v_max bigint;
begin
  select max(controle_numero) into v_max from public.helpdesk_tickets;
  if v_max is null then
    perform setval('public.helpdesk_controle_seq', 1, false);
  else
    perform setval('public.helpdesk_controle_seq', greatest(v_max, (select last_value from public.helpdesk_controle_seq)), true);
  end if;
end $$;

alter table public.helpdesk_tickets
  alter column controle_numero set default nextval('public.helpdesk_controle_seq'),
  alter column controle_numero set not null;
alter sequence public.helpdesk_controle_seq owned by public.helpdesk_tickets.controle_numero;

create unique index if not exists helpdesk_tickets_controle_numero_uidx
  on public.helpdesk_tickets (controle_numero);

-- HD-0001 … HD-9999, depois HD-10000 (lpad sozinho truncaria o 5º dígito).
create or replace function app_private.helpdesk_codigo(p_numero bigint)
returns text
language sql
immutable
as $$
  select 'HD-' || case when p_numero < 10000 then lpad(p_numero::text, 4, '0') else p_numero::text end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Responsável: uma PESSOA (FK users) ou uma IA (slug de projeto_agentes).
--    Nomes diferentes de assumido_por/assumido_em da linha-do-tempo (lá é
--    text misturando uuid e 'agente_claude') para não colidir se ela já rodou.
-- ---------------------------------------------------------------------------
alter table public.helpdesk_tickets
  add column if not exists responsavel_id uuid references public.users (id) on delete set null,
  add column if not exists responsavel_ia text,
  add column if not exists responsavel_em timestamptz;

alter table public.helpdesk_tickets drop constraint if exists helpdesk_tickets_responsavel_check;
alter table public.helpdesk_tickets
  add constraint helpdesk_tickets_responsavel_check check (
    (responsavel_id is null or responsavel_ia is null)
    and (responsavel_ia is null or responsavel_ia ~ '^[a-z0-9-]{1,40}$')
  );

create index if not exists idx_helpdesk_responsavel on public.helpdesk_tickets (responsavel_id) where responsavel_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Etapas do plano (escritas pela rotina via MCP helpdesk_definir_etapas)
-- ---------------------------------------------------------------------------
create table if not exists public.helpdesk_etapas (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.helpdesk_tickets (id) on delete cascade,
  ordem integer not null check (ordem > 0),
  titulo text not null check (char_length(titulo) between 1 and 240),
  status text not null default 'pendente' check (status in ('pendente', 'em_andamento', 'concluida')),
  concluida_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ticket_id, ordem)
);
-- Sem policy de propósito (padrão do HelpDesk): acesso só por server action
-- (admin client) e pelo MCP (service role).
alter table public.helpdesk_etapas enable row level security;

-- ---------------------------------------------------------------------------
-- 4. Imagem em comentário: o mesmo helpdesk_anexos, ligado ao comentário.
-- ---------------------------------------------------------------------------
alter table public.helpdesk_anexos
  add column if not exists comentario_id uuid references public.helpdesk_comentarios (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 5. Linha do tempo única: helpdesk_historico ganha eventos que não são
--    mudança de status (de = para = status do momento). evento null = status.
-- ---------------------------------------------------------------------------
alter table public.helpdesk_historico
  add column if not exists evento text,
  add column if not exists detalhe text;
alter table public.helpdesk_historico drop constraint if exists helpdesk_historico_evento_check;
alter table public.helpdesk_historico
  add constraint helpdesk_historico_evento_check check (evento is null or evento in ('responsavel', 'etapa'));

create or replace function app_private.helpdesk_registrar_historico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text;
begin
  if tg_op = 'INSERT' then
    insert into public.helpdesk_historico (ticket_id, de, para, por, created_at)
    values (new.id, null, new.status, new.aberto_por, new.created_at);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.helpdesk_historico (ticket_id, de, para, por, plano_anterior, solucao_anterior)
    values (
      new.id, old.status, new.status, app_private.helpdesk_ator(new, old),
      case when new.plano_proposto is distinct from old.plano_proposto then old.plano_proposto end,
      case when new.comentario_solucao is distinct from old.comentario_solucao then old.comentario_solucao end
    );
  end if;

  if new.responsavel_id is distinct from old.responsavel_id or new.responsavel_ia is distinct from old.responsavel_ia then
    if new.responsavel_id is not null then
      select name into v_nome from public.users where id = new.responsavel_id;
    end if;
    insert into public.helpdesk_historico (ticket_id, de, para, por, evento, detalhe)
    values (
      new.id, new.status, new.status,
      coalesce(nullif(current_setting('app.helpdesk_por', true), '')::uuid, new.responsavel_id),
      'responsavel',
      case
        when new.responsavel_id is not null then 'Responsável: ' || coalesce(nullif(v_nome, ''), 'usuário')
        when new.responsavel_ia is not null then 'Responsável: IA ' || new.responsavel_ia
        else 'Responsável removido'
      end
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_helpdesk_historico on public.helpdesk_tickets;
create trigger trg_helpdesk_historico
  after insert or update of status, responsavel_id, responsavel_ia on public.helpdesk_tickets
  for each row execute function app_private.helpdesk_registrar_historico();

create or replace function app_private.helpdesk_historico_etapa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if new.status = 'pendente' or (tg_op = 'UPDATE' and new.status is not distinct from old.status) then
    return new;
  end if;
  select status into v_status from public.helpdesk_tickets where id = new.ticket_id;
  insert into public.helpdesk_historico (ticket_id, de, para, por, evento, detalhe)
  values (
    new.ticket_id, v_status, v_status, null, 'etapa',
    'Etapa ' || new.ordem || case when new.status = 'concluida' then ' concluída: ' else ' iniciada: ' end || new.titulo
  );
  return new;
end;
$$;

drop trigger if exists trg_helpdesk_historico_etapa on public.helpdesk_etapas;
create trigger trg_helpdesk_historico_etapa
  after insert or update of status on public.helpdesk_etapas
  for each row execute function app_private.helpdesk_historico_etapa();

-- ---------------------------------------------------------------------------
-- 6. Validação de transição no banco (rede de segurança para QUALQUER
--    escritor: tela, MCP, SQL manual). Mesmo nome da linha-do-tempo, mas
--    permite reabrir (só dentro de public.helpdesk_reabrir) e exige pessoa
--    em aprovado_por para 'aprovado'.
-- ---------------------------------------------------------------------------
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
       ('aprovado', 'em_execucao'), ('em_execucao', 'concluido'))
     or (new.status = 'rejeitado' and old.status in ('aberto', 'plano_proposto', 'aprovado', 'em_execucao'))
     -- ticket assumido por PESSOA pode ser concluído sem o ciclo da IA (o MCP não conclui)
     or (new.status = 'concluido' and old.status in ('aberto', 'plano_proposto', 'aprovado') and new.responsavel_id is not null)
     or (new.status = 'aberto' and old.status in ('concluido', 'rejeitado')
         and coalesce(current_setting('app.helpdesk_reabrindo', true), '') = 'on') then
    return new;
  end if;
  raise exception 'HelpDesk: transição inválida % -> % (reabrir só por public.helpdesk_reabrir).', old.status, new.status;
end;
$$;

drop trigger if exists trg_helpdesk_validar_transicao on public.helpdesk_tickets;
create trigger trg_helpdesk_validar_transicao
  before update of status on public.helpdesk_tickets
  for each row execute function app_private.helpdesk_validar_transicao();

-- ---------------------------------------------------------------------------
-- 7. Notificações: o MESMO trigger da fase 3, com todos os avisos de antes,
--    o código HD no corpo do sino/e-mail e o aviso novo "responsável".
-- ---------------------------------------------------------------------------
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

  -- Pessoa assumiu: avisa o solicitante (se foi ele mesmo, avisar exclui o ator).
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
  elsif new.status = 'aberto' and old.status in ('concluido', 'rejeitado') then
    perform app_private.helpdesk_avisar(array[new.aberto_por] || app_private.helpdesk_aprovadores(), 'helpdesk_reaberto',
      'Ticket reaberto', new.id, v_rotulo, v_ator);
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

drop trigger if exists trg_helpdesk_notificar on public.helpdesk_tickets;
create trigger trg_helpdesk_notificar
  after insert or update on public.helpdesk_tickets
  for each row execute function app_private.helpdesk_notificar();

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
  select id, titulo, aberto_por, controle_numero into t from public.helpdesk_tickets where id = new.ticket_id;
  perform app_private.helpdesk_avisar(
    array[t.aberto_por] || app_private.helpdesk_aprovadores(), 'helpdesk_comentario',
    case when new.autor_tipo = 'claude' then 'Claude comentou no ticket' else 'Novo comentário no ticket' end,
    t.id, app_private.helpdesk_codigo(t.controle_numero) || ' · ' || t.titulo, new.autor_id);
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Reabrir (recriada da fase 3): igual, mas apaga as etapas do ciclo
--    anterior para não aparecerem no ticket reaberto.
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

  delete from public.helpdesk_etapas where ticket_id = p_ticket_id;

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

revoke execute on function app_private.helpdesk_codigo(bigint) from public, anon, authenticated;

notify pgrst, 'reload schema';
