-- ============================================================================
-- Convênio — Base de Conhecimento, Fase 2 (Documentos & FAQ)
-- Spec: docs/SPEC-CONVENIO-BASE-CONHECIMENTO.md §2.9–2.11
-- Tudo aditivo e opcional. RLS ligada sem policy (server-only).
-- Permissões reaproveitadas: workspace-convenios (documentos e FAQ do convênio),
-- sistema-config-instituicoes / sistema-config-credito / workspace-averbadoras
-- (FAQ geral de cada entidade). Nenhuma chave nova.
-- ============================================================================

-- 2.9 convenio_documentos — decretos, roteiros operacionais e outros -----------
create table if not exists public.convenio_documentos (
  id uuid primary key default gen_random_uuid(),
  convenio_id uuid not null references public.convenios (id) on delete cascade,
  tipo text not null check (tipo in ('decreto', 'roteiro', 'outro')),
  -- roteiro operacional pertence a um vínculo Convênio×IF; decreto/outro não
  convenio_instituicao_id uuid null references public.convenio_instituicoes (id) on delete cascade,
  titulo text not null,
  texto text null,
  url text null,
  arquivo_path text null,
  arquivo_nome text null,
  arquivo_mime text null,
  arquivo_tamanho bigint null,
  texto_extraido text null,
  resumo_ia text null,
  ia_status text not null default 'nao_lido' check (ia_status in ('nao_lido', 'processando', 'concluido', 'erro')),
  ia_erro text null,
  ia_modelo text null,
  ia_lido_em timestamptz null,
  ordem integer not null default 0,
  is_active boolean not null default true,
  created_by uuid null references public.users (id),
  updated_by uuid null references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (texto is not null or url is not null or arquivo_path is not null),
  check ((tipo = 'roteiro') = (convenio_instituicao_id is not null))
);
drop trigger if exists set_timestamp_convenio_documentos on public.convenio_documentos;
create trigger set_timestamp_convenio_documentos before update on public.convenio_documentos
  for each row execute function trigger_set_timestamp();
create index if not exists convenio_documentos_convenio_idx on public.convenio_documentos (convenio_id, tipo);
create index if not exists convenio_documentos_ci_idx on public.convenio_documentos (convenio_instituicao_id);

-- roteiro só pode apontar para vínculo do MESMO convênio
create or replace function public.convenio_bc_valida_documento()
returns trigger language plpgsql as $$
begin
  if new.convenio_instituicao_id is not null and not exists (
    select 1 from public.convenio_instituicoes ci
    where ci.id = new.convenio_instituicao_id and ci.convenio_id = new.convenio_id
  ) then
    raise exception 'O vínculo com a instituição não pertence a este convênio.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists trg_convenio_bc_valida_documento on public.convenio_documentos;
create trigger trg_convenio_bc_valida_documento
  before insert or update on public.convenio_documentos
  for each row execute function public.convenio_bc_valida_documento();

-- 2.10 faq_itens — duas visões: geral (na entidade) e do convênio (exceção) ------
create table if not exists public.faq_itens (
  id uuid primary key default gen_random_uuid(),
  escopo text not null check (escopo in ('geral', 'convenio')),
  convenio_id uuid null references public.convenios (id) on delete cascade,
  entidade_tipo text null check (entidade_tipo in ('instituicao_financeira', 'forma_contrato', 'averbadora')),
  entidade_id uuid null,
  categoria text null,
  pergunta text not null,
  resposta text not null,
  ordem integer not null default 0,
  origem text not null default 'manual' check (origem in ('manual', 'ia')),
  documento_id uuid null references public.convenio_documentos (id) on delete set null,
  status text not null default 'ativo' check (status in ('rascunho', 'ativo', 'arquivado')),
  created_by uuid null references public.users (id),
  updated_by uuid null references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- geral: sem convênio e COM entidade dona; convênio: com convênio (entidade = contexto opcional)
  check (
    (escopo = 'geral' and convenio_id is null and entidade_tipo is not null and entidade_id is not null)
    or (escopo = 'convenio' and convenio_id is not null)
  ),
  -- entidade_tipo e entidade_id andam juntos
  check ((entidade_tipo is null) = (entidade_id is null))
);
drop trigger if exists set_timestamp_faq_itens on public.faq_itens;
create trigger set_timestamp_faq_itens before update on public.faq_itens
  for each row execute function trigger_set_timestamp();
create index if not exists faq_itens_entidade_idx on public.faq_itens (escopo, entidade_tipo, entidade_id);
create index if not exists faq_itens_convenio_idx on public.faq_itens (convenio_id);
create index if not exists faq_itens_documento_idx on public.faq_itens (documento_id);

-- entidade_id precisa existir na tabela certa (FK polimórfica via trigger) e o
-- escopo não muda depois de criado (vínculos de convênio dependem dele)
create or replace function public.convenio_bc_valida_faq()
returns trigger language plpgsql as $$
declare v_ok boolean := true;
begin
  if tg_op = 'UPDATE' and new.escopo <> old.escopo then
    raise exception 'O escopo de uma FAQ não pode ser alterado; crie outra FAQ.' using errcode = 'check_violation';
  end if;
  if new.entidade_tipo = 'instituicao_financeira' then
    select exists (select 1 from public.financial_institutions where id = new.entidade_id) into v_ok;
  elsif new.entidade_tipo = 'forma_contrato' then
    select exists (select 1 from public.formas_contrato where id = new.entidade_id) into v_ok;
  elsif new.entidade_tipo = 'averbadora' then
    select exists (select 1 from public.averbadoras where id = new.entidade_id) into v_ok;
  end if;
  if not v_ok then
    raise exception 'Entidade da FAQ não encontrada (%).', new.entidade_tipo using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists trg_convenio_bc_valida_faq on public.faq_itens;
create trigger trg_convenio_bc_valida_faq
  before insert or update on public.faq_itens
  for each row execute function public.convenio_bc_valida_faq();

-- 2.11 convenio_faq_vinculos — FAQ geral importada (por seleção) no convênio -----
create table if not exists public.convenio_faq_vinculos (
  id uuid primary key default gen_random_uuid(),
  convenio_id uuid not null references public.convenios (id) on delete cascade,
  faq_item_id uuid not null references public.faq_itens (id) on delete cascade,
  created_by uuid null references public.users (id),
  created_at timestamptz not null default now(),
  unique (convenio_id, faq_item_id)
);
create index if not exists convenio_faq_vinculos_convenio_idx on public.convenio_faq_vinculos (convenio_id);

-- só FAQ de escopo geral pode ser vinculada
create or replace function public.convenio_bc_valida_faq_vinculo()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.faq_itens where id = new.faq_item_id and escopo = 'geral') then
    raise exception 'Só FAQs de regra geral (da instituição, forma ou averbadora) podem ser importadas no convênio.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists trg_convenio_bc_valida_faq_vinculo on public.convenio_faq_vinculos;
create trigger trg_convenio_bc_valida_faq_vinculo
  before insert or update on public.convenio_faq_vinculos
  for each row execute function public.convenio_bc_valida_faq_vinculo();

-- Bucket privado dos documentos (path: convenios/<convenio_id>/<doc_id>/<nome>) --
insert into storage.buckets (id, name, public)
select 'convenio-documentos', 'convenio-documentos', false
where not exists (select 1 from storage.buckets where id = 'convenio-documentos');

-- RLS: ligada, sem policy (server-only) ------------------------------------------
alter table public.convenio_documentos enable row level security;
alter table public.faq_itens enable row level security;
alter table public.convenio_faq_vinculos enable row level security;
