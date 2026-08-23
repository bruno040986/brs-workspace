-- Número de lote curto por importação (aparece na coluna "Lote Importação"
-- do grid de Prazos, como no ARW).
alter table public.comissionamento_imports
  add column if not exists codigo serial;

create unique index if not exists comissionamento_imports_codigo_idx
  on public.comissionamento_imports (codigo);

notify pgrst, 'reload schema';
