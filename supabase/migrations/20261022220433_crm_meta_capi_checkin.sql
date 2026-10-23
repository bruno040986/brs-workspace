-- Check-in de anúncio no Atendimento + API de Conversões da Meta (WhatsApp), PR1 (banco). Piloto GO337.
-- Spec: brs-alvoconsig/.claude/tmp/spec-capi-whatsapp.md §1-§3 + §10 (decisões do Bruno 22/10/2026, prevalecem).
--
-- CONTRATO (o que o Workspace, o web do CRM e o cron podem assumir):
--  * Liberação BRS por parceiro (Workspace › Agente Corban › aba Alvo Consig), mesmo padrão de IA/aquecimento:
--    crm_parceiro_config.meta_conversoes_status (desligado|teste|pago) + meta_conversoes_ate (fim do dia,
--    Brasília; nulo = sem prazo). Vigente = teste|pago e (ate nulo ou >= agora).
--  * Interruptores do parceiro (CRM, permissão nova config.meta_capi), ABAIXO da liberação:
--    checkin_anuncio_ativo, checkin_intervalo_horas (padrão 2, contado SÓ no expediente:
--    crm_expediente_somar_horas) e meta_capi_status (desligado|teste|ativo). O CHECK impede ligá-los com a
--    liberação desligada e o gatilho os desliga quando o Workspace desliga a liberação. O prazo (_ate) é
--    conferido na leitura (CHECK não pode depender de now()): a RPC recusa e o cron não envia.
--  * crm_anuncio_checkins: no máximo 1 ciclo aberto por conversa (índice parcial). Só conversa de instância
--    provedor='ycloud' do mesmo parceiro (gatilho, 'CHECKIN_INSTANCIA_INVALIDA'): Baileys fica fora (P10).
--    Ciclo sem clique com clid (tráfego manual, P7) é só métrica interna: os eventos nascem 'sem_clid'.
--    proxima_pergunta_em = próxima cobrança (vencido = encerrado_em is null and proxima_pergunta_em <= now()).
--  * crm_anuncio_checkin_respostas: histórico só de inserção (service_role sem update/delete).
--  * crm_meta_eventos: fila. 1 evento de cada tipo por ciclo (UNIQUE checkin_id+evento), event_id UNIQUE
--    ('brs:<checkin>:ql' | 'brs:<checkin>:purchase'), Purchase só com valor > 0 e moeda BRL.
--    PRONTO para envio = status in ('pendente','erro') and proximo_retry_em <= now(). Nasce 'pendente' com
--    proximo_retry_em = now() + 10 min (janela de correção). Nascem terminais (nunca enviados, nem se o
--    parceiro ligar depois): 'desligado', 'sem_clid', 'sem_envio_baileys' (clique em instância não YCloud
--    ou sem ycloud_waba_id). O clid NUNCA é copiado: o cron lê de ocorrencia_id na hora do envio.
--  * crm_anuncio_checkin_responder: única escrita de resposta (trava o ciclo, grava histórico, recalcula
--    prazo/encerramento e sincroniza a fila na mesma transação). Abrir o ciclo (insert on conflict do
--    nothing) e "lembrar depois" (update com crm_expediente_somar_horas) ficam no TS.
--  * Tudo com RLS ligado e sem policy, só service_role; funções recebem p_parceiro do chamador: EXECUTE
--    só service_role. Fora do Realtime.
--
-- ORDEM DE PUBLICAÇÃO: depende de 20261007031034_chat_anuncio_ocorrencias e 20261020235417_crm_expediente_feriados.
-- Esta migration ANTES do Workspace (aba Alvo Consig lê/grava meta_conversoes_*) e do web do CRM.
--
-- ROLLBACK (manual; perde ciclos, histórico e fila):
--   drop function if exists public.crm_anuncio_checkin_responder(uuid, uuid, text, text, numeric, uuid, uuid, text, boolean),
--     public.crm_expediente_somar_horas(uuid, timestamptz, numeric),
--     app_private.crm_anuncio_checkin_validar(), app_private.crm_meta_conversoes_ao_desligar() cascade;
--   drop table if exists public.crm_meta_eventos, public.crm_anuncio_checkin_respostas, public.crm_anuncio_checkins;
--   alter table public.crm_parceiro_config drop constraint if exists crm_parceiro_config_meta_conversoes_liberacao_check,
--     drop column if exists checkin_anuncio_ativo, drop column if exists checkin_intervalo_horas,
--     drop column if exists meta_capi_status, drop column if exists meta_conversoes_status,
--     drop column if exists meta_conversoes_ate;
--   delete from public.crm_perfis_permissoes where permissao = 'config.meta_capi';
-- Rollback operacional (sem DDL): meta_conversoes_status = 'desligado' desliga tudo do parceiro.
--
-- Idempotente: pode rodar duas vezes sem efeito na segunda.

-- `supabase db push` não roda a migration em transação: `set local` não vale.
set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Liberação (Workspace) e interruptores do parceiro (CRM)
-- ---------------------------------------------------------------------------
alter table public.crm_parceiro_config
  add column if not exists meta_conversoes_status text not null default 'desligado',
  add column if not exists meta_conversoes_ate timestamptz null,
  add column if not exists checkin_anuncio_ativo boolean not null default false,
  add column if not exists checkin_intervalo_horas integer not null default 2,
  add column if not exists meta_capi_status text not null default 'desligado';
alter table public.crm_parceiro_config drop constraint if exists crm_parceiro_config_meta_conversoes_status_check;
alter table public.crm_parceiro_config add constraint crm_parceiro_config_meta_conversoes_status_check
  check (meta_conversoes_status in ('desligado', 'teste', 'pago'));
alter table public.crm_parceiro_config drop constraint if exists crm_parceiro_config_checkin_intervalo_check;
alter table public.crm_parceiro_config add constraint crm_parceiro_config_checkin_intervalo_check
  check (checkin_intervalo_horas between 1 and 72);
alter table public.crm_parceiro_config drop constraint if exists crm_parceiro_config_meta_capi_status_check;
alter table public.crm_parceiro_config add constraint crm_parceiro_config_meta_capi_status_check
  check (meta_capi_status in ('desligado', 'teste', 'ativo'));
-- Interruptor do parceiro só com liberação (P6).
alter table public.crm_parceiro_config drop constraint if exists crm_parceiro_config_meta_conversoes_liberacao_check;
alter table public.crm_parceiro_config add constraint crm_parceiro_config_meta_conversoes_liberacao_check
  check (meta_conversoes_status <> 'desligado' or (not checkin_anuncio_ativo and meta_capi_status = 'desligado'));

comment on column public.crm_parceiro_config.meta_conversoes_status is
  'Check-in de anúncio + API de Conversões da Meta: desligado|teste|pago. Ativa se teste|pago e (meta_conversoes_ate nulo ou >= agora). Editado no Workspace.';
comment on column public.crm_parceiro_config.meta_conversoes_ate is
  'Validade da liberação do check-in de anúncio + API de Conversões (fim do dia, Brasília). Nulo = sem prazo.';
comment on column public.crm_parceiro_config.checkin_anuncio_ativo is
  'Interruptor do parceiro (CRM, config.meta_capi): check-in de anúncio no Atendimento. Exige a liberação meta_conversoes_*.';
comment on column public.crm_parceiro_config.checkin_intervalo_horas is
  'Horas de EXPEDIENTE até perguntar de novo (crm_expediente_somar_horas). Padrão 2.';
comment on column public.crm_parceiro_config.meta_capi_status is
  'Interruptor do parceiro (CRM, config.meta_capi): envio à Meta desligado|teste (test_event_code)|ativo. Exige a liberação meta_conversoes_*.';

-- Workspace desligou a liberação: desliga junto os interruptores do parceiro (senão o CHECK barraria o update).
create or replace function app_private.crm_meta_conversoes_ao_desligar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.checkin_anuncio_ativo := false;
  new.meta_capi_status := 'desligado';
  return new;
end $$;
drop trigger if exists crm_meta_conversoes_flag_trg on public.crm_parceiro_config;
create trigger crm_meta_conversoes_flag_trg
  before update of meta_conversoes_status on public.crm_parceiro_config
  for each row when (new.meta_conversoes_status = 'desligado')
  execute function app_private.crm_meta_conversoes_ao_desligar();

-- ---------------------------------------------------------------------------
-- 2. Somar horas de EXPEDIENTE (P1). Reusa a precedência de crm_expediente_aberto
--    (exceção > feriado > semanal > 24 h); parceiro sem cadastro = 24 h (horas corridas).
-- ---------------------------------------------------------------------------
-- ponytail: intervalos que se sobrepõem (virada de dia sobre o dia seguinte) contam em dobro e o horizonte é
-- de 31 dias (sem expediente nesse prazo = horas corridas); trocar por merge de intervalos se alguém cadastrar isso.
-- !!! NUNCA conceder EXECUTE a authenticated/anon: p_parceiro vem do chamador !!!
create or replace function public.crm_expediente_somar_horas(p_parceiro uuid, p_inicio timestamptz, p_horas numeric)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_fuso text;
  v_hoje date;
  v_falta interval := make_interval(secs => (greatest(coalesce(p_horas, 0), 0) * 3600)::double precision);
  v_fim timestamptz;
begin
  select e.fuso into v_fuso from public.crm_expediente e where e.agente_parceiro_id = p_parceiro;
  if not found
     and not exists (select 1 from public.crm_expediente_semana s where s.agente_parceiro_id = p_parceiro)
     and not exists (select 1 from public.crm_expediente_excecoes x where x.agente_parceiro_id = p_parceiro)
     and not exists (select 1 from public.crm_expediente_feriados f where f.agente_parceiro_id = p_parceiro) then
    return p_inicio + v_falta;
  end if;
  v_fuso := coalesce(v_fuso, 'America/Sao_Paulo');
  v_hoje := (p_inicio at time zone v_fuso)::date;

  with dias as (
    select (v_hoje + g)::date as d from generate_series(-1, 31) g
  ), iv as (
    select (d.d + make_interval(mins => m.ini)) at time zone v_fuso as ini,
           (d.d + make_interval(mins => case when m.fim <= m.ini then m.fim + 1440 else m.fim end)) at time zone v_fuso as fim
      from dias d
      cross join lateral app_private.crm_expediente_do_dia(p_parceiro, d.d) x
      cross join lateral jsonb_array_elements(x.intervalos) i
      cross join lateral (select split_part(i->>'inicio', ':', 1)::int * 60 + split_part(i->>'inicio', ':', 2)::int as ini,
                                 split_part(i->>'fim', ':', 1)::int * 60 + split_part(i->>'fim', ':', 2)::int as fim) m
  ), cortado as (  -- só o que resta de expediente a partir de p_inicio
    select greatest(iv.ini, p_inicio) as ini, iv.fim from iv where iv.fim > p_inicio
  ), acum as (
    select c.ini, c.fim, sum(c.fim - c.ini) over (order by c.ini, c.fim) as total from cortado c
  )
  select a.fim - (a.total - v_falta) into v_fim
    from acum a where a.total >= v_falta
   order by a.ini, a.fim limit 1;
  return coalesce(v_fim, p_inicio + v_falta);
end $function$;

comment on function public.crm_expediente_somar_horas(uuid, timestamptz, numeric) is
  'p_inicio + p_horas contadas só dentro do expediente do parceiro. security definer: só service_role (p_parceiro vem do chamador).';
revoke all on function public.crm_expediente_somar_horas(uuid, timestamptz, numeric) from public, anon, authenticated;
grant execute on function public.crm_expediente_somar_horas(uuid, timestamptz, numeric) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Ciclos de check-in (um aberto por conversa)
-- ---------------------------------------------------------------------------
create table if not exists public.crm_anuncio_checkins (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  chat_conversa_id uuid not null references public.chat_conversas (id) on delete cascade,
  ocorrencia_inicial_id bigint null references public.chat_anuncio_ocorrencias (id) on delete set null, -- clique que abriu o ciclo (nulo = tráfego manual)
  margem text null check (margem in ('sim', 'nao')),
  margem_em timestamptz null,
  margem_por uuid null references public.crm_usuarios (id) on delete set null,
  refin text null check (refin in ('sim', 'nao')),
  refin_em timestamptz null,
  refin_por uuid null references public.crm_usuarios (id) on delete set null,
  venda text null check (venda in ('sim', 'nao', 'em_andamento')),
  venda_em timestamptz null,
  venda_por uuid null references public.crm_usuarios (id) on delete set null,
  venda_valor numeric(14,2) null check (venda_valor is null or (venda_valor > 0 and venda_valor <= 10000000)),
  venda_proposta_id uuid null references public.propostas_credito (id) on delete set null,
  proxima_pergunta_em timestamptz not null default now(),  -- nasce vencido (martela na 1ª abertura)
  adiamentos integer not null default 0,
  encerrado_em timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_anuncio_checkins_venda_sim_valor_check check (venda is distinct from 'sim' or venda_valor is not null)
);
-- No máximo 1 ciclo aberto por conversa (corrida de dois atendentes abrindo ao mesmo tempo).
create unique index if not exists crm_anuncio_checkins_aberto_uk
  on public.crm_anuncio_checkins (chat_conversa_id) where encerrado_em is null;
create index if not exists crm_anuncio_checkins_parceiro_idx
  on public.crm_anuncio_checkins (agente_parceiro_id, proxima_pergunta_em) where encerrado_em is null;
create index if not exists crm_anuncio_checkins_conversa_idx
  on public.crm_anuncio_checkins (chat_conversa_id, created_at desc);

comment on table public.crm_anuncio_checkins is
  'Check-in de anúncio: 1 ciclo por conversa YCloud (margem/refin/venda). Escrita: insert/adiar pelo TS, respostas só pela RPC crm_anuncio_checkin_responder.';
comment on column public.crm_anuncio_checkins.venda_valor is
  'Valor do CONTRATO (base da comissão, não a comissão), em reais: vai no Purchase.';

-- Só conversa de instância YCloud do mesmo parceiro; clique inicial da mesma conversa. Não dispara no update de
-- ocorrencia_inicial_id: o "on delete set null" da ocorrência não pode falhar se a conversa foi movida para Baileys.
create or replace function app_private.crm_anuncio_checkin_validar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.chat_conversas c
    join public.chat_instancias i on i.id = c.instancia_id
    where c.id = new.chat_conversa_id and i.agente_parceiro_id = new.agente_parceiro_id and i.provedor = 'ycloud'
  ) then
    raise exception using errcode = 'check_violation', message = 'CHECKIN_INSTANCIA_INVALIDA';
  end if;
  if new.ocorrencia_inicial_id is not null and not exists (
    select 1 from public.chat_anuncio_ocorrencias o
    where o.id = new.ocorrencia_inicial_id and o.chat_conversa_id = new.chat_conversa_id
  ) then
    raise exception using errcode = 'check_violation', message = 'CHECKIN_OCORRENCIA_INVALIDA';
  end if;
  return new;
end $$;
drop trigger if exists crm_anuncio_checkin_validar_trg on public.crm_anuncio_checkins;
create trigger crm_anuncio_checkin_validar_trg
  before insert or update of agente_parceiro_id, chat_conversa_id on public.crm_anuncio_checkins
  for each row execute function app_private.crm_anuncio_checkin_validar();

-- ---------------------------------------------------------------------------
-- 4. Histórico de respostas (só inserção)
-- ---------------------------------------------------------------------------
create table if not exists public.crm_anuncio_checkin_respostas (
  id bigint generated always as identity primary key,
  checkin_id uuid not null references public.crm_anuncio_checkins (id) on delete cascade,
  pergunta text not null check (pergunta in ('margem', 'refin', 'venda')),
  resposta text not null check (resposta in ('sim', 'nao', 'em_andamento')),
  resposta_anterior text null,
  valor numeric(14,2) null,
  proposta_id uuid null,
  motivo_correcao text null check (length(coalesce(motivo_correcao, '')) <= 500),
  evento_ja_enviado boolean not null default false, -- correção depois de o evento sair para a Meta (não dá para desfazer)
  respondido_por uuid null references public.crm_usuarios (id) on delete set null,
  respondido_em timestamptz not null default now(),
  constraint crm_anuncio_checkin_respostas_par_check check (resposta <> 'em_andamento' or pergunta = 'venda')
);
create index if not exists crm_anuncio_checkin_respostas_checkin_idx
  on public.crm_anuncio_checkin_respostas (checkin_id, respondido_em);

-- ---------------------------------------------------------------------------
-- 5. Fila de eventos para a Meta
-- ---------------------------------------------------------------------------
create table if not exists public.crm_meta_eventos (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  checkin_id uuid not null references public.crm_anuncio_checkins (id) on delete cascade,
  ocorrencia_id bigint null references public.chat_anuncio_ocorrencias (id) on delete set null, -- clique atribuído (clid LIDO daqui no envio, nunca copiado)
  evento text not null check (evento in ('QualifiedLead', 'Purchase')),
  event_id text not null,          -- 'brs:<checkin_id>:ql' | 'brs:<checkin_id>:purchase'
  event_time timestamptz not null, -- momento da resposta confirmada
  valor numeric(14,2) null,
  moeda text not null default 'BRL' check (moeda = 'BRL'),
  status text not null default 'pendente' check (status in (
    'pendente', 'processando', 'enviado', 'erro', 'descartado', 'cancelado',
    'sem_clid', 'sem_envio_baileys', 'desligado')),
  teste boolean not null default false,  -- saiu com test_event_code
  tentativas integer not null default 0,
  proximo_retry_em timestamptz not null default now(),
  ultimo_erro text null check (length(coalesce(ultimo_erro, '')) <= 200), -- só código (ex.: 'token_invalido:190'), nunca corpo da Meta
  fbtrace_id text null,
  enviado_em timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_meta_eventos_event_id_key unique (event_id),
  constraint crm_meta_eventos_checkin_evento_key unique (checkin_id, evento),
  constraint crm_meta_eventos_purchase_valor_check check (evento <> 'Purchase' or coalesce(valor, 0) > 0)  -- coalesce: CHECK com nulo passaria
);
create index if not exists crm_meta_eventos_fila_idx
  on public.crm_meta_eventos (proximo_retry_em) where status in ('pendente', 'erro', 'processando');
create index if not exists crm_meta_eventos_parceiro_idx
  on public.crm_meta_eventos (agente_parceiro_id, created_at desc);

comment on table public.crm_meta_eventos is
  'Fila da API de Conversões (business_messaging/WhatsApp). Pronto = status in (pendente, erro) and proximo_retry_em <= now(). Sem PII: o clid fica em chat_anuncio_ocorrencias.';

do $$
declare tabela text;
begin
  foreach tabela in array array['crm_anuncio_checkins', 'crm_meta_eventos'] loop
    execute format('drop trigger if exists set_timestamp on public.%I', tabela);
    execute format('create trigger set_timestamp before update on public.%I for each row execute function public.trigger_set_timestamp()', tabela);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Acesso: RLS ligada sem policy, só service role (padrão 20261007031034)
-- ---------------------------------------------------------------------------
alter table public.crm_anuncio_checkins enable row level security;
alter table public.crm_anuncio_checkin_respostas enable row level security;
alter table public.crm_meta_eventos enable row level security;
revoke all on public.crm_anuncio_checkins, public.crm_anuncio_checkin_respostas, public.crm_meta_eventos
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.crm_anuncio_checkins, public.crm_meta_eventos to service_role;
grant select, insert on public.crm_anuncio_checkin_respostas to service_role;

-- ---------------------------------------------------------------------------
-- 7. RPC atômica de resposta (§1.6 + §3.2)
-- ---------------------------------------------------------------------------
-- Erros (message, para o TS traduzir): checkin_inexistente, checkin_desligado, resposta_invalida,
-- valor_obrigatorio, proposta_invalida, motivo_obrigatorio, prazo_correcao_vencido, correcao_nao_permitida.
-- Correção = trocar uma resposta final (sim/nao, ou o valor/proposta da venda): exige motivo (>= 3), até 7 dias
-- depois do encerramento e (P9) ser o autor da resposta atual OU p_pode_corrigir_qualquer (o TS passa true para
-- quem tem atendimento.responder_qualquer). Conferido sob o lock. em_andamento -> sim/nao não é correção.
-- !!! NUNCA conceder EXECUTE a authenticated/anon: p_parceiro e p_pode_corrigir_qualquer vêm do chamador !!!
-- Rascunho anterior (8 argumentos) sai antes: com as duas, a chamada por nome do PostgREST fica ambígua.
drop function if exists public.crm_anuncio_checkin_responder(uuid, uuid, text, text, numeric, uuid, uuid, text);
create or replace function public.crm_anuncio_checkin_responder(
  p_parceiro uuid,
  p_checkin uuid,
  p_pergunta text,
  p_resposta text,
  p_valor numeric default null,
  p_proposta uuid default null,
  p_usuario uuid default null,
  p_motivo text default null,
  p_pode_corrigir_qualquer boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  c public.crm_anuncio_checkins%rowtype;
  cfg public.crm_parceiro_config%rowtype;
  e public.crm_meta_eventos%rowtype;
  v_atual text;
  v_valor numeric(14,2);
  v_proposta uuid;
  v_correcao boolean;
  v_ja_enviado boolean := false;
  v_corte timestamptz;
  v_oc bigint;
  v_oc_provedor text;
  v_oc_waba text;
  v_status text;
  v_ev text;
  v_desejado boolean;
  v_ev_valor numeric(14,2);
begin
  -- 1. Trava o ciclo e confere a liberação + interruptor do parceiro.
  select * into c from public.crm_anuncio_checkins where id = p_checkin and agente_parceiro_id = p_parceiro for update;
  if not found then raise exception 'checkin_inexistente'; end if;
  select * into cfg from public.crm_parceiro_config where agente_parceiro_id = p_parceiro;
  if not found or not cfg.checkin_anuncio_ativo or cfg.meta_conversoes_status not in ('teste', 'pago')
     or cfg.meta_conversoes_ate < now() then
    raise exception 'checkin_desligado';
  end if;

  -- 2. Valida o par e o valor.
  if p_pergunta is null or p_pergunta not in ('margem', 'refin', 'venda')
     or p_resposta is null or p_resposta not in ('sim', 'nao', 'em_andamento')
     or (p_resposta = 'em_andamento' and p_pergunta <> 'venda') then
    raise exception 'resposta_invalida';
  end if;
  if p_pergunta = 'venda' and p_resposta = 'sim' then
    v_valor := p_valor;
    v_proposta := p_proposta;
    if v_valor is null or v_valor <= 0 then raise exception 'valor_obrigatorio'; end if;
  end if;
  if p_proposta is not null and (v_proposta is null or not exists (
       select 1 from public.propostas_credito pr where pr.id = p_proposta and pr.agente_parceiro_id = p_parceiro)) then
    raise exception 'proposta_invalida';
  end if;

  v_atual := case p_pergunta when 'margem' then c.margem when 'refin' then c.refin else c.venda end;

  -- 3. Mesma resposta (e mesmo valor/proposta): devolve o estado sem gravar (duplo clique).
  if v_atual is distinct from p_resposta or (p_pergunta = 'venda'
     and (c.venda_valor is distinct from v_valor or c.venda_proposta_id is distinct from v_proposta)) then

    v_correcao := coalesce(v_atual in ('sim', 'nao'), false);
    if v_correcao then
      if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'motivo_obrigatorio'; end if;
      if c.encerrado_em < now() - interval '7 days' then raise exception 'prazo_correcao_vencido'; end if;
      if not coalesce(p_pode_corrigir_qualquer, false) and (p_usuario is null or p_usuario is distinct from
           case p_pergunta when 'margem' then c.margem_por when 'refin' then c.refin_por else c.venda_por end) then
        raise exception 'correcao_nao_permitida';
      end if;
    end if;

    -- 4. Grava a resposta.
    if p_pergunta = 'margem' then
      c.margem := p_resposta; c.margem_em := now(); c.margem_por := p_usuario;
    elsif p_pergunta = 'refin' then
      c.refin := p_resposta; c.refin_em := now(); c.refin_por := p_usuario;
    else
      c.venda := p_resposta; c.venda_em := now(); c.venda_por := p_usuario;
      c.venda_valor := v_valor; c.venda_proposta_id := v_proposta;
    end if;

    -- 5. Encerra quando margem e refin respondidos e venda sim/nao; senão reabre e cobra de novo em X h de expediente.
    if c.margem is not null and c.refin is not null and c.venda in ('sim', 'nao') then
      c.encerrado_em := coalesce(c.encerrado_em, now());
    else
      c.encerrado_em := null;
      c.proxima_pergunta_em := public.crm_expediente_somar_horas(p_parceiro, now(), cfg.checkin_intervalo_horas);
    end if;

    update public.crm_anuncio_checkins
       set margem = c.margem, margem_em = c.margem_em, margem_por = c.margem_por,
           refin = c.refin, refin_em = c.refin_em, refin_por = c.refin_por,
           venda = c.venda, venda_em = c.venda_em, venda_por = c.venda_por,
           venda_valor = c.venda_valor, venda_proposta_id = c.venda_proposta_id,
           encerrado_em = c.encerrado_em, proxima_pergunta_em = c.proxima_pergunta_em
     where id = c.id;

    -- 6. Clique atribuído: último com clid até agora, posterior ao encerramento do ciclo anterior (P4).
    select max(x.encerrado_em) into v_corte
      from public.crm_anuncio_checkins x
     where x.chat_conversa_id = c.chat_conversa_id and x.id <> c.id and x.created_at < c.created_at;
    select o.id, i.provedor, i.ycloud_waba_id into v_oc, v_oc_provedor, v_oc_waba
      from public.chat_anuncio_ocorrencias o
      join public.chat_instancias i on i.id = o.instancia_id
     where o.chat_conversa_id = c.chat_conversa_id and o.agente_parceiro_id = p_parceiro
       and o.fonte = 'ctwa' and o.ctwa_clid is not null and o.recebido_em <= now()
       and (v_corte is null or o.recebido_em > v_corte)
     order by o.recebido_em desc, o.id desc
     limit 1;
    v_status := case
      when cfg.meta_capi_status = 'desligado' then 'desligado'
      when v_oc is null then 'sem_clid'
      when v_oc_provedor is distinct from 'ycloud' or v_oc_waba is null then 'sem_envio_baileys'
      else 'pendente' end;

    -- 7. Sincroniza a fila: QualifiedLead = margem OU refin OU venda sim (um só, P2); Purchase = venda sim.
    foreach v_ev in array array['QualifiedLead', 'Purchase'] loop
      v_desejado := case v_ev
        when 'QualifiedLead' then coalesce('sim' = any (array[c.margem, c.refin, c.venda]), false)
        else c.venda is not distinct from 'sim' end;
      v_ev_valor := case when v_ev = 'Purchase' then c.venda_valor end;
      select * into e from public.crm_meta_eventos m where m.checkin_id = c.id and m.evento = v_ev for update;
      if not found then
        if v_desejado then
          insert into public.crm_meta_eventos (agente_parceiro_id, checkin_id, ocorrencia_id, evento, event_id, event_time, valor, status, proximo_retry_em)
          values (p_parceiro, c.id, v_oc, v_ev, 'brs:' || c.id || case when v_ev = 'Purchase' then ':purchase' else ':ql' end,
                  now(), v_ev_valor, v_status, now() + interval '10 minutes')
          on conflict (checkin_id, evento) do nothing;
        end if;
      elsif e.status = 'enviado' or (e.status = 'processando' and v_desejado) then
        -- Já saiu (ou está saindo e continua desejado): nunca desfaz nem reenvia (a Meta não deduplica). Só marca no histórico.
        if not v_desejado or e.valor is distinct from v_ev_valor then v_ja_enviado := true; end if;
      elsif not v_desejado then
        -- Inclui 'processando' (linha travada acima): o cron só pode gravar 'enviado' se ainda estiver 'processando'.
        update public.crm_meta_eventos set status = 'cancelado' where id = e.id and status <> 'cancelado';
      elsif e.status = 'cancelado' then
        -- Nunca saiu: reativa com o MESMO event_id e nova janela de correção.
        update public.crm_meta_eventos
           set status = v_status, ocorrencia_id = v_oc, event_time = now(), valor = v_ev_valor, tentativas = 0,
               proximo_retry_em = now() + interval '10 minutes', ultimo_erro = null, teste = false,
               fbtrace_id = null, enviado_em = null
         where id = e.id;
      elsif e.valor is distinct from v_ev_valor then
        update public.crm_meta_eventos set valor = v_ev_valor where id = e.id;
      end if;
    end loop;

    -- 8. Histórico.
    insert into public.crm_anuncio_checkin_respostas
      (checkin_id, pergunta, resposta, resposta_anterior, valor, proposta_id, motivo_correcao, evento_ja_enviado, respondido_por)
    values (c.id, p_pergunta, p_resposta, v_atual, v_valor, v_proposta,
            case when v_correcao then left(trim(p_motivo), 500) end, v_ja_enviado, p_usuario);
  end if;

  return (
    select jsonb_build_object(
      'checkin', to_jsonb(x),
      'eventos', coalesce((select jsonb_agg(jsonb_build_object('evento', m.evento, 'status', m.status) order by m.evento)
                             from public.crm_meta_eventos m where m.checkin_id = x.id), '[]'::jsonb))
    from public.crm_anuncio_checkins x where x.id = p_checkin);
end $function$;

comment on function public.crm_anuncio_checkin_responder(uuid, uuid, text, text, numeric, uuid, uuid, text, boolean) is
  'Grava 1 resposta do check-in e sincroniza crm_meta_eventos (atraso de 10 min). security definer: NUNCA conceder EXECUTE a authenticated/anon; só service_role.';
revoke all on function public.crm_anuncio_checkin_responder(uuid, uuid, text, text, numeric, uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.crm_anuncio_checkin_responder(uuid, uuid, text, text, numeric, uuid, uuid, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Permissão nova do CRM: config.meta_capi (só master global)
-- ---------------------------------------------------------------------------
insert into public.crm_perfis_permissoes (perfil_id, permissao)
select p.id, 'config.meta_capi'
from public.crm_perfis p
where p.agente_parceiro_id is null and p.chave = 'master'
on conflict do nothing;

reset lock_timeout;
notify pgrst, 'reload schema';
