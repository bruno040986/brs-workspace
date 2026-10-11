-- ============================================================================
-- Convênios — imagens públicas (PRJ-1/T-21)
-- Logotipo e brasão (1:1) do convênio + galeria (prédio, bandeira, cidade...).
-- Arquivos no bucket PÚBLICO `convenios-publico`; o banco guarda a URL pública.
-- Upload/remoção só pelo service role (server actions de Convênios).
-- Aditivo: nada existente muda de comportamento.
-- ============================================================================

alter table public.convenios add column if not exists logotipo_url text null;
alter table public.convenios add column if not exists brasao_url text null;

create table if not exists public.convenio_imagens (
  id uuid primary key default gen_random_uuid(),
  convenio_id uuid not null references public.convenios (id) on delete cascade,
  url text not null,
  legenda text null check (legenda is null or char_length(legenda) <= 120),
  tipo text not null default 'outro' check (tipo in ('predio', 'bandeira', 'cidade', 'outro')),
  ordem integer not null default 0,
  created_by uuid null references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists convenio_imagens_convenio_ordem_idx on public.convenio_imagens (convenio_id, ordem);

drop trigger if exists set_timestamp_convenio_imagens on public.convenio_imagens;
create trigger set_timestamp_convenio_imagens before update on public.convenio_imagens
  for each row execute function trigger_set_timestamp();

-- RLS ligada sem policy (server-only, service role).
alter table public.convenio_imagens enable row level security;
revoke all on table public.convenio_imagens from anon, authenticated;

-- Bucket público (mesmo padrão de `site-builder-midias`). Sem SVG (pode
-- carregar script); a action ainda confere a assinatura do arquivo. Leitura anônima é
-- pela URL pública (/storage/v1/object/public/...), que não passa por RLS em
-- bucket público. De propósito NÃO há policy de select em storage.objects:
-- ela liberaria listar o bucket pela API, e ninguém precisa listar.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'convenios-publico',
      'convenios-publico',
      true,
      2097152,
      array['image/png', 'image/jpeg', 'image/webp']
    )
    on conflict (id) do update set
      public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
  end if;
end;
$$;

notify pgrst, 'reload schema';
