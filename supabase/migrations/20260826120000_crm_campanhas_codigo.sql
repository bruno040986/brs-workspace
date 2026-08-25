-- =============================================================================
-- Campanhas AlvoConsig — código sequencial (decisão 26/08/2026, ver
-- docs/SPEC-CRM-WESALES-CAMPANHAS.md). Formato <arw_code>-<numero_global>,
-- ex.: df3-1, go4-2, go192-3, df3-4 — sequência ÚNICA pro sistema todo (não
-- por parceiro), gerada uma vez na criação e fixa depois (se o código ARW do
-- parceiro mudar, campanhas antigas mantêm o código histórico; novas
-- continuam a mesma sequência global com o código atual). Vira tag adicional
-- no WeSales (`campanha:<codigo>`), junto da `parceiro:<arw>` que já existe.
-- =============================================================================

create sequence if not exists public.crm_campanhas_codigo_seq;

alter table public.crm_campanhas
  add column if not exists codigo text null;

with ordenadas as (
  select c.id, lower(a.arw_code) as arw_code, row_number() over (order by c.created_at, c.id) as rn
  from public.crm_campanhas c
  join public.agentes_parceiros a on a.id = c.agente_parceiro_id
  where c.codigo is null
)
update public.crm_campanhas c
set codigo = o.arw_code || '-' || o.rn
from ordenadas o
where c.id = o.id;

select setval(
  'public.crm_campanhas_codigo_seq',
  (select count(*) from public.crm_campanhas where codigo is not null) + 1,
  false
);

alter table public.crm_campanhas
  alter column codigo set not null;

create unique index if not exists crm_campanhas_codigo_unique_idx
  on public.crm_campanhas (codigo);

create or replace function public.next_crm_campanha_numero()
returns bigint
language sql
as $$
  select nextval('public.crm_campanhas_codigo_seq');
$$;

comment on column public.crm_campanhas.codigo is 'Código sequencial global (<arw_code_na_criação>-<numero_global>) — identifica a campanha no Workspace e vira tag no WeSales.';
