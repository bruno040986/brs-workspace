-- HelpDesk fase 1-2 (14/10/2026): categorização (tipo/área/prioridade),
-- contexto técnico capturado pelo botão "Reportar problema" e anexos de
-- imagem. Tudo ADITIVO: a sessão Claude agendada lê/escreve helpdesk_tickets
-- via service role — nada renomeado/removido, colunas novas com default.
-- `urgente` continua existindo (o trigger de notificação usa): as server
-- actions gravam urgente = (prioridade = 'impede').

alter table public.helpdesk_tickets
  add column if not exists tipo text not null default 'bug',
  add column if not exists area text not null default '',
  add column if not exists prioridade text not null default 'atrapalha',
  add column if not exists contexto_tecnico jsonb;

alter table public.helpdesk_tickets drop constraint if exists helpdesk_tickets_tipo_check;
alter table public.helpdesk_tickets
  add constraint helpdesk_tickets_tipo_check check (tipo in ('bug', 'melhoria', 'ajuste', 'duvida'));

alter table public.helpdesk_tickets drop constraint if exists helpdesk_tickets_prioridade_check;
alter table public.helpdesk_tickets
  add constraint helpdesk_tickets_prioridade_check check (prioridade in ('impede', 'atrapalha', 'sugestao'));

alter table public.helpdesk_tickets drop constraint if exists helpdesk_tickets_area_check;
alter table public.helpdesk_tickets
  add constraint helpdesk_tickets_area_check check (char_length(area) <= 100);

-- Backfill: ticket antigo marcado urgente passa a "impede de trabalhar".
-- (O trigger de notificação só age em mudança de status — este update não notifica.)
update public.helpdesk_tickets
set prioridade = 'impede'
where urgente and prioridade <> 'impede';

-- Anexos (só imagens). Os arquivos ficam no bucket privado `workspace-chat`
-- (mesma rota /api/chat/upload do chat), path `<user_id>/<ts>-<rand>.<ext>`;
-- a tela recebe URL assinada gerada no servidor.
create table if not exists public.helpdesk_anexos (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.helpdesk_tickets (id) on delete cascade,
  path text not null,
  nome text not null default '',
  tamanho bigint not null default 0,
  tipo text not null check (tipo in ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
  enviado_por uuid not null references public.users (id),
  created_at timestamptz not null default now()
);

create index if not exists idx_helpdesk_anexos_ticket on public.helpdesk_anexos (ticket_id);

-- Sem policy de propósito (mesmo padrão de helpdesk_tickets): acesso só pelas
-- server actions (admin client) e pela sessão agendada (service role).
alter table public.helpdesk_anexos enable row level security;

notify pgrst, 'reload schema';
