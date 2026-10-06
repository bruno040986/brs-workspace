-- Diagnóstico temporário (captura de anúncios Click-to-WhatsApp): payload SANEADO
-- (sem bytes/base64, textos truncados) de inbounds Baileys que chegariam como
-- "[sem conteúdo]". Escrita só pelo engine (service role); retenção de 7 dias
-- aplicada pelo próprio engine (db.registrarPayloadBruto). Aditiva e idempotente.
create table if not exists public.chat_webhook_raw (
  id bigserial primary key,
  instancia_id uuid not null,
  agente_parceiro_id uuid null,
  message_type text null,
  message_keys text[] not null default '{}',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists chat_webhook_raw_created_idx on public.chat_webhook_raw (created_at);
create index if not exists chat_webhook_raw_instancia_idx on public.chat_webhook_raw (instancia_id, created_at desc);

-- RLS ligada SEM policy: anon/authenticated não leem nem escrevem; service role ignora RLS.
alter table public.chat_webhook_raw enable row level security;
revoke all on public.chat_webhook_raw from anon, authenticated;
