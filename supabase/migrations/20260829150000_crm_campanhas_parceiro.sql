-- =============================================================================
-- CRM AlvoConsig — campanhas DO PARCEIRO, cofre de credenciais, templates de
-- mensagem, demografia do lead e nome de exibição do atendente.
--
-- "Campanha" no Workspace (crm_campanhas) é a ALOCAÇÃO da BRS (leads do pool
-- do WeSales → carteira do parceiro). A campanha do PARCEIRO (esta) é como
-- ele recorta a própria carteira e distribui pros atendentes, com ou sem
-- automação (tipos). Decisões: conversa Bruno × Fable 29/08/2026.
-- =============================================================================

-- 1. Atendente: nome que aparece nas mensagens identificando quem atende.
alter table public.crm_usuarios add column if not exists nome_exibicao text null;

-- 2. Lead: demografia pros filtros de campanha (copiada do WeSales na
--    alocação; NULL = não informado — higienização NVTI não é obrigatória).
alter table public.crm_contatos
  add column if not exists nascimento date null,
  add column if not exists sexo text null,
  add column if not exists vinculo text null,
  add column if not exists cidade text null,
  add column if not exists uf text null,
  add column if not exists email text null,
  -- campanha do parceiro em que o lead está AGORA (regra: uma por vez)
  add column if not exists campanha_parceiro_id uuid null;

-- 3. Campanhas do parceiro
create table if not exists public.crm_campanhas_parceiro (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id),
  tipo text not null check (tipo in (
    'manual', 'discadora', 'ia_voz', 'ia_voz_atendente', 'ia_voz_whatsapp',
    'ura_reversa', 'ura_reversa_whatsapp', 'whatsapp_nao_oficial',
    'whatsapp_oficial', 'sms_rcs', 'email'
  )),
  nome text not null,
  descricao text not null default '',
  filtros jsonb not null default '{}'::jsonb,
  atendente_ids uuid[] not null default '{}',
  distribuicao text not null default 'rodizio' check (distribuicao in ('rodizio')),
  redistribuir_atribuidos boolean not null default false,
  -- configuração específica do tipo (cadência da discadora, instâncias, template...)
  config jsonb not null default '{}'::jsonb,
  status text not null default 'ativa' check (status in ('ativa', 'pausada', 'encerrada')),
  qtd_leads integer not null default 0 check (qtd_leads >= 0),
  reaproveitada_de uuid null references public.crm_campanhas_parceiro (id) on delete set null,
  criado_por uuid null references public.crm_usuarios (id) on delete set null,
  pausada_em timestamptz null,
  encerrada_em timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_campanhas_parceiro_parceiro_idx
  on public.crm_campanhas_parceiro (agente_parceiro_id, status, created_at desc);
drop trigger if exists set_timestamp on public.crm_campanhas_parceiro;
create trigger set_timestamp before update on public.crm_campanhas_parceiro
  for each row execute function trigger_set_timestamp();

alter table public.crm_contatos
  drop constraint if exists crm_contatos_campanha_parceiro_id_fkey,
  add constraint crm_contatos_campanha_parceiro_id_fkey
    foreign key (campanha_parceiro_id) references public.crm_campanhas_parceiro (id) on delete set null;
create index if not exists crm_contatos_campanha_parceiro_idx
  on public.crm_contatos (agente_parceiro_id, campanha_parceiro_id) where deleted_at is null;
create index if not exists crm_contatos_filtros_idx
  on public.crm_contatos (agente_parceiro_id, uf, sexo, vinculo) where deleted_at is null;
create index if not exists crm_contatos_nascimento_idx
  on public.crm_contatos (agente_parceiro_id, nascimento) where deleted_at is null;

-- 4. Leads de cada campanha do parceiro (quem recebeu, de quem era antes)
create table if not exists public.crm_campanha_parceiro_leads (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.crm_campanhas_parceiro (id) on delete cascade,
  contato_id uuid not null references public.crm_contatos (id) on delete cascade,
  agente_parceiro_id uuid not null references public.agentes_parceiros (id),
  atendente_id uuid null references public.crm_usuarios (id) on delete set null,
  atendente_anterior_id uuid null references public.crm_usuarios (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (campanha_id, contato_id)
);
create index if not exists crm_campanha_parceiro_leads_campanha_idx
  on public.crm_campanha_parceiro_leads (campanha_id, atendente_id);
create index if not exists crm_campanha_parceiro_leads_contato_idx
  on public.crm_campanha_parceiro_leads (contato_id);

-- 5. Cofre de credenciais do parceiro (discadora, IA de voz, Resend, SMS,
--    provedores oficiais de WhatsApp...). O segredo é cifrado em AES-256-GCM
--    NA APLICAÇÃO (chave em env do CRM, nunca no banco) e só é decifrado no
--    servidor na hora de chamar o provedor. Entrada exclusivamente pela tela.
create table if not exists public.crm_parceiro_credenciais (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id),
  provedor text not null,
  rotulo text not null default '',
  -- base64(iv || ciphertext || tag) — ver brs-alvoconsig/src/lib/crm/cofre.ts
  segredo_cifrado text not null,
  -- o que pode aparecer na tela (ids de campanha, remetente, etc.) — nunca segredo
  campos_publicos jsonb not null default '{}'::jsonb,
  ativo boolean not null default true,
  criado_por uuid null references public.crm_usuarios (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agente_parceiro_id, provedor)
);
drop trigger if exists set_timestamp on public.crm_parceiro_credenciais;
create trigger set_timestamp before update on public.crm_parceiro_credenciais
  for each row execute function trigger_set_timestamp();

-- 6. Templates de mensagem do parceiro (WhatsApp não oficial hoje; SMS/e-mail depois)
create table if not exists public.crm_templates_mensagem (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id),
  canal text not null check (canal in ('whatsapp_nao_oficial', 'whatsapp_oficial', 'sms_rcs', 'email')),
  nome text not null,
  corpo text not null default '',
  -- mídia no bucket privado parceiro-midias (URL assinada na hora de usar)
  midia_path text null,
  midia_tipo text null check (midia_tipo is null or midia_tipo in ('imagem', 'audio')),
  variaveis text[] not null default '{}',
  ativo boolean not null default true,
  criado_por uuid null references public.crm_usuarios (id) on delete set null,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_templates_mensagem_parceiro_idx
  on public.crm_templates_mensagem (agente_parceiro_id, canal) where deleted_at is null;
drop trigger if exists set_timestamp on public.crm_templates_mensagem;
create trigger set_timestamp before update on public.crm_templates_mensagem
  for each row execute function trigger_set_timestamp();

-- 7. Bucket PRIVADO pra mídia de template (áudio/imagem) — nada de policy pra
--    authenticated: upload e URL assinada só via service role no servidor.
insert into storage.buckets (id, name, public)
values ('parceiro-midias', 'parceiro-midias', false)
on conflict (id) do nothing;

-- 8. RLS — mesmo padrão das demais crm_* (Workspace por permissão; o CRM do
--    parceiro usa service role com filtro de parceiro na aplicação). O cofre
--    NÃO tem policy de SELECT: só service role lê.
do $$
declare t text;
begin
  t := app_private.enable_rls_if_exists('crm_campanhas_parceiro');
  perform app_private.apply_policy(t, 'crm_campanhas_parceiro_select_permitted', 'SELECT', 'app_private.has_permission(''alvoconsig-gestao'', ''can_view'')');
  perform app_private.apply_policy(t, 'crm_campanhas_parceiro_update_permitted', 'UPDATE', 'app_private.has_permission(''alvoconsig-gestao'', ''can_edit'')');

  t := app_private.enable_rls_if_exists('crm_campanha_parceiro_leads');
  perform app_private.apply_policy(t, 'crm_campanha_parceiro_leads_select_permitted', 'SELECT', 'app_private.has_permission(''alvoconsig-gestao'', ''can_view'')');

  t := app_private.enable_rls_if_exists('crm_parceiro_credenciais');
  -- sem policies: service role only

  t := app_private.enable_rls_if_exists('crm_templates_mensagem');
  perform app_private.apply_policy(t, 'crm_templates_mensagem_select_permitted', 'SELECT', 'app_private.has_permission(''alvoconsig-gestao'', ''can_view'')');
end $$;
