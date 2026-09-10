-- ============================================================================
-- Convênio — Base de Conhecimento, Fase 1 (núcleo)
-- Spec: docs/SPEC-CONVENIO-BASE-CONHECIMENTO.md §2.1–2.8, §3
-- Tudo aditivo e opcional. RLS ligada sem policy (só o servidor lê/escreve).
-- Permissão reaproveitada: workspace-convenios (nenhuma chave nova nesta fase).
-- ============================================================================

-- 2.1 convenios ---------------------------------------------------------------
alter table public.convenios
  add column if not exists endereco text null,
  add column if not exists numero_servidores integer null check (numero_servidores >= 0),
  add column if not exists max_comprometimento_salarial numeric(5,2) null
    check (max_comprometimento_salarial > 0 and max_comprometimento_salarial <= 100),
  add column if not exists prazo_minimo_geral integer null check (prazo_minimo_geral > 0),
  add column if not exists prazo_maximo_geral integer null check (prazo_maximo_geral > 0),
  add column if not exists abrangencia text not null default 'nacional'
    check (abrangencia in ('municipal', 'estadual', 'nacional')),
  add column if not exists bc_observacoes text null;

alter table public.convenios drop constraint if exists convenios_prazo_geral_check;
alter table public.convenios add constraint convenios_prazo_geral_check
  check (prazo_minimo_geral is null or prazo_maximo_geral is null or prazo_minimo_geral <= prazo_maximo_geral);

-- backfill da abrangência a partir da esfera do tipo (Municipal/Estadual; demais = nacional)
update public.convenios c
set abrangencia = case lower(e.nome)
  when 'municipal' then 'municipal'
  when 'estadual' then 'estadual'
  else 'nacional' end
from public.convenio_tipos t
join public.convenio_esferas e on e.id = t.esfera_id
where t.id = c.tipo_convenio_id;

-- 2.2 publicos_atendidos (cadastro global) ------------------------------------
create table if not exists public.publicos_atendidos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  situacao_funcional text null,
  regime_juridico text null,
  tipo_provimento text null,
  descricao text null,
  is_active boolean not null default true,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists publicos_atendidos_nome_unique_idx
  on public.publicos_atendidos ((lower(trim(nome)))) where deleted_at is null;
drop trigger if exists set_timestamp_publicos_atendidos on public.publicos_atendidos;
create trigger set_timestamp_publicos_atendidos before update on public.publicos_atendidos
  for each row execute function trigger_set_timestamp();

insert into public.publicos_atendidos (nome)
select v from (values ('Efetivo'), ('Comissionado'), ('Temporário'), ('CLT'), ('Aposentado'), ('Pensionista')) as s(v)
where not exists (select 1 from public.publicos_atendidos p where lower(trim(p.nome)) = lower(v));

-- 2.3 convenio_publicos --------------------------------------------------------
create table if not exists public.convenio_publicos (
  id uuid primary key default gen_random_uuid(),
  convenio_id uuid not null references public.convenios (id) on delete cascade,
  publico_id uuid not null references public.publicos_atendidos (id),
  observacao text null,
  created_at timestamptz not null default now(),
  unique (convenio_id, publico_id)
);

-- 2.4 convenio_formas_contrato -------------------------------------------------
create table if not exists public.convenio_formas_contrato (
  id uuid primary key default gen_random_uuid(),
  convenio_id uuid not null references public.convenios (id) on delete cascade,
  forma_contrato_id uuid not null references public.formas_contrato (id),
  percentual_margem numeric(5,2) null check (percentual_margem is null or percentual_margem > 0),
  observacao text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (convenio_id, forma_contrato_id)
);
drop trigger if exists set_timestamp_convenio_formas_contrato on public.convenio_formas_contrato;
create trigger set_timestamp_convenio_formas_contrato before update on public.convenio_formas_contrato
  for each row execute function trigger_set_timestamp();

-- 2.5 convenio_instituicoes (vínculo Convênio×IF) ------------------------------
create table if not exists public.convenio_instituicoes (
  id uuid primary key default gen_random_uuid(),
  convenio_id uuid not null references public.convenios (id) on delete cascade,
  financial_institution_id uuid not null references public.financial_institutions (id),
  canais_quitacao text[] not null default '{}',
  modo_orgaos text not null default 'exceto' check (modo_orgaos in ('exceto', 'somente')),
  observacao text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (convenio_id, financial_institution_id)
);
drop trigger if exists set_timestamp_convenio_instituicoes on public.convenio_instituicoes;
create trigger set_timestamp_convenio_instituicoes before update on public.convenio_instituicoes
  for each row execute function trigger_set_timestamp();

-- 2.6 convenio_instituicao_publicos --------------------------------------------
create table if not exists public.convenio_instituicao_publicos (
  id uuid primary key default gen_random_uuid(),
  convenio_instituicao_id uuid not null references public.convenio_instituicoes (id) on delete cascade,
  publico_id uuid not null references public.publicos_atendidos (id),
  unique (convenio_instituicao_id, publico_id)
);

-- 2.7 convenio_instituicao_formas ----------------------------------------------
create table if not exists public.convenio_instituicao_formas (
  id uuid primary key default gen_random_uuid(),
  convenio_instituicao_id uuid not null references public.convenio_instituicoes (id) on delete cascade,
  forma_contrato_id uuid not null references public.formas_contrato (id),
  margem_considerada numeric(5,2) null check (margem_considerada is null or margem_considerada > 0),
  prazo_minimo integer null check (prazo_minimo is null or prazo_minimo > 0),
  prazo_maximo integer null check (prazo_maximo is null or prazo_maximo > 0),
  publicos_restritos uuid[] null,
  observacao text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (convenio_instituicao_id, forma_contrato_id),
  check (prazo_minimo is null or prazo_maximo is null or prazo_minimo <= prazo_maximo)
);
drop trigger if exists set_timestamp_convenio_instituicao_formas on public.convenio_instituicao_formas;
create trigger set_timestamp_convenio_instituicao_formas before update on public.convenio_instituicao_formas
  for each row execute function trigger_set_timestamp();

-- 2.8 orgaos_empregadores (cadastro) + restrições por vínculo -------------------
create table if not exists public.orgaos_empregadores (
  id uuid primary key default gen_random_uuid(),
  convenio_id uuid not null references public.convenios (id),
  nome text not null,
  cnpj text null check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  observacao text null,
  is_active boolean not null default true,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists orgaos_empregadores_convenio_nome_unique_idx
  on public.orgaos_empregadores (convenio_id, (lower(trim(nome)))) where deleted_at is null;
drop trigger if exists set_timestamp_orgaos_empregadores on public.orgaos_empregadores;
create trigger set_timestamp_orgaos_empregadores before update on public.orgaos_empregadores
  for each row execute function trigger_set_timestamp();

create table if not exists public.convenio_instituicao_orgaos (
  id uuid primary key default gen_random_uuid(),
  convenio_instituicao_id uuid not null references public.convenio_instituicoes (id) on delete cascade,
  orgao_id uuid not null references public.orgaos_empregadores (id) on delete cascade,
  unique (convenio_instituicao_id, orgao_id)
);

-- ============================================================================
-- §3 Regras — camada 2 (rede de segurança; a action já valida com mensagem
-- amigável). Só disparam quando os dois lados estão informados.
-- ============================================================================

-- R1: soma das margens destinadas ≤ teto do convênio
create or replace function public.convenio_bc_valida_margens()
returns trigger language plpgsql as $$
declare v_teto numeric(5,2); v_soma numeric;
begin
  select max_comprometimento_salarial into v_teto from public.convenios where id = new.convenio_id;
  if v_teto is null then return new; end if;
  select coalesce(sum(percentual_margem), 0) into v_soma
  from public.convenio_formas_contrato where convenio_id = new.convenio_id;
  if v_soma > v_teto then
    raise exception 'A soma das margens destinadas (%%%) excede o teto de comprometimento do convênio (%%%).', v_soma, v_teto
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists trg_convenio_bc_valida_margens on public.convenio_formas_contrato;
create trigger trg_convenio_bc_valida_margens
  after insert or update of percentual_margem on public.convenio_formas_contrato
  for each row execute function public.convenio_bc_valida_margens();

-- R2: público da IF ⊆ público elegível do convênio
create or replace function public.convenio_bc_valida_publico_if()
returns trigger language plpgsql as $$
declare v_convenio uuid;
begin
  select convenio_id into v_convenio from public.convenio_instituicoes where id = new.convenio_instituicao_id;
  if not exists (select 1 from public.convenio_publicos where convenio_id = v_convenio and publico_id = new.publico_id) then
    raise exception 'Público não está entre os públicos elegíveis do convênio.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists trg_convenio_bc_valida_publico_if on public.convenio_instituicao_publicos;
create trigger trg_convenio_bc_valida_publico_if
  before insert or update on public.convenio_instituicao_publicos
  for each row execute function public.convenio_bc_valida_publico_if();

-- R3/R4/R5/R6: forma operada pela IF dentro do que o convênio permite
create or replace function public.convenio_bc_valida_forma_if()
returns trigger language plpgsql as $$
declare
  v_convenio uuid; v_teto_forma numeric(5,2); v_tem_forma boolean;
  v_min integer; v_max integer; v_publico uuid; v_qtd_publico_if integer;
begin
  select convenio_id into v_convenio from public.convenio_instituicoes where id = new.convenio_instituicao_id;

  -- R3 forma permitida no convênio (+ teto da forma para R4)
  select true, percentual_margem into v_tem_forma, v_teto_forma
  from public.convenio_formas_contrato
  where convenio_id = v_convenio and forma_contrato_id = new.forma_contrato_id;
  if v_tem_forma is not true then
    raise exception 'Forma de contrato não está entre as formas permitidas do convênio.' using errcode = 'check_violation';
  end if;

  -- R4 margem considerada ≤ margem destinada pelo convênio
  if new.margem_considerada is not null and v_teto_forma is not null and new.margem_considerada > v_teto_forma then
    raise exception 'Margem considerada (%%%) excede a margem destinada pelo convênio a esta forma (%%%).', new.margem_considerada, v_teto_forma
      using errcode = 'check_violation';
  end if;

  -- R5 prazos dentro do intervalo geral
  select prazo_minimo_geral, prazo_maximo_geral into v_min, v_max from public.convenios where id = v_convenio;
  if (new.prazo_minimo is not null and v_min is not null and new.prazo_minimo < v_min)
     or (new.prazo_maximo is not null and v_max is not null and new.prazo_maximo > v_max) then
    raise exception 'Prazo fora do intervalo geral do convênio (% a % meses).', v_min, v_max using errcode = 'check_violation';
  end if;

  -- R6 públicos restritos ⊆ público do vínculo (ou do convênio, se o vínculo não restringe)
  if new.publicos_restritos is not null then
    select count(*) into v_qtd_publico_if from public.convenio_instituicao_publicos where convenio_instituicao_id = new.convenio_instituicao_id;
    foreach v_publico in array new.publicos_restritos loop
      if v_qtd_publico_if > 0 then
        if not exists (select 1 from public.convenio_instituicao_publicos
                       where convenio_instituicao_id = new.convenio_instituicao_id and publico_id = v_publico) then
          raise exception 'Público restrito da forma não está entre os públicos atendidos pela instituição neste convênio.' using errcode = 'check_violation';
        end if;
      elsif not exists (select 1 from public.convenio_publicos where convenio_id = v_convenio and publico_id = v_publico) then
        raise exception 'Público restrito da forma não está entre os públicos elegíveis do convênio.' using errcode = 'check_violation';
      end if;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_convenio_bc_valida_forma_if on public.convenio_instituicao_formas;
create trigger trg_convenio_bc_valida_forma_if
  before insert or update on public.convenio_instituicao_formas
  for each row execute function public.convenio_bc_valida_forma_if();

-- órgão da restrição precisa pertencer ao mesmo convênio do vínculo
create or replace function public.convenio_bc_valida_orgao_if()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from public.convenio_instituicoes ci
    join public.orgaos_empregadores o on o.convenio_id = ci.convenio_id
    where ci.id = new.convenio_instituicao_id and o.id = new.orgao_id
  ) then
    raise exception 'Órgão não pertence ao convênio deste vínculo.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists trg_convenio_bc_valida_orgao_if on public.convenio_instituicao_orgaos;
create trigger trg_convenio_bc_valida_orgao_if
  before insert or update on public.convenio_instituicao_orgaos
  for each row execute function public.convenio_bc_valida_orgao_if();

-- ============================================================================
-- §3 RPC de escrita por seção (chamada SÓ pela server action com admin client)
-- p_secao: 'publicos' | 'formas' | 'instituicoes'
--   publicos:     [{ publico_id, observacao }]
--   formas:       [{ forma_contrato_id, percentual_margem, observacao }]
--   instituicoes: [{ financial_institution_id, canais_quitacao[], modo_orgaos, observacao, is_active,
--                    publicos[uuid], orgaos[uuid],
--                    formas[{ forma_contrato_id, margem_considerada, prazo_minimo, prazo_maximo, publicos_restritos[uuid], observacao }] }]
-- Substitui a seção inteira; em 'instituicoes' o vínculo é upsert por IF
-- (mantém o id — documentos/roteiros da Fase 2 apontam para ele) e os filhos
-- do vínculo são recriados.
-- ============================================================================
create or replace function public.convenio_bc_salvar_secao(p_convenio_id uuid, p_secao text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_item jsonb; v_forma jsonb; v_ci uuid; v_ids uuid[] := '{}';
begin
  if not exists (select 1 from public.convenios where id = p_convenio_id and deleted_at is null) then
    raise exception 'Convênio não encontrado.';
  end if;
  if jsonb_typeof(coalesce(p_payload, '[]'::jsonb)) <> 'array' then
    raise exception 'Payload inválido: esperado array.';
  end if;

  if p_secao = 'publicos' then
    delete from public.convenio_publicos where convenio_id = p_convenio_id;
    insert into public.convenio_publicos (convenio_id, publico_id, observacao)
    select p_convenio_id, (i->>'publico_id')::uuid, nullif(trim(i->>'observacao'), '')
    from jsonb_array_elements(p_payload) i
    on conflict (convenio_id, publico_id) do nothing;

  elsif p_secao = 'formas' then
    delete from public.convenio_formas_contrato where convenio_id = p_convenio_id
      and forma_contrato_id not in (select (i->>'forma_contrato_id')::uuid from jsonb_array_elements(p_payload) i);
    insert into public.convenio_formas_contrato (convenio_id, forma_contrato_id, percentual_margem, observacao)
    select p_convenio_id, (i->>'forma_contrato_id')::uuid,
           nullif(i->>'percentual_margem', '')::numeric, nullif(trim(i->>'observacao'), '')
    from jsonb_array_elements(p_payload) i
    on conflict (convenio_id, forma_contrato_id) do update
      set percentual_margem = excluded.percentual_margem, observacao = excluded.observacao;

  elsif p_secao = 'instituicoes' then
    for v_item in select * from jsonb_array_elements(p_payload) loop
      insert into public.convenio_instituicoes (convenio_id, financial_institution_id, canais_quitacao, modo_orgaos, observacao, is_active)
      values (
        p_convenio_id, (v_item->>'financial_institution_id')::uuid,
        coalesce(array(select jsonb_array_elements_text(v_item->'canais_quitacao')), '{}'),
        coalesce(nullif(v_item->>'modo_orgaos', ''), 'exceto'),
        nullif(trim(v_item->>'observacao'), ''),
        coalesce((v_item->>'is_active')::boolean, true)
      )
      on conflict (convenio_id, financial_institution_id) do update
        set canais_quitacao = excluded.canais_quitacao, modo_orgaos = excluded.modo_orgaos,
            observacao = excluded.observacao, is_active = excluded.is_active
      returning id into v_ci;
      v_ids := v_ids || v_ci;

      delete from public.convenio_instituicao_publicos where convenio_instituicao_id = v_ci;
      insert into public.convenio_instituicao_publicos (convenio_instituicao_id, publico_id)
      select v_ci, x::uuid from jsonb_array_elements_text(coalesce(v_item->'publicos', '[]'::jsonb)) x
      on conflict do nothing;

      delete from public.convenio_instituicao_orgaos where convenio_instituicao_id = v_ci;
      insert into public.convenio_instituicao_orgaos (convenio_instituicao_id, orgao_id)
      select v_ci, x::uuid from jsonb_array_elements_text(coalesce(v_item->'orgaos', '[]'::jsonb)) x
      on conflict do nothing;

      delete from public.convenio_instituicao_formas where convenio_instituicao_id = v_ci;
      for v_forma in select * from jsonb_array_elements(coalesce(v_item->'formas', '[]'::jsonb)) loop
        insert into public.convenio_instituicao_formas
          (convenio_instituicao_id, forma_contrato_id, margem_considerada, prazo_minimo, prazo_maximo, publicos_restritos, observacao)
        values (
          v_ci, (v_forma->>'forma_contrato_id')::uuid,
          nullif(v_forma->>'margem_considerada', '')::numeric,
          nullif(v_forma->>'prazo_minimo', '')::integer,
          nullif(v_forma->>'prazo_maximo', '')::integer,
          case when v_forma ? 'publicos_restritos' and jsonb_typeof(v_forma->'publicos_restritos') = 'array'
               then array(select x::uuid from jsonb_array_elements_text(v_forma->'publicos_restritos') x) else null end,
          nullif(trim(v_forma->>'observacao'), '')
        );
      end loop;
    end loop;
    -- vínculos que saíram do payload são removidos (cascateia filhos)
    delete from public.convenio_instituicoes where convenio_id = p_convenio_id and not (id = any (v_ids));

  else
    raise exception 'Seção desconhecida: %', p_secao;
  end if;
end $$;

revoke all on function public.convenio_bc_salvar_secao(uuid, text, jsonb) from public, anon, authenticated;

-- ============================================================================
-- RLS: ligada, sem policy (server-only)
-- ============================================================================
alter table public.publicos_atendidos enable row level security;
alter table public.convenio_publicos enable row level security;
alter table public.convenio_formas_contrato enable row level security;
alter table public.convenio_instituicoes enable row level security;
alter table public.convenio_instituicao_publicos enable row level security;
alter table public.convenio_instituicao_formas enable row level security;
alter table public.orgaos_empregadores enable row level security;
alter table public.convenio_instituicao_orgaos enable row level security;

create index if not exists convenio_publicos_convenio_idx on public.convenio_publicos (convenio_id);
create index if not exists convenio_formas_contrato_convenio_idx on public.convenio_formas_contrato (convenio_id);
create index if not exists convenio_instituicoes_convenio_idx on public.convenio_instituicoes (convenio_id);
create index if not exists convenio_instituicao_formas_ci_idx on public.convenio_instituicao_formas (convenio_instituicao_id);
create index if not exists orgaos_empregadores_convenio_idx on public.orgaos_empregadores (convenio_id);
