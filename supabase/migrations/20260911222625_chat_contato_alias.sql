-- Alias LID<->telefone por instância (proposta Fable 10/09/2026; necessário
-- desde a homologação do disparo em 11/09: a 2ª mensagem do lead chega só
-- com @lid e virava conversa órfã). Tabela de consulta: nenhuma FK para
-- conversas, nada é mesclado ou apagado. Engine (service role) escreve
-- best-effort e lê tolerando ausência; sem policy pública.
--
-- APLICADA em 11/09/2026 22:26 UTC via Supabase MCP (apply_migration), com
-- esta mesma versão registrada em supabase_migrations.schema_migrations —
-- este arquivo é o espelho no repositório; `db push` deve pular a versão.
create table if not exists public.chat_contato_alias (
  id             uuid primary key default gen_random_uuid(),
  conta_id       uuid not null references public.chat_contas(id) on delete cascade,
  instancia_id   uuid not null references public.chat_instancias(id) on delete cascade,
  jid_telefone   text not null,
  lid            text not null,
  origem         text not null check (origem in ('onwhatsapp','retry','inbound','contatos','phone_share')),
  observado_em   timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  conflito_com   text,
  unique (instancia_id, jid_telefone),
  unique (instancia_id, lid)
);
create index if not exists chat_contato_alias_lid_idx on public.chat_contato_alias (lid);
alter table public.chat_contato_alias enable row level security;
comment on table public.chat_contato_alias is 'Par LID<->telefone observado por instância do WhatsApp. Consulta para casar mensagem recebida por @lid com a conversa do telefone. Sem policy: só service role (engine/CRM).';
