-- Amigoz — Fatia 1 (descoberta), 14/09/2026.
--
-- A API do Amigoz (parceiros.amigozconsig.com.br, v1.3.2) autentica com
-- LOGIN DE OPERADOR (usuário + senha → JWT access/refresh) e exige um passo
-- "seleciona-corban" depois do login. Nada de client_id/RSA como a FyDigital.
-- if_credito_config ganha as colunas desse modelo; as da FyDigital ficam
-- nulas pro Amigoz e vice-versa (um card por IF, cada um com seus campos).
--
-- Os schemas de resposta da doc deles estão vazios: a descoberta é chamar de
-- verdade e guardar o retorno bruto. if_credito_chamadas é esse registro
-- (também vira auditoria das chamadas quando o adaptador entrar em uso).
-- A requisição gravada NUNCA contém senha/token (sanitizada no adaptador).

alter table public.if_credito_config
  add column if not exists usuario text,
  add column if not exists senha_enc text,              -- cofre
  add column if not exists corban_id_externo text,      -- id do corban BRS no Amigoz
  add column if not exists refresh_token_enc text;      -- cofre

create table if not exists public.if_credito_chamadas (
  id uuid primary key default gen_random_uuid(),
  instituicao_financeira_id uuid not null references public.financial_institutions (id),
  operacao text not null,                 -- ex.: login, seleciona-corban, convenios, consulta-margem
  metodo text not null,
  caminho text not null,
  requisicao jsonb,                       -- sanitizada (sem senha/token)
  resposta jsonb,                         -- corpo bruto devolvido pela IF
  http_status integer,
  sucesso boolean not null default false,
  duracao_ms integer,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now()
);
create index if not exists idx_if_chamadas_if_data on public.if_credito_chamadas (instituicao_financeira_id, created_at desc);
alter table public.if_credito_chamadas enable row level security;

notify pgrst, 'reload schema';
