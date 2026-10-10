-- =============================================================================
-- Convênios — conteúdo público v1 (PRJ-1/T-2)
-- Contrato: docs/projetos/CONTRATO-CONVENIOS-PUBLICO-V1.md
-- Depende de 20260928014020_site_builder_conteudo_central.sql.
--
-- - convenios.slug_publico: slug da rota pública GET /api/convenios/publico/v1/{slug}.
-- - convenio_conteudo_site: snapshot_publico (payload congelado na publicação) e
--   revisado_por/revisado_em (revisão humana; qualquer usuário com workspace-convenios can_edit).
-- - convenio_conteudo_site_publicar: exige revisão humana e grava o snapshot na mesma transação.
-- Nenhum grant novo para anon/authenticated: a rota pública lê com service_role.
-- =============================================================================

-- 1. convenios.slug_publico ----------------------------------------------------
alter table public.convenios add column if not exists slug_publico text null;

alter table public.convenios drop constraint if exists convenios_slug_publico_check;
alter table public.convenios add constraint convenios_slug_publico_check
  check (slug_publico is null or slug_publico ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$');

create unique index if not exists convenios_slug_publico_unique_idx
  on public.convenios (slug_publico)
  where slug_publico is not null and deleted_at is null;

-- 2. convenio_conteudo_site: snapshot e revisão --------------------------------
alter table public.convenio_conteudo_site
  add column if not exists snapshot_publico jsonb null,
  add column if not exists revisado_por uuid null references public.users (id) on delete set null,
  add column if not exists revisado_em timestamptz null;

-- 3. Publicar: exige revisão humana e grava o snapshot --------------------------
-- A assinatura muda (p_snapshot no fim). Sem o drop, o create criaria uma sobrecarga
-- e a chamada com 4 argumentos nomeados ficaria ambígua.
drop function if exists public.convenio_conteudo_site_publicar(uuid, uuid, uuid, timestamptz);

create or replace function public.convenio_conteudo_site_publicar(
  p_convenio_id uuid,
  p_conteudo_id uuid,
  p_user_id uuid default null,
  p_expected_updated_at timestamptz default null,
  p_snapshot jsonb default null
)
returns public.convenio_conteudo_site
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record public.convenio_conteudo_site;
  v_slug text;
begin
  -- Trava a linha do convênio pai para evitar concorrência entre publicações simultâneas
  select slug_publico into v_slug from public.convenios where id = p_convenio_id for update;

  select * into v_record from public.convenio_conteudo_site
  where id = p_conteudo_id and convenio_id = p_convenio_id for update;

  if v_record.id is null then
    raise exception 'CONTEUDO_NAO_ENCONTRADO: Registro de conteúdo central não encontrado para publicação (ID: %, Convênio: %)', p_conteudo_id, p_convenio_id;
  end if;

  if v_record.is_draft is not true then
    raise exception 'ESTADO_INVALIDO: Apenas rascunhos ativos podem ser publicados (ID: %).', p_conteudo_id;
  end if;

  if p_expected_updated_at is null then
    raise exception 'CONFLITO_CONCORRENCIA: O token de revisão (p_expected_updated_at) é obrigatório para publicar.';
  end if;

  if v_record.updated_at <> p_expected_updated_at then
    raise exception 'CONFLITO_CONCORRENCIA: O rascunho foi alterado por outro editor antes da publicação. Recarregue os dados atualizados.';
  end if;

  if v_record.pendente_revisao_humana is not false then
    raise exception 'conteudo_nao_revisado';
  end if;

  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'snapshot_obrigatorio';
  end if;

  -- O snapshot congela o slug: tem que bater com o slug atual do convênio (já travado acima).
  if (p_snapshot->>'slug') is distinct from v_slug then
    raise exception 'slug_divergente';
  end if;

  -- 1. Arquiva a versão publicada anterior deste convênio
  update public.convenio_conteudo_site
  set is_publicado = false,
      is_draft = false,
      updated_at = now()
  where convenio_id = p_convenio_id and is_publicado = true;

  -- 2. Publica a versão alvo; versão e data de publicação do snapshot vêm do banco
  update public.convenio_conteudo_site
  set is_publicado = true,
      is_draft = false,
      published_at = now(),
      published_by = p_user_id,
      snapshot_publico = p_snapshot || jsonb_build_object(
        'versao', versao,
        'publicado_em', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ),
      updated_at = now()
  where id = p_conteudo_id and convenio_id = p_convenio_id
  returning * into v_record;

  return v_record;
end;
$$;

revoke execute on function public.convenio_conteudo_site_publicar(uuid, uuid, uuid, timestamptz, jsonb) from PUBLIC, anon, authenticated;
grant execute on function public.convenio_conteudo_site_publicar(uuid, uuid, uuid, timestamptz, jsonb) to service_role, postgres;

notify pgrst, 'reload schema';
