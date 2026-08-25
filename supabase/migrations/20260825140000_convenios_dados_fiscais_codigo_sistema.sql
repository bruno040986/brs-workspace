-- =============================================================================
-- Convênios — nome reduzido, código do sistema e dados fiscais (CNPJ.ws)
-- Decisão 24/08/2026 (ver docs/SPEC-CRM-WESALES-CAMPANHAS.md): o "código"
-- antigo (livre, sem origem definida) vira Código ARW — opcional, só usado
-- pelo importador de comissionamento (planilhas vindas do ARW). O código do
-- sistema (sequencial, 5 dígitos, gerado) passa a ser a identidade interna
-- usada na integração com o WeSales (Consignantes/Empregadores) e nos
-- filtros de campanha do AlvoConsig.
-- =============================================================================

create sequence if not exists public.convenios_codigo_sistema_seq;

alter table public.convenios
  add column if not exists nome_reduzido text null,
  add column if not exists codigo_sistema text null,
  add column if not exists cnpj text null,
  add column if not exists razao_social text null,
  add column if not exists cidade text null,
  add column if not exists uf text null,
  add column if not exists cep text null,
  add column if not exists wesales_business_id text null;

-- Backfill em ordem de criação, pra "o primeiro é 00001" valer pros convênios
-- já cadastrados.
with ordenados as (
  select id, row_number() over (order by created_at, id) as rn
  from public.convenios
  where codigo_sistema is null
)
update public.convenios c
set codigo_sistema = lpad(o.rn::text, 5, '0')
from ordenados o
where c.id = o.id;

select setval(
  'public.convenios_codigo_sistema_seq',
  (select coalesce(max(codigo_sistema::int), 0) from public.convenios) + 1,
  false
);

update public.convenios set nome_reduzido = nome where nome_reduzido is null;

alter table public.convenios
  alter column nome_reduzido set not null,
  alter column codigo_sistema set not null,
  alter column codigo_sistema set default lpad(nextval('public.convenios_codigo_sistema_seq')::text, 5, '0');

create unique index if not exists convenios_codigo_sistema_unique_idx
  on public.convenios (codigo_sistema) where deleted_at is null;

comment on column public.convenios.codigo is 'Código ARW (opcional) — só usado para casar com as planilhas de comissão importadas do ARW.';
comment on column public.convenios.codigo_sistema is 'Identidade interna sequencial (00001+) — usada na integração com o WeSales (Consignantes/Empregadores) e nos filtros de campanha do AlvoConsig.';
comment on column public.convenios.wesales_business_id is 'Id do registro de Empresa ("Consignante/Empregador") deste convênio no WeSales — criado/atualizado automaticamente na 1ª importação.';
