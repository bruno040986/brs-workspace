-- API QuarkRH — credencial (Auth-token) cifrada no cofre (mesma chave
-- CRM_CREDENTIALS_KEY). Fundação da integração de RH/folha (03/09/2026):
-- primeiro só LEITURA/mapeamento; escrita de volta vem depois, por etapas.
-- Linha única, sem policy de leitura — só o servidor (admin client) lê.

create table if not exists public.quark_config (
  id integer primary key default 1 check (id = 1),
  auth_token_enc text,
  base_url text not null default 'https://api.quark.tec.br/rh/ext',
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users (id)
);

alter table public.quark_config enable row level security;

notify pgrst, 'reload schema';
