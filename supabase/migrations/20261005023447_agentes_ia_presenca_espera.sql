-- Agente de IA do CRM AlvoConsig — complemento da fatia 1: presença do
-- atendente (§3.6/§5.3), fila de espera (§5.2 modo 4) e notificação (§5.2).
-- Spec: docs/SPEC-AGENTES-IA-CRM.md. Não altera nada que a fundação
-- (20261005021849) criou; tudo idempotente.
--
-- Quem usa o quê (fatias 8/9/10):
--   crm_presenca                      tabela; CRM lê por tenant via Realtime; escreve só por função
--   crm_presenca_estado(...)          função PURA (heartbeat, pausa, agora, X, Y) → estado
--   crm_presenca_heartbeat(usuario)   server action a cada 60 s; devolve true quando o atendente FICOU online
--   crm_presenca_pausa(usuario, ativar, motivo)   pausa manual; sair da pausa conta como heartbeat
--   crm_presenca_recalcular(parceiro) cron de 1 min: grava online→ausente→offline pelo carimbo (Realtime reflete)
--   crm_agente_espera_entregar(parceiro, usuario, max_abertas)  entrega atômica do mais antigo da espera
--   chat_agente_conversas.aviso_master_enviado_em   marca o aviso ao master após espera_master_min
--   crm_notificacoes.modulo 'agente_ia' / entidade_tipo 'conversa' (entidade_id = chat_agente_conversas.id)

-- ---------------------------------------------------------------------------
-- 3.6 X e Y da presença por parceiro
-- ---------------------------------------------------------------------------
alter table public.crm_parceiro_config
  add column if not exists presenca_ausente_min integer not null default 5,
  add column if not exists presenca_offline_min integer not null default 10;
alter table public.crm_parceiro_config drop constraint if exists crm_parceiro_config_presenca_min_check;
alter table public.crm_parceiro_config add constraint crm_parceiro_config_presenca_min_check
  check (presenca_ausente_min > 0 and presenca_offline_min > 0);

-- ---------------------------------------------------------------------------
-- 3.6 Presença do atendente. `estado` é DERIVADO (gravado para o Realtime);
-- `em_pausa` é a única entrada manual. Escrita só pelas funções abaixo.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_presenca (
  crm_usuario_id uuid primary key references public.crm_usuarios (id) on delete cascade,
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  estado text not null default 'offline' check (estado in ('online', 'ausente', 'offline', 'pausa')),
  ultimo_heartbeat_em timestamptz null,
  em_pausa boolean not null default false,
  pausa_motivo text null,
  atualizado_em timestamptz not null default now()
);
create index if not exists crm_presenca_parceiro_estado_idx
  on public.crm_presenca (agente_parceiro_id, estado);

-- 5.2 modo espera: fila = aguardando_atendente sem roteado_para, mais antigo primeiro.
create index if not exists chat_agente_conversas_espera_idx
  on public.chat_agente_conversas (agente_parceiro_id, created_at)
  where status = 'aguardando_atendente' and roteado_para is null;
alter table public.chat_agente_conversas
  add column if not exists aviso_master_enviado_em timestamptz null;

-- 5.2 notificação ao atendente/master: módulo novo + entidade conversa.
alter table public.crm_notificacoes drop constraint if exists crm_notificacoes_modulo_check;
alter table public.crm_notificacoes add constraint crm_notificacoes_modulo_check
  check (modulo in ('digitacoes', 'solicitacoes', 'agente_ia'));
alter table public.crm_notificacoes drop constraint if exists crm_notificacoes_entidade_tipo_check;
alter table public.crm_notificacoes add constraint crm_notificacoes_entidade_tipo_check
  check (entidade_tipo in ('proposta', 'solicitacao', 'conversa'));

-- ---------------------------------------------------------------------------
-- 5.3 Funções de presença
-- ---------------------------------------------------------------------------
-- Pura: a mesma regra que presenca.test.ts cobre no CRM (§9.1).
create or replace function public.crm_presenca_estado(
  p_heartbeat timestamptz, p_em_pausa boolean, p_agora timestamptz, p_ausente_min integer, p_offline_min integer
) returns text language sql immutable as $$
  select case
    when p_em_pausa then 'pausa'
    when p_heartbeat is null then 'offline'
    when p_agora - p_heartbeat < make_interval(mins => p_ausente_min) then 'online'
    when p_agora - p_heartbeat < make_interval(mins => p_ausente_min + p_offline_min) then 'ausente'
    else 'offline'
  end
$$;

-- Heartbeat: grava o carimbo; devolve true quando a transição foi PARA online
-- (gatilho de crm_agente_espera_entregar na fatia 9). Em pausa, só carimba.
create or replace function public.crm_presenca_heartbeat(p_usuario uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_parceiro uuid; v_antes text; v_depois text;
begin
  select agente_parceiro_id into v_parceiro from public.crm_usuarios where id = p_usuario and ativo;
  if v_parceiro is null then raise exception 'crm_presenca_heartbeat: usuário % inexistente ou inativo', p_usuario; end if;
  select estado into v_antes from public.crm_presenca where crm_usuario_id = p_usuario;
  insert into public.crm_presenca (crm_usuario_id, agente_parceiro_id, estado, ultimo_heartbeat_em)
  values (p_usuario, v_parceiro, 'online', clock_timestamp())
  on conflict (crm_usuario_id) do update
    set ultimo_heartbeat_em = clock_timestamp(),
        estado = case when public.crm_presenca.em_pausa then 'pausa' else 'online' end,
        atualizado_em = clock_timestamp()
  returning estado into v_depois;
  -- ponytail: dois heartbeats simultâneos podem devolver true os dois; a entrega da espera é idempotente/serializada.
  return v_depois = 'online' and coalesce(v_antes, 'offline') <> 'online';
end $$;

-- Pausa manual (almoço). Sair da pausa = interação = heartbeat; devolve true se ficou online.
create or replace function public.crm_presenca_pausa(p_usuario uuid, p_ativar boolean, p_motivo text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_parceiro uuid; v_antes text;
begin
  select agente_parceiro_id into v_parceiro from public.crm_usuarios where id = p_usuario and ativo;
  if v_parceiro is null then raise exception 'crm_presenca_pausa: usuário % inexistente ou inativo', p_usuario; end if;
  select estado into v_antes from public.crm_presenca where crm_usuario_id = p_usuario;
  insert into public.crm_presenca (crm_usuario_id, agente_parceiro_id, estado, ultimo_heartbeat_em, em_pausa, pausa_motivo)
  values (p_usuario, v_parceiro, case when p_ativar then 'pausa' else 'online' end, clock_timestamp(), p_ativar, case when p_ativar then p_motivo end)
  on conflict (crm_usuario_id) do update
    set em_pausa = excluded.em_pausa, pausa_motivo = excluded.pausa_motivo, estado = excluded.estado,
        ultimo_heartbeat_em = excluded.ultimo_heartbeat_em, atualizado_em = clock_timestamp();
  return not p_ativar and coalesce(v_antes, 'offline') <> 'online';
end $$;

-- Cron (1 min): regrava o estado derivado para quem mudou (online→ausente→offline).
-- X/Y vêm de crm_parceiro_config (defaults 5/10 quando o parceiro não tem linha).
create or replace function public.crm_presenca_recalcular(p_parceiro uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.crm_presenca p
  set estado = novo.estado, atualizado_em = clock_timestamp()
  from (
    select p2.crm_usuario_id,
      public.crm_presenca_estado(p2.ultimo_heartbeat_em, p2.em_pausa, clock_timestamp(),
        coalesce(c.presenca_ausente_min, 5), coalesce(c.presenca_offline_min, 10)) as estado
    from public.crm_presenca p2
    left join public.crm_parceiro_config c on c.agente_parceiro_id = p2.agente_parceiro_id
    where p_parceiro is null or p2.agente_parceiro_id = p_parceiro
  ) novo
  where novo.crm_usuario_id = p.crm_usuario_id and novo.estado <> p.estado;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 5.2 Entrega atômica da espera: o mais antigo `aguardando_atendente` sem dono
-- do parceiro vai para p_usuario, respeitando max_abertas (conversas com
-- chat_conversas.atendente_atual_id = ele). 0 ou 1 linha. Duas chamadas
-- concorrentes não entregam a mesma conversa (lock de linha + skip locked) nem
-- furam max_abertas (serializa por atendente no lock da linha de presença).
-- Também grava o dono em chat_conversas e no pré-cadastro sem dono (§3.8).
-- O CRM faz o assign no Chatwoot DEPOIS, com a linha devolvida.
-- ---------------------------------------------------------------------------
create or replace function public.crm_agente_espera_entregar(p_parceiro uuid, p_usuario uuid, p_max_abertas integer default 5)
returns setof public.chat_agente_conversas language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_conversa uuid;
begin
  if not exists (select 1 from public.crm_usuarios where id = p_usuario and agente_parceiro_id = p_parceiro and ativo) then
    raise exception 'crm_agente_espera_entregar: usuário % não é atendente ativo do parceiro %', p_usuario, p_parceiro;
  end if;
  -- serializa entregas ao mesmo atendente (garante a contagem de abertas)
  insert into public.crm_presenca (crm_usuario_id, agente_parceiro_id) values (p_usuario, p_parceiro) on conflict do nothing;
  perform 1 from public.crm_presenca where crm_usuario_id = p_usuario for update;
  if (select count(*) from public.chat_conversas where atendente_atual_id = p_usuario) >= greatest(p_max_abertas, 0) then
    return;
  end if;
  select c.id, c.chat_conversa_id into v_id, v_conversa
  from public.chat_agente_conversas c
  where c.agente_parceiro_id = p_parceiro and c.status = 'aguardando_atendente' and c.roteado_para is null
  order by c.created_at
  limit 1
  for update of c skip locked;
  if v_id is null then return; end if;
  update public.chat_conversas set atendente_atual_id = p_usuario where id = v_conversa;
  update public.crm_contatos ct set atendente_id = p_usuario
  from public.chat_conversas cc
  where cc.id = v_conversa and ct.id = cc.crm_contato_id and ct.atendente_id is null;
  return query
    update public.chat_agente_conversas
    set roteado_para = p_usuario, roteado_em = clock_timestamp(), roteamento_motivo = 'espera',
        status = 'encerrada', updated_at = now()
    where id = v_id
    returning *;
end $$;

revoke all on function
  public.crm_presenca_estado(timestamptz, boolean, timestamptz, integer, integer),
  public.crm_presenca_heartbeat(uuid),
  public.crm_presenca_pausa(uuid, boolean, text),
  public.crm_presenca_recalcular(uuid),
  public.crm_agente_espera_entregar(uuid, uuid, integer)
from public, anon, authenticated;
grant execute on function
  public.crm_presenca_estado(timestamptz, boolean, timestamptz, integer, integer),
  public.crm_presenca_heartbeat(uuid),
  public.crm_presenca_pausa(uuid, boolean, text),
  public.crm_presenca_recalcular(uuid),
  public.crm_agente_espera_entregar(uuid, uuid, integer)
to service_role;

-- ---------------------------------------------------------------------------
-- RLS: escrita só service role (funções); leitura por tenant para o Realtime
-- da tela do master (mesmo molde de chat_atendimento_sinais, 20260903020000).
-- ---------------------------------------------------------------------------
do $$
declare t regclass;
begin
  t := app_private.enable_rls_if_exists('crm_presenca');
  revoke all on public.crm_presenca from public, anon, authenticated;
  grant select, insert, update, delete on public.crm_presenca to service_role;
  grant select on public.crm_presenca to authenticated;
  perform app_private.apply_policy(t, 'crm_presenca_select_parceiro', 'SELECT',
    'agente_parceiro_id = app_private.crm_agente_parceiro_do_usuario()');
end $$;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'crm_presenca'
  ) then
    alter publication supabase_realtime add table public.crm_presenca;
  end if;
end $$;

notify pgrst, 'reload schema';
