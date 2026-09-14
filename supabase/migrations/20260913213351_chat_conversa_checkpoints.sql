-- Uma conversa por lead com checkpoint de troca de número (plano v3 §6).
-- Hoje a conversa é chaveada por (instancia_id, jid): trocar a instância de
-- disparo abre conversa nova para o mesmo lead (conferido em 13/09: 92873740
-- 2537→7033, 98639-7086 5009→4435). A partir do P5, `chat_conversas.
-- instancia_id` passa a ser a INSTÂNCIA ATUAL e cada troca vira uma linha
-- aqui, renderizada inline no Atendimento ("continuou pelo número X").
-- Não reaproveita chat_historico_checkpoints (histórico paralelo desligado,
-- chave timeline_id).
create table if not exists public.chat_conversa_checkpoints (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.chat_conversas (id) on delete cascade,
  de_instancia_id uuid null references public.chat_instancias (id),
  para_instancia_id uuid not null references public.chat_instancias (id),
  motivo text not null default 'troca_instancia' check (motivo in ('troca_instancia', 'reatribuicao', 'outro')),
  chatwoot_message_id integer null,
  created_at timestamptz not null default now()
);
create index if not exists chat_conversa_checkpoints_conv_idx on public.chat_conversa_checkpoints (conversa_id, created_at);
-- busca "conversa mais recente deste jid nesta conta" (garantirConversa v2)
create index if not exists chat_conversas_jid_updated_idx on public.chat_conversas (jid, updated_at desc) where eh_grupo = false;
alter table public.chat_conversa_checkpoints enable row level security;
revoke all on public.chat_conversa_checkpoints from public, anon, authenticated;
grant select, insert on public.chat_conversa_checkpoints to service_role;

notify pgrst, 'reload schema';
