-- Ajustes Bruno 24/08/2026:
-- 1. Promotora na Tabela de Comissão: credenciamento subestabelecido — a
--    mesma IF pode ter o mesmo código no banco em tabelas diferentes, e quem
--    diferencia é a promotora (ou a ausência dela, quando somos diretos).
-- 2. Grid de Prazos no padrão ARW: campos data_bloqueio e lote_importacao.

alter table public.tabelas_comissao
  add column if not exists promotora_id uuid null references public.promotoras (id);

create index if not exists tabelas_comissao_promotora_idx
  on public.tabelas_comissao (promotora_id) where deleted_at is null;

alter table public.prazos_comissao
  add column if not exists data_bloqueio date null,
  add column if not exists lote_importacao text null;

-- Aliases do importador passam a cobrir promotora.
alter table public.comissionamento_import_aliases
  drop constraint if exists comissionamento_import_aliases_tipo_check;
alter table public.comissionamento_import_aliases
  add constraint comissionamento_import_aliases_tipo_check
  check (tipo in ('financeira', 'convenio', 'forma_contrato', 'tipo_formalizacao', 'promotora'));

notify pgrst, 'reload schema';
