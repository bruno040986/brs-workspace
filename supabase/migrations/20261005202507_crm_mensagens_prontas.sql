-- Mensagens Prontas do Atendimento (CRM AlvoConsig).
-- Tabela NOVA e separada de crm_templates_mensagem de propósito: a fila de
-- campanhas referencia templates com FK restrict e trata ativo=false como
-- "template indisponível" — reaproveitar aquela tabela faria excluir/bloquear
-- uma mensagem pronta quebrar campanhas.
-- Acesso: o CRM usa service role filtrando agente_parceiro_id na aplicação
-- (mesmo padrão de crm_templates_mensagem). Aditiva e idempotente.

create table if not exists public.crm_mensagens_prontas (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id),
  nome text not null check (char_length(nome) between 1 and 80),
  categoria text null check (categoria is null or char_length(categoria) <= 60),
  corpo text not null default '' check (char_length(corpo) <= 4000),
  -- mídia no bucket privado parceiro-midias; *_tipo = MIME detectado pelos bytes
  imagem_path text null,
  imagem_tipo text null check (imagem_tipo is null or imagem_tipo in ('image/png', 'image/jpeg', 'image/webp')),
  audio_path text null,
  audio_tipo text null check (audio_tipo is null or audio_tipo in ('audio/ogg', 'audio/mpeg', 'audio/mp4')),
  bloqueada boolean not null default false,
  uso_count integer not null default 0,
  ordem integer not null default 0,
  criado_por uuid null references public.crm_usuarios (id) on delete set null,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_mensagens_prontas_parceiro_idx
  on public.crm_mensagens_prontas (agente_parceiro_id, deleted_at, bloqueada);
create index if not exists crm_mensagens_prontas_categoria_idx
  on public.crm_mensagens_prontas (agente_parceiro_id, categoria) where deleted_at is null;

drop trigger if exists set_timestamp on public.crm_mensagens_prontas;
create trigger set_timestamp before update on public.crm_mensagens_prontas
  for each row execute function trigger_set_timestamp();

-- Contador de uso atômico (evita ler-somar-gravar na aplicação).
create or replace function public.crm_mensagem_pronta_registrar_uso(p_id uuid, p_agente_parceiro_id uuid)
returns boolean language sql set search_path = public as $$
  with alterada as (
    update public.crm_mensagens_prontas
       set uso_count = uso_count + 1
     where id = p_id and agente_parceiro_id = p_agente_parceiro_id and deleted_at is null and not bloqueada
    returning 1
  )
  select exists (select 1 from alterada);
$$;
revoke all on function public.crm_mensagem_pronta_registrar_uso(uuid, uuid) from public, anon, authenticated;
grant execute on function public.crm_mensagem_pronta_registrar_uso(uuid, uuid) to service_role;

-- RLS — mesmo padrão de crm_templates_mensagem (Workspace lê por permissão;
-- o CRM do parceiro usa service role).
do $$
declare t text;
begin
  t := app_private.enable_rls_if_exists('crm_mensagens_prontas');
  perform app_private.apply_policy(t, 'crm_mensagens_prontas_select_permitted', 'SELECT', 'app_private.has_permission(''alvoconsig-gestao'', ''can_view'')');
end $$;
