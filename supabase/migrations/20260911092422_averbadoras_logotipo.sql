-- Averbadoras: campos de logotipo (11/09/2026), mesmo padrão de
-- financial_institutions.logo_url/logo_wide_url — data URL (base64) gravada
-- direto na coluna, sem Storage.

alter table public.averbadoras
  add column if not exists logo_wide_url text null, -- horizontal 500x200px
  add column if not exists logo_url text null;       -- quadrado 500x500px

notify pgrst, 'reload schema';
