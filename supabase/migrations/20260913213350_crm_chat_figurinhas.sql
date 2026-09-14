-- Biblioteca de figurinhas do chat interno (plano v3 §5). Biblioteca é do
-- PARCEIRO: todo usuário vê e usa; remove quem enviou ou o master. GIFs do
-- GIPHY entram aqui copiados (origem='giphy') — a mensagem do chat referencia
-- o `path` da biblioteca, nunca a CDN externa. Bucket privado parceiro-midias,
-- path figurinhas/<agente_parceiro_id>/<uuid>.<ext>; leitura por URL assinada
-- (assinarAnexoInterno aceita o prefixo figurinhas/<tenant>/).
create table if not exists public.crm_chat_figurinhas (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id),
  path text not null,
  mime text not null,
  largura integer null,
  altura integer null,
  origem text not null default 'upload' check (origem in ('upload', 'giphy')),
  giphy_id text null,
  criado_por uuid null references public.crm_usuarios (id) on delete set null,
  usos integer not null default 0,
  ultimo_uso_em timestamptz null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz null
);
create index if not exists crm_chat_figurinhas_parceiro_idx
  on public.crm_chat_figurinhas (agente_parceiro_id, ultimo_uso_em desc nulls last, usos desc)
  where deleted_at is null;
create unique index if not exists crm_chat_figurinhas_giphy_uidx
  on public.crm_chat_figurinhas (agente_parceiro_id, giphy_id) where giphy_id is not null and deleted_at is null;
alter table public.crm_chat_figurinhas enable row level security;
revoke all on public.crm_chat_figurinhas from public, anon, authenticated;
grant select, insert, update on public.crm_chat_figurinhas to service_role;

notify pgrst, 'reload schema';
