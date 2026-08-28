-- Logotipo do parceiro para personalização do CRM AlvoConsig (dashboard):
-- upload feito pelo próprio master do parceiro, exibido ao lado do nome
-- comercial na barra superior. Bucket público (apenas leitura anônima via
-- URL pública; upload passa exclusivamente pelo service role no server
-- action do AlvoConsig, então RLS de storage não precisa liberar insert).
alter table public.agentes_parceiros add column if not exists logo_url text null;

insert into storage.buckets (id, name, public)
values ('parceiro-logos', 'parceiro-logos', true)
on conflict (id) do nothing;
