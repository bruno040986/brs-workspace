-- Código sequencial curto e legível (decisão Bruno 24/08/2026), além do UUID:
--   Tabela de Comissão: 1000000001, 1000000002, ...
--   Prazo Comissão:     2000000001, 2000000002, ...
-- Backfill das existentes na ordem de criação; novas recebem da sequência.

-- Tabelas de Comissão -----------------------------------------------------
create sequence if not exists public.tabelas_comissao_codigo_seq start 1000000001;

alter table public.tabelas_comissao
  add column if not exists codigo bigint null;

with numeradas as (
  select id, 1000000000 + row_number() over (order by created_at, id) as novo_codigo
  from public.tabelas_comissao
  where codigo is null
)
update public.tabelas_comissao t
set codigo = numeradas.novo_codigo
from numeradas
where t.id = numeradas.id;

select setval(
  'public.tabelas_comissao_codigo_seq',
  greatest((select coalesce(max(codigo), 1000000000) from public.tabelas_comissao), 1000000000)
);

alter table public.tabelas_comissao
  alter column codigo set default nextval('public.tabelas_comissao_codigo_seq'),
  alter column codigo set not null;

create unique index if not exists tabelas_comissao_codigo_unique_idx
  on public.tabelas_comissao (codigo);

-- Prazos Comissão ---------------------------------------------------------
create sequence if not exists public.prazos_comissao_codigo_seq start 2000000001;

alter table public.prazos_comissao
  add column if not exists codigo bigint null;

with numeradas as (
  select id, 2000000000 + row_number() over (order by created_at, id) as novo_codigo
  from public.prazos_comissao
  where codigo is null
)
update public.prazos_comissao p
set codigo = numeradas.novo_codigo
from numeradas
where p.id = numeradas.id;

select setval(
  'public.prazos_comissao_codigo_seq',
  greatest((select coalesce(max(codigo), 2000000000) from public.prazos_comissao), 2000000000)
);

alter table public.prazos_comissao
  alter column codigo set default nextval('public.prazos_comissao_codigo_seq'),
  alter column codigo set not null;

create unique index if not exists prazos_comissao_codigo_unique_idx
  on public.prazos_comissao (codigo);

notify pgrst, 'reload schema';
