-- Perfis de usuário do CRM AlvoConsig (decisão 30/08/2026):
-- chaves de permissão fixas no código; o mapeamento perfil → chaves fica
-- aqui e é editável no Workspace (AlvoConsig › Perfis de Usuário).
-- Perfis globais (agente_parceiro_id nulo); a coluna existe pra um futuro
-- perfil por parceiro. `crm_usuarios.papel` passa a espelhar a chave do perfil.

create table if not exists public.crm_perfis (
  id uuid primary key default gen_random_uuid(),
  chave text not null,
  nome text not null,
  descricao text null,
  agente_parceiro_id uuid null references public.agentes_parceiros (id) on delete cascade,
  ordem integer not null default 0,
  sistema boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists crm_perfis_chave_global_idx on public.crm_perfis (chave) where agente_parceiro_id is null;
create unique index if not exists crm_perfis_chave_parceiro_idx on public.crm_perfis (agente_parceiro_id, chave) where agente_parceiro_id is not null;

create table if not exists public.crm_perfis_permissoes (
  perfil_id uuid not null references public.crm_perfis (id) on delete cascade,
  permissao text not null,
  primary key (perfil_id, permissao)
);

-- papel ganha 'operacional'
alter table public.crm_usuarios drop constraint if exists crm_usuarios_papel_check;
alter table public.crm_usuarios add constraint crm_usuarios_papel_check check (papel in ('master', 'operacional', 'atendente'));

alter table public.crm_usuarios
  add column if not exists perfil_id uuid null references public.crm_perfis (id) on delete set null,
  add column if not exists foto_url text null,
  add column if not exists pode_alterar_foto boolean not null default true;

-- Seed dos 3 perfis do sistema
insert into public.crm_perfis (chave, nome, descricao, ordem, sistema) values
  ('master', 'Master', 'Acesso total ao CRM. Cria usuários, inclusive outros Master.', 1, true),
  ('operacional', 'Operacional', 'Opera leads, campanhas e atendimento; atribui conversas e responde solicitações de simulação. Não cria usuários.', 2, true),
  ('atendente', 'Atendente', 'Atende os leads e conversas atribuídos a ele; participa de campanhas de discadora.', 3, true)
on conflict do nothing;

-- Matriz inicial (chaves = lib/crm/permissoes.ts)
with p as (select id, chave from public.crm_perfis where agente_parceiro_id is null),
m(chave, permissao) as (values
  -- MASTER: tudo
  ('master','leads.ver_todos'),('master','leads.ver_meus'),('master','leads.mover_etapa'),('master','leads.criar'),('master','leads.importar_exportar'),
  ('master','campanhas.ver'),('master','campanhas.criar_editar'),('master','campanhas.pausar_encerrar'),('master','campanhas.participar_discadora'),
  ('master','atendimento.ver_todas'),('master','atendimento.ver_meus_fila'),('master','atendimento.responder_atribuida'),('master','atendimento.responder_qualquer'),
  ('master','atendimento.comentario_interno'),('master','atendimento.atribuir'),('master','atendimento.transferir_qualquer'),('master','atendimento.transferir_operacional_master'),
  ('master','atendimento.ver_sem_lead'),('master','atendimento.enviar_oferta'),('master','atendimento.salvar_arquivos'),
  ('master','chat_interno.usar'),('master','chat_interno.receber_simulacao'),('master','chat_interno.responder_simulacao'),
  ('master','config.ver'),('master','config.editar_canais'),('master','config.usuarios_criar_editar'),('master','config.usuarios_criar_master'),('master','config.scripts'),
  ('master','personalizacao.tema'),('master','personalizacao.logo_parceiro'),('master','personalizacao.propria_foto'),
  -- OPERACIONAL
  ('operacional','leads.ver_todos'),('operacional','leads.ver_meus'),('operacional','leads.mover_etapa'),('operacional','leads.criar'),('operacional','leads.importar_exportar'),
  ('operacional','campanhas.ver'),('operacional','campanhas.criar_editar'),('operacional','campanhas.pausar_encerrar'),('operacional','campanhas.participar_discadora'),
  ('operacional','atendimento.ver_todas'),('operacional','atendimento.ver_meus_fila'),('operacional','atendimento.responder_atribuida'),
  ('operacional','atendimento.comentario_interno'),('operacional','atendimento.atribuir'),('operacional','atendimento.transferir_qualquer'),('operacional','atendimento.transferir_operacional_master'),
  ('operacional','atendimento.ver_sem_lead'),('operacional','atendimento.enviar_oferta'),('operacional','atendimento.salvar_arquivos'),
  ('operacional','chat_interno.usar'),('operacional','chat_interno.receber_simulacao'),('operacional','chat_interno.responder_simulacao'),
  ('operacional','config.ver'),('operacional','config.editar_canais'),('operacional','config.scripts'),
  ('operacional','personalizacao.tema'),('operacional','personalizacao.propria_foto'),
  -- ATENDENTE
  ('atendente','leads.ver_meus'),('atendente','leads.mover_etapa'),
  ('atendente','campanhas.participar_discadora'),
  ('atendente','atendimento.ver_meus_fila'),('atendente','atendimento.responder_atribuida'),('atendente','atendimento.comentario_interno'),
  ('atendente','atendimento.transferir_operacional_master'),('atendente','atendimento.enviar_oferta'),('atendente','atendimento.salvar_arquivos'),
  ('atendente','chat_interno.usar'),
  ('atendente','personalizacao.tema'),('atendente','personalizacao.propria_foto')
)
insert into public.crm_perfis_permissoes (perfil_id, permissao)
select p.id, m.permissao from m join p on p.chave = m.chave
on conflict do nothing;

-- Backfill: perfil_id a partir do papel
update public.crm_usuarios u
set perfil_id = p.id
from public.crm_perfis p
where p.agente_parceiro_id is null and p.chave = u.papel and u.perfil_id is null;

do $$
declare t text;
begin
  t := app_private.enable_rls_if_exists('crm_perfis');
  t := app_private.enable_rls_if_exists('crm_perfis_permissoes');
end $$;

do $$ begin
  create trigger set_timestamp_crm_perfis before update on public.crm_perfis
    for each row execute function trigger_set_timestamp();
exception when duplicate_object then null; end $$;
