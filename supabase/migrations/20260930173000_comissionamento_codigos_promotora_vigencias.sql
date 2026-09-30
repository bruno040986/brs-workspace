-- Comissionamento: códigos internos da promotora + histórico de vigência.
--
-- Cenário: quando a BRS é subestabelecida zero, a promotora pode pagar a
-- comissão usando códigos próprios, diferentes do código mandatário do banco.
-- Esses códigos são opcionais e uma troca de código não pode apagar o histórico:
-- o importador encerra a versão atual e cria uma nova versão.

alter table public.tabelas_comissao
  add column if not exists codigo_tabela_promotora text null,
  add column if not exists vigencia_inicio timestamptz null,
  add column if not exists vigencia_fim timestamptz null;

update public.tabelas_comissao
set vigencia_inicio = coalesce(created_at, now())
where vigencia_inicio is null;

alter table public.tabelas_comissao
  alter column vigencia_inicio set default now(),
  alter column vigencia_inicio set not null;

alter table public.tabelas_comissao
  drop constraint if exists tabelas_comissao_vigencia_valida;
alter table public.tabelas_comissao
  add constraint tabelas_comissao_vigencia_valida
  check (vigencia_fim is null or vigencia_fim >= vigencia_inicio);

create index if not exists tabelas_comissao_codigo_promotora_idx
  on public.tabelas_comissao (codigo_tabela_promotora)
  where codigo_tabela_promotora is not null and deleted_at is null;

alter table public.prazos_comissao
  add column if not exists codigo_prazo_promotora text null,
  add column if not exists vigencia_inicio timestamptz null,
  add column if not exists vigencia_fim timestamptz null;

update public.prazos_comissao
set vigencia_inicio = coalesce(created_at, now())
where vigencia_inicio is null;

alter table public.prazos_comissao
  alter column vigencia_inicio set default now(),
  alter column vigencia_inicio set not null;

alter table public.prazos_comissao
  drop constraint if exists prazos_comissao_vigencia_valida;
alter table public.prazos_comissao
  add constraint prazos_comissao_vigencia_valida
  check (vigencia_fim is null or vigencia_fim >= vigencia_inicio);

create index if not exists prazos_comissao_codigo_promotora_idx
  on public.prazos_comissao (codigo_prazo_promotora)
  where codigo_prazo_promotora is not null;

comment on column public.tabelas_comissao.codigo_tabela_promotora is
  'Código interno opcional da tabela no sistema da promotora pagadora (subestabelecido zero). Não substitui o código do banco.';
comment on column public.prazos_comissao.codigo_prazo_promotora is
  'Código interno opcional do prazo/linha no sistema da promotora pagadora (subestabelecido zero).';
comment on column public.tabelas_comissao.vigencia_inicio is
  'Início da vigência desta versão da tabela de comissão.';
comment on column public.tabelas_comissao.vigencia_fim is
  'Fim da vigência desta versão. Nulo na versão corrente.';
comment on column public.prazos_comissao.vigencia_inicio is
  'Início da vigência desta versão do prazo de comissão.';
comment on column public.prazos_comissao.vigencia_fim is
  'Fim da vigência desta versão. Nulo na versão corrente.';

-- Versionamento atômico usado pelo importador quando muda o código da promotora.
-- A função recebe todos os dados atuais da planilha em JSON e preserva campos
-- que não fazem parte do layout (por exemplo, oferta) a partir da versão antiga.
create or replace function public.comissionamento_versionar_tabela(
  p_tabela_id uuid,
  p_nova jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_antiga public.tabelas_comissao%rowtype;
  v_nova_id uuid;
  v_agora timestamptz := now();
begin
  select * into v_antiga
  from public.tabelas_comissao
  where id = p_tabela_id and deleted_at is null
  for update;

  if not found then
    raise exception 'Tabela de comissão não encontrada para versionamento.';
  end if;

  update public.tabelas_comissao
  set is_active = false,
      vigencia_fim = v_agora,
      updated_at = v_agora
  where id = p_tabela_id;

  insert into public.tabelas_comissao (
    codigo_tabela_banco,
    codigo_tabela_promotora,
    nome,
    institution_id,
    forma_contrato_id,
    convenio_id,
    tipo_formalizacao_id,
    promotora_id,
    com_seguro,
    observacao,
    id_arw,
    taxa_juros_tipo,
    taxa_juros,
    taxa_juros_min,
    taxa_juros_max,
    oferta,
    is_active,
    deleted_at,
    vigencia_inicio,
    vigencia_fim,
    created_at,
    updated_at
  ) values (
    nullif(btrim(p_nova ->> 'codigo_tabela_banco'), ''),
    nullif(btrim(p_nova ->> 'codigo_tabela_promotora'), ''),
    coalesce(nullif(btrim(p_nova ->> 'nome'), ''), v_antiga.nome),
    coalesce(nullif(p_nova ->> 'institution_id', '')::uuid, v_antiga.institution_id),
    coalesce(nullif(p_nova ->> 'forma_contrato_id', '')::uuid, v_antiga.forma_contrato_id),
    nullif(p_nova ->> 'convenio_id', '')::uuid,
    nullif(p_nova ->> 'tipo_formalizacao_id', '')::uuid,
    nullif(p_nova ->> 'promotora_id', '')::uuid,
    case when p_nova ? 'com_seguro' then (p_nova ->> 'com_seguro')::boolean else v_antiga.com_seguro end,
    coalesce(p_nova ->> 'observacao', ''),
    nullif(btrim(p_nova ->> 'id_arw'), ''),
    nullif(p_nova ->> 'taxa_juros_tipo', ''),
    nullif(p_nova ->> 'taxa_juros', '')::numeric,
    nullif(p_nova ->> 'taxa_juros_min', '')::numeric,
    nullif(p_nova ->> 'taxa_juros_max', '')::numeric,
    v_antiga.oferta,
    true,
    null,
    v_agora,
    null,
    v_agora,
    v_agora
  ) returning id into v_nova_id;

  -- A nova versão da tabela precisa continuar com a mesma grade de prazos.
  -- Encerra os prazos correntes da versão antiga e clona a fotografia deles
  -- para a nova tabela. O passo 2 do importador poderá então versionar apenas
  -- as linhas cujo código/percentual/faixa realmente mudou.
  update public.prazos_comissao
  set is_active = false,
      vigencia_fim = v_agora,
      updated_at = v_agora
  where tabela_comissao_id = p_tabela_id
    and is_active = true
    and vigencia_fim is null;

  insert into public.prazos_comissao (
    tabela_comissao_id,
    codigo_prazo_promotora,
    forma_pagamento,
    valor_inicial,
    valor_final,
    prazo_inicial,
    prazo_final,
    data_base,
    manter_enquadramento,
    comissao,
    emissao,
    seguro,
    forma_pagamento_seguro,
    data_bloqueio,
    lote_importacao,
    id_arw,
    is_active,
    vigencia_inicio,
    vigencia_fim,
    created_at,
    updated_at
  )
  select
    v_nova_id,
    p.codigo_prazo_promotora,
    p.forma_pagamento,
    p.valor_inicial,
    p.valor_final,
    p.prazo_inicial,
    p.prazo_final,
    p.data_base,
    p.manter_enquadramento,
    p.comissao,
    p.emissao,
    p.seguro,
    p.forma_pagamento_seguro,
    p.data_bloqueio,
    p.lote_importacao,
    p.id_arw,
    true,
    v_agora,
    null,
    v_agora,
    v_agora
  from public.prazos_comissao p
  where p.tabela_comissao_id = p_tabela_id
    and p.vigencia_fim = v_agora;

  return v_nova_id;
end;
$$;

create or replace function public.comissionamento_versionar_prazo(
  p_prazo_id uuid,
  p_novo jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_antigo public.prazos_comissao%rowtype;
  v_novo_id uuid;
  v_agora timestamptz := now();
begin
  select * into v_antigo
  from public.prazos_comissao
  where id = p_prazo_id
  for update;

  if not found then
    raise exception 'Prazo de comissão não encontrado para versionamento.';
  end if;

  update public.prazos_comissao
  set is_active = false,
      vigencia_fim = v_agora,
      updated_at = v_agora
  where id = p_prazo_id;

  insert into public.prazos_comissao (
    tabela_comissao_id,
    codigo_prazo_promotora,
    forma_pagamento,
    valor_inicial,
    valor_final,
    prazo_inicial,
    prazo_final,
    data_base,
    manter_enquadramento,
    comissao,
    emissao,
    seguro,
    forma_pagamento_seguro,
    data_bloqueio,
    lote_importacao,
    id_arw,
    is_active,
    vigencia_inicio,
    vigencia_fim,
    created_at,
    updated_at
  ) values (
    coalesce(nullif(p_novo ->> 'tabela_comissao_id', '')::uuid, v_antigo.tabela_comissao_id),
    nullif(btrim(p_novo ->> 'codigo_prazo_promotora'), ''),
    coalesce(nullif(p_novo ->> 'forma_pagamento', ''), v_antigo.forma_pagamento),
    nullif(p_novo ->> 'valor_inicial', '')::numeric,
    nullif(p_novo ->> 'valor_final', '')::numeric,
    coalesce(nullif(p_novo ->> 'prazo_inicial', '')::integer, v_antigo.prazo_inicial),
    coalesce(nullif(p_novo ->> 'prazo_final', '')::integer, v_antigo.prazo_final),
    nullif(p_novo ->> 'data_base', '')::date,
    case when p_novo ? 'manter_enquadramento' then (p_novo ->> 'manter_enquadramento')::boolean else v_antigo.manter_enquadramento end,
    nullif(p_novo ->> 'comissao', '')::numeric,
    nullif(p_novo ->> 'emissao', '')::numeric,
    nullif(p_novo ->> 'seguro', '')::numeric,
    nullif(p_novo ->> 'forma_pagamento_seguro', ''),
    nullif(p_novo ->> 'data_bloqueio', '')::date,
    case when p_novo ? 'lote_importacao' then nullif(p_novo ->> 'lote_importacao', '') else v_antigo.lote_importacao end,
    case when p_novo ? 'id_arw' then nullif(btrim(p_novo ->> 'id_arw'), '') else v_antigo.id_arw end,
    true,
    v_agora,
    null,
    v_agora,
    v_agora
  ) returning id into v_novo_id;

  return v_novo_id;
end;
$$;

revoke all on function public.comissionamento_versionar_tabela(uuid, jsonb) from public;
revoke all on function public.comissionamento_versionar_prazo(uuid, jsonb) from public;
grant execute on function public.comissionamento_versionar_tabela(uuid, jsonb) to service_role;
grant execute on function public.comissionamento_versionar_prazo(uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
