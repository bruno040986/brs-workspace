-- PRJ-2 T-11 (decisão do Bruno): o expediente da EMPRESA (parceiro) deixa de vir do horário do usuário e do perfil do
-- agente de IA e passa a ter cadastro próprio no CRM (Configurações > Expediente e feriados):
--   crm_expediente            cabeçalho, 1 linha por parceiro (fuso; padrão America/Sao_Paulo). Existir = parceiro configurou.
--   crm_expediente_semana     horário padrão: dia da semana 0-6 (0 = domingo), aberto sim/não, N intervalos.
--   crm_expediente_excecoes   dia específico: data, fechado ou intervalos especiais, motivo.
--   crm_expediente_feriados   feriados do parceiro: data (ou dia/mês todo ano), nome, abrangência, ação (fechado ou
--                             intervalos especiais), origem (importado_nacional da tabela global `feriados` do Workspace, ou manual).
--   crm_expediente_aberto()   função STABLE: aberto agora? próxima abertura, texto do horário do dia e da próxima abertura.
--                             Precedência por data: exceção > feriado > padrão semanal > 24 h (dia sem linha no semanal).
--                             Parceiro sem NADA cadastrado: configurado=false e aberto=true (comportamento atual, 24 h).
-- Intervalos (jsonb): [{"inicio":"08:00","fim":"12:00"}, ...]; fim "24:00" = até meia-noite; fim <= inicio = vira o dia
-- (ex. 22:00-02:00; o intervalo pertence ao dia em que começa).
-- RLS no padrão das tabelas do CRM/engine (agentes_ia_fundacao): ligado e sem policy; só service role. O CRM grava por server
-- action (createAdminClient) depois de checar a permissão `config.expediente` e o parceiro da sessão; o engine lê pela RPC.
-- Permissão nova do CRM `config.expediente`: seed para todo perfil que já tem `config.agente_ia` (master e operacional no
-- seed padrão, e perfis de parceiro que tenham ganhado a chave).
-- Independente das migrations do agente de IA (T-13/T-14); pode ser aplicada antes delas. Idempotente; sem DELETE.

-- 1. Validação de intervalos ---------------------------------------------------------------------------------------------
create or replace function app_private.crm_expediente_intervalos_ok(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p is null or jsonb_typeof(p) <> 'array' then false
    when jsonb_array_length(p) > 6 then false
    else not exists (
      select 1 from jsonb_array_elements(p) e
      where jsonb_typeof(e) <> 'object'
         or coalesce(e->>'inicio', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or coalesce(e->>'fim', '') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
         or e->>'inicio' = e->>'fim'
         or (e->>'inicio' = '00:00' and e->>'fim' = '24:00' and jsonb_array_length(p) > 1)
    )
  end
$$;
revoke all on function app_private.crm_expediente_intervalos_ok(jsonb) from public;
grant execute on function app_private.crm_expediente_intervalos_ok(jsonb) to service_role, authenticated;

-- 2. Tabelas -------------------------------------------------------------------------------------------------------------
create table if not exists public.crm_expediente (
  agente_parceiro_id uuid primary key references public.agentes_parceiros (id) on delete cascade,
  fuso text not null default 'America/Sao_Paulo' check (fuso ~ '^[A-Za-z]+(/[A-Za-z_+-]+)+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.crm_expediente is 'PRJ-2 T-11: cabeçalho do expediente do parceiro (fuso). Existir linha = parceiro configurou o expediente.';

create table if not exists public.crm_expediente_semana (
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  dia_semana smallint not null check (dia_semana between 0 and 6),
  aberto boolean not null default true,
  intervalos jsonb not null default '[]'::jsonb check (app_private.crm_expediente_intervalos_ok(intervalos)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (agente_parceiro_id, dia_semana),
  constraint crm_expediente_semana_aberto_chk check (not aberto or jsonb_array_length(intervalos) > 0)
);
comment on table public.crm_expediente_semana is 'PRJ-2 T-11: horário padrão por dia da semana (0 = domingo). Dia sem linha = aberto 24 h.';

create table if not exists public.crm_expediente_excecoes (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  data date not null,
  fechado boolean not null default true,
  intervalos jsonb not null default '[]'::jsonb check (app_private.crm_expediente_intervalos_ok(intervalos)),
  motivo text null check (motivo is null or length(motivo) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_expediente_excecoes_data_key unique (agente_parceiro_id, data),
  constraint crm_expediente_excecoes_intervalos_chk check (fechado or jsonb_array_length(intervalos) > 0)
);
comment on table public.crm_expediente_excecoes is 'PRJ-2 T-11: horário de um dia específico (fechado ou intervalos especiais). Vence feriado e padrão semanal.';

create table if not exists public.crm_expediente_feriados (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  data date null,
  dia smallint null,
  mes smallint null,
  nome text not null check (length(trim(nome)) between 1 and 120),
  abrangencia text not null default 'nacional' check (abrangencia in ('nacional', 'estadual', 'municipal')),
  uf char(2) null check (uf is null or uf ~ '^[A-Z]{2}$'),
  cidade text null check (cidade is null or length(cidade) <= 120),
  acao text not null default 'fechado' check (acao in ('fechado', 'especial')),
  intervalos jsonb not null default '[]'::jsonb check (app_private.crm_expediente_intervalos_ok(intervalos)),
  origem text not null default 'manual' check (origem in ('importado_nacional', 'manual')),
  feriado_origem_id uuid null references public.feriados (id) on delete set null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_expediente_feriados_quando_chk check (
    (data is not null and dia is null and mes is null)
    or (data is null and dia between 1 and 31 and mes between 1 and 12)
  ),
  constraint crm_expediente_feriados_acao_chk check (acao = 'fechado' or jsonb_array_length(intervalos) > 0),
  -- Importação idempotente: o mesmo feriado global na mesma data entra uma vez só (manual tem origem nula e não conflita).
  constraint crm_expediente_feriados_origem_key unique (agente_parceiro_id, feriado_origem_id, data)
);
comment on table public.crm_expediente_feriados is 'PRJ-2 T-11: feriados do parceiro (data, ou dia/mês todo ano). Vence o padrão semanal; perde para a exceção por data.';

create index if not exists crm_expediente_feriados_data_idx on public.crm_expediente_feriados (agente_parceiro_id, data) where ativo;
create index if not exists crm_expediente_feriados_recorrente_idx on public.crm_expediente_feriados (agente_parceiro_id, mes, dia) where ativo and data is null;

do $$
declare tabela text;
begin
  foreach tabela in array array['crm_expediente', 'crm_expediente_semana', 'crm_expediente_excecoes', 'crm_expediente_feriados'] loop
    execute format('alter table public.%I enable row level security', tabela);
    execute format('revoke all on public.%I from public, anon, authenticated', tabela);
    execute format('grant select, insert, update, delete on public.%I to service_role', tabela);
    execute format('drop trigger if exists set_timestamp on public.%I', tabela);
    execute format('create trigger set_timestamp before update on public.%I for each row execute function trigger_set_timestamp()', tabela);
  end loop;
end $$;

-- 3. Horário de um dia (precedência) -------------------------------------------------------------------------------------
create or replace function app_private.crm_expediente_do_dia(p_parceiro uuid, p_data date)
returns table (fonte text, rotulo text, intervalos jsonb)
language sql
stable
set search_path = ''
as $$
  select x.fonte, x.rotulo, x.intervalos
  from (
    select 1 as pri, 'excecao'::text as fonte, e.motivo as rotulo, case when e.fechado then '[]'::jsonb else e.intervalos end as intervalos
      from public.crm_expediente_excecoes e
     where e.agente_parceiro_id = p_parceiro and e.data = p_data
    union all
    select 2, 'feriado', f.nome, case when f.acao = 'fechado' then '[]'::jsonb else f.intervalos end
      from public.crm_expediente_feriados f
     where f.agente_parceiro_id = p_parceiro and f.ativo
       and (f.data = p_data or (f.data is null and f.dia = extract(day from p_data)::int and f.mes = extract(month from p_data)::int))
    union all
    select 3, 'semanal', null, case when s.aberto then s.intervalos else '[]'::jsonb end
      from public.crm_expediente_semana s
     where s.agente_parceiro_id = p_parceiro and s.dia_semana = extract(dow from p_data)::int
    union all
    select 4, 'padrao', null, '[{"inicio": "00:00", "fim": "24:00"}]'::jsonb
  ) x
  -- Dois feriados no mesmo dia: o fechado vence.
  order by x.pri, (x.intervalos = '[]'::jsonb) desc
  limit 1
$$;
revoke all on function app_private.crm_expediente_do_dia(uuid, date) from public;

-- 4. Aberto agora? -------------------------------------------------------------------------------------------------------
create or replace function public.crm_expediente_aberto(p_parceiro uuid, p_agora timestamptz default now())
returns table (configurado boolean, aberto boolean, proxima_abertura timestamptz, horario_hoje text, proxima_abertura_texto text, fuso text)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_fuso text;
  v_hoje date;
  v_aberto boolean;
  v_prox timestamptz;
  v_local timestamp;
  v_hoje_txt text;
  v_rotulo text;
  v_iv jsonb;
  v_semana text[] := array['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
begin
  select e.fuso into v_fuso from public.crm_expediente e where e.agente_parceiro_id = p_parceiro;
  if not found
     and not exists (select 1 from public.crm_expediente_semana s where s.agente_parceiro_id = p_parceiro)
     and not exists (select 1 from public.crm_expediente_excecoes x where x.agente_parceiro_id = p_parceiro)
     and not exists (select 1 from public.crm_expediente_feriados f where f.agente_parceiro_id = p_parceiro) then
    return query select false, true, null::timestamptz, '24 horas'::text, null::text, 'America/Sao_Paulo'::text;
    return;
  end if;
  v_fuso := coalesce(v_fuso, 'America/Sao_Paulo');
  v_hoje := (p_agora at time zone v_fuso)::date;

  -- Intervalos absolutos de ontem (pode virar o dia) até 31 dias à frente.
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
  )
  select coalesce(bool_or(iv.ini <= p_agora and p_agora < iv.fim), false), min(iv.ini) filter (where iv.ini > p_agora)
    into v_aberto, v_prox
    from iv;
  if v_aberto then v_prox := null; end if;

  select h.rotulo, h.intervalos into v_rotulo, v_iv from app_private.crm_expediente_do_dia(p_parceiro, v_hoje) h;
  if jsonb_array_length(v_iv) = 0 then
    v_hoje_txt := 'fechado' || coalesce(' (' || nullif(trim(v_rotulo), '') || ')', '');
  elsif v_iv = '[{"inicio": "00:00", "fim": "24:00"}]'::jsonb then
    v_hoje_txt := '24 horas';
  else
    select string_agg('das ' || (i->>'inicio') || ' às ' || (i->>'fim'), ' e ' order by i->>'inicio') into v_hoje_txt
      from jsonb_array_elements(v_iv) i;
  end if;

  if v_prox is null then
    return query select true, v_aberto, null::timestamptz, v_hoje_txt, null::text, v_fuso;
    return;
  end if;
  v_local := v_prox at time zone v_fuso;
  return query select true, v_aberto, v_prox, v_hoje_txt,
    case
      when v_local::date = v_hoje then 'hoje às ' || to_char(v_local, 'HH24:MI')
      when v_local::date = v_hoje + 1 then 'amanhã às ' || to_char(v_local, 'HH24:MI')
      else v_semana[extract(dow from v_local)::int + 1] || ' (' || to_char(v_local, 'DD/MM') || ') às ' || to_char(v_local, 'HH24:MI')
    end,
    v_fuso;
end;
$function$;
comment on function public.crm_expediente_aberto(uuid, timestamptz) is
  'PRJ-2 T-11: expediente do parceiro agora. configurado=false = sem cadastro (aberto 24 h; o engine cai no perfil.horario legado). Precedência: exceção > feriado > semanal > 24 h.';
revoke all on function public.crm_expediente_aberto(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.crm_expediente_aberto(uuid, timestamptz) to service_role;

-- 5. Permissão do CRM ----------------------------------------------------------------------------------------------------
-- `config.expediente` (lib/crm/permissoes.ts): para todo perfil que já gerencia os Agentes de IA.
insert into public.crm_perfis_permissoes (perfil_id, permissao)
select distinct pp.perfil_id, 'config.expediente'
from public.crm_perfis_permissoes pp
where pp.permissao = 'config.agente_ia'
on conflict do nothing;
