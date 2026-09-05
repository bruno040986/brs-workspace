-- ---------------------------------------------------------------------------
-- Tickets de upload direto ao storage (bucket privado parceiro-midias, já
-- criado em 20260829150000): o navegador recebe uma URL assinada de upload,
-- e a finalização só aceita o path gravado no ticket — nunca um path
-- arbitrário. Substitui o envio do arquivo inteiro via Server Action
-- (limite 1 MB do Next / 4,5 MB da Vercel; auditoria item 06).
--
-- Revisão Fable 05/09/2026 (migration veio do repo do CRM): RLS + revogação —
-- a tabela tem tenant, usuário e conversa de cada ticket; só o service_role
-- do CRM lê/escreve.
-- ---------------------------------------------------------------------------
create table public.chat_upload_tickets (
  id uuid primary key,
  agente_parceiro_id uuid not null,
  crm_usuario_id uuid not null,
  chatwoot_conversation_id bigint not null,
  storage_path text not null unique,
  nome text not null,
  mime text not null,
  tamanho_bytes bigint not null check (tamanho_bytes > 0 and tamanho_bytes <= 15728640),
  status text not null check (status in ('pending','finalizing','sent')) default 'pending',
  expira_em timestamptz not null,
  finalizado_em timestamptz,
  created_at timestamptz not null default now()
);
create index chat_upload_tickets_pending_expiry on public.chat_upload_tickets(status, expira_em);
alter table public.chat_upload_tickets enable row level security;
revoke all on public.chat_upload_tickets from public, anon, authenticated;
grant select, insert, update, delete on public.chat_upload_tickets to service_role;
-- Tickets pending/finalizing vencidos (e seus objetos no storage) podem ser
-- removidos por um job de manutenção; ainda não agendado.
