-- Amplia o cadastro de Instituições Financeiras parceiras (crédito consignado
-- e outras modalidades): dados da Receita, contatos, redes sociais, SAC e
-- Ouvidoria, fiscal/tributário, financeiro (tipo de vínculo), sistemas e links.
--
-- Colunas existentes reaproveitadas:
--   name      -> Nome Comercial (marca)
--   logo_url  -> Logotipo 500x500px (quadrado)

alter table public.financial_institutions
  add column if not exists cnpj text not null default '',
  add column if not exists razao_social text not null default '',
  add column if not exists institution_type text not null default '',
  add column if not exists linked_bank_code text not null default '',
  add column if not exists linked_bank_name text not null default '',
  add column if not exists logo_wide_url text not null default '',
  add column if not exists general_data jsonb not null default '{}'::jsonb,
  add column if not exists contacts_commercial jsonb not null default '[]'::jsonb,
  add column if not exists contacts_operational jsonb not null default '[]'::jsonb,
  add column if not exists social_media jsonb not null default '{}'::jsonb,
  add column if not exists sac_ouvidoria jsonb not null default '{}'::jsonb,
  add column if not exists fiscal_data jsonb not null default '{}'::jsonb,
  add column if not exists financial_data jsonb not null default '{}'::jsonb,
  add column if not exists systems jsonb not null default '[]'::jsonb,
  add column if not exists links_data jsonb not null default '{}'::jsonb;

-- CNPJ único quando informado (permite registros antigos sem CNPJ)
create unique index if not exists financial_institutions_cnpj_unique_idx
  on public.financial_institutions ((nullif(trim(cnpj), '')))
  where nullif(trim(cnpj), '') is not null;

notify pgrst, 'reload schema';
