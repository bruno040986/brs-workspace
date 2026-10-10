-- =============================================================================
-- Migration: Conteúdo Central Versionado por Convênio (Fase 2 - Recorte T02 Atualizado R3)
-- Data: 2026-09-29
-- Repositório: brs-workspace
--
-- Tabela criada:
--   - public.convenio_conteudo_site
--
-- Regras de Segurança e Integridade (Aceite T02 & Revisão R3-1 a R3-4):
--   - Versionamento por convênio (versao >= 1, (convenio_id, versao) UNIQUE).
--   - Distinção estrita entre Rascunho (is_draft = true), Publicado (is_publicado = true) e Histórico Arquivado (is_draft = false, is_publicado = false).
--   - Garantia por índices únicos parciais de no máximo 1 Rascunho ativo e 1 versão Publicada ativa por convênio.
--   - RPC transacional com lock (FOR UPDATE) e validação de token de concorrência (p_expected_updated_at).
--   - RLS habilitado com REVOKE ALL de PUBLIC, anon e authenticated.
--   - GRANT de privilégios completos somente para service_role e postgres.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabela: convenio_conteudo_site
-- -----------------------------------------------------------------------------
create table if not exists public.convenio_conteudo_site (
  id uuid primary key default gen_random_uuid(),
  convenio_id uuid not null references public.convenios (id) on delete cascade,
  versao integer not null default 1 constraint convenio_conteudo_site_versao_check check (versao >= 1),
  
  -- Status de publicação, rascunho e revisão humana
  is_publicado boolean not null default false,
  is_draft boolean not null default true,
  pendente_revisao_humana boolean not null default true,
  published_at timestamptz null,
  published_by uuid null,
  created_by uuid null,
  
  -- Textos Principais e Headlines
  titulo_destaque text not null default '',
  subtitulo text not null default '',
  resumo_publico text not null default '',
  hero_headline text null,
  hero_subheadline text null,
  
  -- Componentes Estruturados (JSONB)
  vantagens jsonb not null default '[]'::jsonb
    constraint convenio_conteudo_site_vantagens_is_array check (jsonb_typeof(vantagens) = 'array'),
  faqs jsonb not null default '[]'::jsonb
    constraint convenio_conteudo_site_faqs_is_array check (jsonb_typeof(faqs) = 'array'),
  secoes_ordem jsonb not null default '["hero", "resumo", "vantagens", "faq", "cta", "seo"]'::jsonb
    constraint convenio_conteudo_site_secoes_is_array check (jsonb_typeof(secoes_ordem) = 'array'),
  secoes_visibilidade jsonb not null default '{"hero": true, "resumo": true, "vantagens": true, "faq": true, "cta": true, "seo": true}'::jsonb
    constraint convenio_conteudo_site_visibilidade_is_object check (jsonb_typeof(secoes_visibilidade) = 'object'),
    
  -- SEO & Mídias
  meta_title text null,
  meta_description text null,
  keywords text null,
  cta_texto_botao text not null default 'Simular Agora',
  cta_tipo_destino text not null default 'whatsapp' constraint convenio_conteudo_site_cta_tipo_check check (cta_tipo_destino in ('whatsapp', 'simulador', 'formulario', 'url_customizada', 'link_externo')),
  cta_link_destino text null,
  imagem_destaque_url text null,
  imagem_destaque_alt text null,
  
  -- Whitelist de Variáveis Permitidas para Interpolação Segura no Template
  variaveis_permitidas jsonb not null default '["nome_parceiro", "whatsapp", "email", "cidade", "uf", "cnpj_cpf", "slogan", "razao_social", "endereco_completo"]'::jsonb
    constraint convenio_conteudo_site_variaveis_is_array check (jsonb_typeof(variaveis_permitidas) = 'array'),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Unicidade de Versão por Convênio
  constraint convenio_conteudo_site_convenio_versao_unique unique (convenio_id, versao)
);

-- Índices Físicos de Busca Rápida
create index if not exists convenio_conteudo_site_convenio_idx on public.convenio_conteudo_site (convenio_id);

-- R2-1: ÍNDICE ÚNICO PARCIAL para RASCUNHO (no máximo 1 rascunho ativo por convênio)
create unique index if not exists convenio_conteudo_site_draft_unique_idx
  on public.convenio_conteudo_site (convenio_id)
  where is_draft = true;

-- E2: ÍNDICE ÚNICO PARCIAL para PUBLICADO (exatamente 0 ou 1 versão publicada por convênio)
create unique index if not exists convenio_conteudo_site_publicado_unique_idx 
  on public.convenio_conteudo_site (convenio_id) 
  where is_publicado = true;

-- -----------------------------------------------------------------------------
-- 2. Trigger de Timestamp
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'set_timestamp_convenio_conteudo_site' and tgrelid = 'public.convenio_conteudo_site'::regclass) then
    create trigger set_timestamp_convenio_conteudo_site
      before update on public.convenio_conteudo_site
      for each row execute function public.trigger_set_timestamp();
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3. RPC Transacional com Concorrência para Troca Atômica de Publicação (R3-1)
-- -----------------------------------------------------------------------------
create or replace function public.convenio_conteudo_site_publicar(
  p_convenio_id uuid,
  p_conteudo_id uuid,
  p_user_id uuid default null,
  p_expected_updated_at timestamptz default null
)
returns public.convenio_conteudo_site
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record public.convenio_conteudo_site;
begin
  -- Trava a linha do convênio pai para evitar concorrência entre publicações simultâneas
  perform 1 from public.convenios where id = p_convenio_id for update;

  -- Busca o rascunho alvo com trava FOR UPDATE para validação atômica (R4-2)
  select * into v_record from public.convenio_conteudo_site
  where id = p_conteudo_id and convenio_id = p_convenio_id for update;

  if v_record.id is null then
    raise exception 'CONTEUDO_NAO_ENCONTRADO: Registro de conteúdo central não encontrado para publicação (ID: %, Convênio: %)', p_conteudo_id, p_convenio_id;
  end if;

  if v_record.is_draft is not true then
    raise exception 'ESTADO_INVALIDO: Apenas rascunhos ativos podem ser publicados (ID: %).', p_conteudo_id;
  end if;

  -- R3-1 / R4-2 / R5-1: Rejeição estrita de token NULL e validação exata do timestamptz
  if p_expected_updated_at is null then
    raise exception 'CONFLITO_CONCORRENCIA: O token de revisão (p_expected_updated_at) é obrigatório para publicar.';
  end if;

  if v_record.updated_at <> p_expected_updated_at then
    raise exception 'CONFLITO_CONCORRENCIA: O rascunho foi alterado por outro editor antes da publicação. Recarregue os dados atualizados.';
  end if;

  -- 1. Desmarca e arquiva qualquer versão anteriormente publicada deste convênio
  update public.convenio_conteudo_site
  set is_publicado = false,
      is_draft = false,
      updated_at = now()
  where convenio_id = p_convenio_id and is_publicado = true;

  -- 2. Marca a versão especificada como publicada (is_publicado = true, is_draft = false)
  update public.convenio_conteudo_site
  set is_publicado = true,
      is_draft = false,
      published_at = now(),
      published_by = p_user_id,
      updated_at = now()
  where id = p_conteudo_id and convenio_id = p_convenio_id
  returning * into v_record;

  return v_record;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3b. RPC Transacional para Retirada do Ar / Desativação com Trava de Convênio (R5-2)
-- -----------------------------------------------------------------------------
create or replace function public.convenio_conteudo_site_desativar(
  p_convenio_id uuid,
  p_expected_updated_at timestamptz default null
)
returns public.convenio_conteudo_site
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record public.convenio_conteudo_site;
begin
  -- Trava a linha do convênio pai com a mesma trava usada na publicação para sincronização total
  perform 1 from public.convenios where id = p_convenio_id for update;

  -- Busca a versão atualmente publicada após obter a trava exclusiva
  select * into v_record from public.convenio_conteudo_site
  where convenio_id = p_convenio_id and is_publicado is true for update;

  if v_record.id is null then
    raise exception 'CONTEUDO_NAO_ENCONTRADO: Nenhuma versão publicada encontrada para retirada do ar (Convênio: %).', p_convenio_id;
  end if;

  -- Se o token de revisão esperada foi fornecido, valida contra a versão encontrada
  if p_expected_updated_at is not null and v_record.updated_at <> p_expected_updated_at then
    raise exception 'CONFLITO_CONCORRENCIA: A versão publicada foi alterada por outra operação antes da desativação.';
  end if;

  -- Atualiza a versão publicada desmarcando is_publicado
  update public.convenio_conteudo_site
  set is_publicado = false,
      updated_at = now()
  where id = v_record.id
  returning * into v_record;

  return v_record;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. RLS e Segurança Estrita de Privilégios (Aceite Requisito 1 & E1)
-- -----------------------------------------------------------------------------
alter table public.convenio_conteudo_site enable row level security;

-- Revogação TOTAL de privilégios de PUBLIC, anon e authenticated
revoke all on public.convenio_conteudo_site from PUBLIC, anon, authenticated;
revoke execute on function public.convenio_conteudo_site_publicar from PUBLIC, anon, authenticated;
revoke execute on function public.convenio_conteudo_site_desativar from PUBLIC, anon, authenticated;

-- Permissões completas concedidas estritamente a service_role e postgres
grant select, insert, update, delete on public.convenio_conteudo_site to service_role, postgres;
grant execute on function public.convenio_conteudo_site_publicar to service_role, postgres;
grant execute on function public.convenio_conteudo_site_desativar to service_role, postgres;

notify pgrst, 'reload schema';


