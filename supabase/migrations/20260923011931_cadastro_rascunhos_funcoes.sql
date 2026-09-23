-- Cadastro no Portal Parceiro — identificação de quem preenche + rascunho com
-- retomada por link mágico (plano aprovado pelo Bruno em 23/09/2026; roteiro
-- de execução em docs/ROTEIRO-CADASTRO-RASCUNHO-PORTAL.md).
--
-- 1. corban_cadastro_funcoes — catálogo das funções de quem preenche o
--    cadastro (sócio/administrador, funcionário, contador, outro). Mantido no
--    Workspace em Agente Corban › Cadastros Recebidos › Funções, com a MESMA
--    permissão da lista (agente-corban-cadastros-recebidos, como a subpágina
--    Nuvidio) — sem chave nova, logo sem seed de permissão. O Portal só lê
--    (service role).
-- 2. corban_cadastro_rascunhos — o rascunho do wizard. Nasce quando o
--    preenchedor confirma o e-mail por código de 6 dígitos; guarda o estado do
--    wizard (WizardState do portal) a cada avanço de etapa; retomada por link
--    mágico /cadastro/continuar/<token>. Código e token NUNCA em claro: só o
--    hash sha256, no padrão de corban_onboarding_correcoes. Contém CPF e URLs
--    de documentos → RLS ligada e SEM policy: só service role (portal e
--    workspace) lê/escreve.

create table if not exists public.corban_cadastro_funcoes (
  id uuid primary key default gen_random_uuid(),
  -- Slug estável gerado do nome na criação; é o que fica gravado em
  -- corban_data.preenchedor.funcao_chave. Nunca muda depois de criado.
  chave text not null unique,
  nome text not null,
  -- "Outro": o portal pede um texto livre descrevendo a função.
  exige_descricao boolean not null default false,
  ordem integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_timestamp_corban_cadastro_funcoes
  before update on public.corban_cadastro_funcoes
  for each row execute function trigger_set_timestamp();
alter table public.corban_cadastro_funcoes enable row level security;

insert into public.corban_cadastro_funcoes (chave, nome, exige_descricao, ordem) values
  ('socio_administrador', 'Sócio(a) / Administrador(a)', false, 10),
  ('funcionario',         'Funcionário(a) da empresa',    false, 20),
  ('contador',            'Contador(a) / Contabilidade',  false, 30),
  ('outro',               'Outro',                        true,  90)
on conflict (chave) do nothing;

create table if not exists public.corban_cadastro_rascunhos (
  id uuid primary key default gen_random_uuid(),
  portal_type text not null
    check (portal_type in ('cnpj-ponto-comercial', 'cnpj-home-office', 'pf-home-office')),
  -- Quem preenche: { nome, email, whatsapp, funcao_chave, funcao_nome, funcao_descricao }
  -- (mesmas chaves de corban_data.preenchedor no dicionário do Agente Corban).
  preenchedor jsonb not null default '{}'::jsonb,
  -- Sempre lower(trim()). Não é único: a mesma pessoa pode preencher mais de uma empresa.
  email text not null,
  email_verificado_em timestamptz null,
  -- Código de 6 dígitos enviado por e-mail (Resend): validade 10 min, 5
  -- tentativas, reenvio só após 60 s. Só o hash fica aqui.
  codigo_hash text null,
  codigo_expira_em timestamptz null,
  codigo_enviado_em timestamptz null,
  codigo_tentativas integer not null default 0,
  -- Link mágico de retomada: validade 30 dias, rotaciona a cada envio. Só o hash.
  token_hash text null unique,
  token_expira_em timestamptz null,
  -- Estado completo do wizard (WizardState do portal), salvo a cada avanço de etapa.
  estado jsonb null,
  etapa_atual text null,
  -- Só dígitos; preenchido depois da etapa Empresa (serve à aba "Em preenchimento").
  cnpj text null,
  -- Preenchido no envio final (o submit liga o rascunho ao agente criado).
  agente_parceiro_id uuid null references public.agentes_parceiros(id) on delete set null,
  status text not null default 'aguardando_email'
    check (status in ('aguardando_email', 'em_preenchimento', 'enviado', 'expirado')),
  ultimo_acesso_em timestamptz not null default now(),
  -- Renovado a cada acesso (30 dias sem atividade → some da aba e o link para de valer).
  expira_em timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists corban_cadastro_rascunhos_email_idx
  on public.corban_cadastro_rascunhos (email);
create index if not exists corban_cadastro_rascunhos_status_idx
  on public.corban_cadastro_rascunhos (status, ultimo_acesso_em desc);
create index if not exists corban_cadastro_rascunhos_cnpj_idx
  on public.corban_cadastro_rascunhos (cnpj) where cnpj is not null;
create trigger set_timestamp_corban_cadastro_rascunhos
  before update on public.corban_cadastro_rascunhos
  for each row execute function trigger_set_timestamp();
alter table public.corban_cadastro_rascunhos enable row level security;

notify pgrst, 'reload schema';
