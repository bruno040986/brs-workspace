-- Cotas das IAs (módulo Projetos): quanto cada IA já usou de cada cota
-- ("5 horas", "Semanal", "Opus 5.5"...). Nenhuma IA lê a própria cota por API:
-- o dado é informado (Bruno cola /usage, /status na IA, que registra pelo MCP,
-- ou edita na tela). Só o estado atual; sem histórico.
-- Acesso só por service role: RLS ligada SEM policy + revoke de anon/authenticated.

create table if not exists public.projeto_agente_cotas (
  id uuid primary key default gen_random_uuid(),
  agente_id uuid not null references public.projeto_agentes (id) on delete cascade,
  nome text not null check (char_length(btrim(nome)) between 1 and 60),
  -- chave do upsert (agente_id, lower(nome)): coluna gerada porque o PostgREST
  -- não aponta on_conflict para índice de expressão.
  nome_chave text generated always as (lower(nome)) stored,
  percentual_usado numeric(5,2) not null check (percentual_usado between 0 and 100),
  reinicia_em timestamptz null,
  observacao text null check (observacao is null or char_length(observacao) <= 200),
  atualizado_por_usuario_id uuid null references public.users (id),
  atualizado_por_agente_id uuid null references public.projeto_agentes (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projeto_agente_cotas_agente_nome_key unique (agente_id, nome_chave)
);

drop trigger if exists set_timestamp_projeto_agente_cotas on public.projeto_agente_cotas;
create trigger set_timestamp_projeto_agente_cotas before update on public.projeto_agente_cotas
  for each row execute function trigger_set_timestamp();

alter table public.projeto_agente_cotas enable row level security;
revoke all on public.projeto_agente_cotas from anon, authenticated;

notify pgrst, 'reload schema';
