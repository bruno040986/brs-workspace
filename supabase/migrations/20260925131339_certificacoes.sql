-- Cadastros Recebidos v2 — Fatia 3: certificações
-- (docs/PLANO-CADASTROS-RECEBIDOS-V2-2026-09-25.md, decisões do Bruno em 25/09).
--
-- Catálogos (grupo inteiro, não por processo):
--   certificadoras            nome, site, logotipo (upload pelo Bruno; bucket público `certificacoes`)
--   certificacao_tipos        LGPD, PLDFT, Crédito Consignado... com a marcação "obrigatório"
--   certificacoes             1 certificadora, nome livre, ligada a N tipos (vínculos)
-- Lançamentos por PESSOA (CPF), reaproveitados entre processos:
--   pessoa_certificacoes      certificação, número, exame, validade, origem (operador|parceiro),
--                             verificado_por/em (conferência no CRCP), evidência (print), processo
-- Regras (no código, src/lib/certificacoes.ts): validade vale para todos os tipos
-- cobertos; vigência por tipo = MAIOR validade; TODOS os obrigatórios vigentes
-- na MESMA pessoa; desmarcar "obrigatório" não apaga lançamento.
-- Correção pelo portal: a RPC submeter_correcao passa a aceitar a resposta do
-- parceiro em itens `analise:certificacoes:cpf:<cpf>` (gravada no item, não
-- no corban_data — o operador confere no CRCP e lança).

-- ---------------------------------------------------------------- catálogos
create table if not exists public.certificadoras (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  site text null,
  logotipo_url text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.certificacao_tipos (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  obrigatorio boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.certificacoes (
  id uuid primary key default gen_random_uuid(),
  certificadora_id uuid not null references public.certificadoras(id) on delete restrict,
  nome text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (certificadora_id, nome)
);

create table if not exists public.certificacao_tipo_vinculos (
  certificacao_id uuid not null references public.certificacoes(id) on delete cascade,
  tipo_id uuid not null references public.certificacao_tipos(id) on delete cascade,
  primary key (certificacao_id, tipo_id)
);

-- ---------------------------------------------------------------- lançamentos por pessoa
create table if not exists public.pessoa_certificacoes (
  id uuid primary key default gen_random_uuid(),
  -- só dígitos
  cpf text not null,
  nome text not null default '',
  certificacao_id uuid not null references public.certificacoes(id) on delete restrict,
  numero text null,
  data_exame date null,
  data_validade date not null,
  origem text not null default 'operador' check (origem in ('operador','parceiro')),
  verificado_por uuid null,
  verificado_em timestamptz null,
  evidencia_id uuid null references public.corban_onboarding_evidencias(id) on delete set null,
  processo_id uuid null references public.corban_onboarding_processos(id) on delete set null,
  agente_parceiro_id uuid null references public.agentes_parceiros(id) on delete set null,
  observacao text null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pessoa_certificacoes_cpf_idx on public.pessoa_certificacoes (cpf);
create index if not exists pessoa_certificacoes_validade_idx on public.pessoa_certificacoes (data_validade);

-- ---------------------------------------------------------------- bucket público dos logotipos
insert into storage.buckets (id, name, public)
select 'certificacoes', 'certificacoes', true
where not exists (select 1 from storage.buckets where id = 'certificacoes');

-- ---------------------------------------------------------------- RLS
-- Catálogos: leitura para quem opera Cadastros Recebidos OU o menu Certificações;
-- escrita só pelo menu Certificações. Lançamentos: leitura/escrita para os dois.
do $$
declare
  t regclass;
  tabela text;
  ler text := 'app_private.has_permission(''workspace-certificacoes'', ''can_view'') or app_private.has_permission(''agente-corban-cadastros-recebidos'', ''can_view'')';
  escrever_catalogo text := 'app_private.has_permission(''workspace-certificacoes'', ''can_edit'')';
  incluir_catalogo text := 'app_private.has_permission(''workspace-certificacoes'', ''can_include'')';
  escrever_lanc text := 'app_private.has_permission(''workspace-certificacoes'', ''can_edit'') or app_private.has_permission(''agente-corban-cadastros-recebidos'', ''can_edit'')';
  incluir_lanc text := 'app_private.has_permission(''workspace-certificacoes'', ''can_include'') or app_private.has_permission(''agente-corban-cadastros-recebidos'', ''can_include'')';
begin
  foreach tabela in array array['certificadoras','certificacao_tipos','certificacoes','certificacao_tipo_vinculos'] loop
    t := app_private.enable_rls_if_exists(tabela);
    perform app_private.apply_policy(t, tabela || '_select_permitted', 'SELECT', ler);
    perform app_private.apply_policy(t, tabela || '_insert_permitted', 'INSERT', null, incluir_catalogo);
    perform app_private.apply_policy(t, tabela || '_update_permitted', 'UPDATE', escrever_catalogo);
    perform app_private.apply_policy(t, tabela || '_delete_permitted', 'DELETE', escrever_catalogo);
  end loop;

  t := app_private.enable_rls_if_exists('pessoa_certificacoes');
  perform app_private.apply_policy(t, 'pessoa_certificacoes_select_permitted', 'SELECT', ler);
  perform app_private.apply_policy(t, 'pessoa_certificacoes_insert_permitted', 'INSERT', null, incluir_lanc);
  perform app_private.apply_policy(t, 'pessoa_certificacoes_update_permitted', 'UPDATE', escrever_lanc);
  perform app_private.apply_policy(t, 'pessoa_certificacoes_delete_permitted', 'DELETE', escrever_lanc);
end $$;

-- ---------------------------------------------------------------- sementes (idempotentes)
insert into public.certificadoras (nome, site) values
  ('ACREFI', 'https://certicrefi.org.br'),
  ('ANEPS', 'https://aneps.org.br'),
  ('FEBRABAN', 'https://certificacaofebraban.org.br'),
  ('ASSBAN', 'https://assban.com.br'),
  ('ANEC', 'https://anecbrasil.com.br')
on conflict (nome) do nothing;

insert into public.certificacao_tipos (nome, obrigatorio) values
  ('Crédito Consignado', true),
  ('Crédito Direto ao Consumidor (CDC)', false),
  ('Crédito Veículo', false),
  ('LGPD', true),
  ('PLDFT', true)
on conflict (nome) do nothing;

-- Só as da ANEC (as demais o Bruno cadastra pela tela).
insert into public.certificacoes (certificadora_id, nome)
select c.id, x.nome
from public.certificadoras c
cross join (values
  ('Certificação ANEC em Crédito Consignado + LGPD + PLDFT'),
  ('Certificação ANEC em CDC (Crédito Direto ao Consumidor) + LGPD + PLDFT'),
  ('Certificação ANEC em Crédito Veículo + LGPD + PLDFT'),
  ('Certificação ANEC Completa + LGPD + PLDFT')
) as x(nome)
where c.nome = 'ANEC'
on conflict (certificadora_id, nome) do nothing;

insert into public.certificacao_tipo_vinculos (certificacao_id, tipo_id)
select ce.id, t.id
from public.certificacoes ce
join public.certificadoras cd on cd.id = ce.certificadora_id and cd.nome = 'ANEC'
join public.certificacao_tipos t on (
     (ce.nome like 'Certificação ANEC em Crédito Consignado%' and t.nome in ('Crédito Consignado', 'LGPD', 'PLDFT'))
  or (ce.nome like 'Certificação ANEC em CDC%' and t.nome in ('Crédito Direto ao Consumidor (CDC)', 'LGPD', 'PLDFT'))
  or (ce.nome like 'Certificação ANEC em Crédito Veículo%' and t.nome in ('Crédito Veículo', 'LGPD', 'PLDFT'))
  or (ce.nome like 'Certificação ANEC Completa%' and t.nome in ('Crédito Consignado', 'Crédito Direto ao Consumidor (CDC)', 'Crédito Veículo', 'LGPD', 'PLDFT'))
)
on conflict do nothing;

-- ---------------------------------------------------------------- permissão nova (regra dos 4 pontos)
-- Menu Agente Corban › Certificações. Seed só para quem tem sistema-usuarios-root.
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, 'workspace-certificacoes', true, true, true, true, true
from public.profile_permissions pp
where pp.resource_name = 'sistema-usuarios-root' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit,
      can_delete = excluded.can_delete, can_activate_inactivate = excluded.can_activate_inactivate;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, 'workspace-certificacoes', true, true, true, true, true
from public.user_permissions up
where up.resource_name = 'sistema-usuarios-root' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit,
      can_delete = excluded.can_delete, can_activate_inactivate = excluded.can_activate_inactivate;

-- ---------------------------------------------------------------- correção pelo portal
-- validar: devolve também o `valor` do item (o portal precisa do CPF/nome da
-- pessoa no item de certificações).
create or replace function public.corban_onboarding_validar_correcao(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_correcao record;
  v_itens jsonb;
  v_corban jsonb;
begin
  select c.*, p.agente_parceiro_id
  into v_correcao
  from public.corban_onboarding_correcoes c
  join public.corban_onboarding_processos p on p.id = c.processo_id
  where c.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');

  if v_correcao.id is null then
    return jsonb_build_object('valido', false, 'motivo', 'nao_encontrado');
  end if;
  if v_correcao.expires_at < now() then
    return jsonb_build_object('valido', false, 'motivo', 'expirado');
  end if;
  if v_correcao.status not in ('pendente_envio', 'enviada', 'aberta') then
    return jsonb_build_object('valido', false, 'motivo', 'encerrada');
  end if;

  update public.corban_onboarding_correcoes
  set status = 'aberta', aberta_em = coalesce(aberta_em, now())
  where id = v_correcao.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', i.id, 'etapa', i.etapa, 'chave', i.chave, 'rotulo', i.rotulo,
    'tipo', i.tipo, 'motivo', i.motivo_reprovacao, 'instrucoes', i.instrucoes_correcao,
    'status', i.status, 'valor', i.valor
  )), '[]'::jsonb)
  into v_itens
  from public.corban_onboarding_itens i
  where i.correcao_id = v_correcao.id;

  select ap.corban_data into v_corban
  from public.agentes_parceiros ap
  where ap.id = v_correcao.agente_parceiro_id;

  return jsonb_build_object(
    'valido', true,
    'correcao_id', v_correcao.id,
    'processo_id', v_correcao.processo_id,
    'agente_parceiro_id', v_correcao.agente_parceiro_id,
    'itens', v_itens,
    'corban_data', coalesce(v_corban, '{}'::jsonb)
  );
end;
$$;

-- submeter: itens de Validação continuam gravando no corban_data; o item de
-- certificações guarda a resposta do parceiro no próprio item.
create or replace function public.corban_onboarding_submeter_correcao(
  p_token text,
  p_respostas jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_correcao record;
  v_item record;
  v_chave text;
  v_valor jsonb;
  v_aplicadas integer := 0;
begin
  select c.*, p.agente_parceiro_id
  into v_correcao
  from public.corban_onboarding_correcoes c
  join public.corban_onboarding_processos p on p.id = c.processo_id
  where c.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');

  if v_correcao.id is null or v_correcao.expires_at < now()
     or v_correcao.status not in ('enviada', 'aberta') then
    return jsonb_build_object('ok', false, 'motivo', 'token_invalido');
  end if;

  for v_chave, v_valor in select key, value from jsonb_each(coalesce(p_respostas, '{}'::jsonb)) loop
    select i.* into v_item
    from public.corban_onboarding_itens i
    where i.correcao_id = v_correcao.id and i.chave = v_chave;
    if v_item.id is null then
      continue; -- chave fora da rodada: ignora silenciosamente
    end if;

    -- Fatia 3: resposta do parceiro sobre certificações fica no item; o
    -- operador confere no CRCP e lança em pessoa_certificacoes.
    if v_chave like 'analise:certificacoes:%' and v_item.tipo = 'analise' then
      update public.corban_onboarding_itens
      set status = 'corrigido',
          valor = coalesce(valor, '{}'::jsonb)
                  || jsonb_build_object('resposta_parceiro', v_valor, 'respondido_em', now())
      where id = v_item.id;
      v_aplicadas := v_aplicadas + 1;
      continue;
    end if;

    if v_item.tipo not in ('informacao', 'documento') or v_chave like 'analise%' then
      continue; -- não editável pelo parceiro
    end if;

    update public.agentes_parceiros
    set corban_data = jsonb_set(coalesce(corban_data, '{}'::jsonb),
                                string_to_array(v_chave, '.')::text[], v_valor, true),
        updated_at = now()
    where id = v_correcao.agente_parceiro_id;

    update public.corban_onboarding_itens
    set status = 'corrigido', valor = v_valor
    where id = v_item.id;
    v_aplicadas := v_aplicadas + 1;
  end loop;

  if v_aplicadas = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'nenhum_item_aplicado');
  end if;

  update public.corban_onboarding_correcoes
  set status = 'corrigida', corrigida_em = now()
  where id = v_correcao.id;

  update public.corban_onboarding_processos
  set status = 'correcao_recebida', updated_at = now()
  where id = v_correcao.processo_id;

  insert into public.corban_onboarding_eventos (processo_id, tipo, detalhe)
  values (v_correcao.processo_id, 'correcao_submetida',
          jsonb_build_object('correcao_id', v_correcao.id, 'itens_aplicados', v_aplicadas));

  return jsonb_build_object('ok', true, 'itens_aplicados', v_aplicadas);
end;
$$;

notify pgrst, 'reload schema';
