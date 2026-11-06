-- APLICADA em produção em 06/11/2026 pelo dono (editor SQL do Supabase; não consta em supabase_migrations). Arquivo preservado para o repositório refletir o banco.
-- Etapa 1 da unificação Simulações/Digitações — colunas.
-- Idempotente; sem DROP de dado. Tabelas pequenas em 06/11/2026 (propostas_credito 30 linhas,
-- crm_solicitacoes_operacionais 215, crm_contatos 1.687): ADD COLUMN nulável sem default é só
-- catálogo; CHECK/FK varrem a tabela em milissegundos.
--
-- Decisões (ver README):
--  * Resposta da simulação (valor bruto, seguro): CHAVE TIPADA no jsonb snapshot_condicoes
--    (valorBruto, comSeguro), com CHECK de tipo. A resposta já mora inteira ali (inclusive sem
--    lead) e é copiada para propostas_credito.condicoes_snapshot; coluna duplicaria a fonte.
--    Quem filtra/soma é a proposta, que ganha colunas de verdade.
--  * Vínculo do servidor: catálogo JÁ EXISTE (publicos_atendidos + convenio_publicos).
--    publico_id no contato e na proposta; vinculo_texto = fallback (padrão instituicao_texto).
--    Na solicitação vai no payload (publicoId), igual convenio/matricula hoje.
--    Lista oficial = publicos_atendidos + "Outros" (inserido na migration de catálogo).
--    crm_contatos.vinculo (texto) CONTINUA: é o que o filtro de campanhas e a IA usam. Regra da
--    app: ao escolher do catálogo grava publico_id E vinculo = nome do catálogo; em "Outros"
--    grava publico_id = Outros e vinculo = texto livre. Assim o filtro atual não quebra.
--  * Cancelamento: SEM coluna nova. Solicitação = concluido_em com status='cancelado';
--    proposta = finalizada_em com grupo='cancelado' (0 linhas canceladas sem a data hoje).
--  * Hora do pagamento: pago_em timestamptz ao lado de data_pagamento_cliente (que continua a
--    base do dashboard). CHECK amarra os dois no fuso America/Sao_Paulo. SEM backfill (dono).

-- ---------------------------------------------------------------------------
-- 0) Alvo da FK composta com o tenant em crm_ofertas (redundante com a PK; o Postgres exige)
-- ---------------------------------------------------------------------------
create unique index if not exists crm_ofertas_id_parceiro_uq
  on public.crm_ofertas (id, agente_parceiro_id);

-- ---------------------------------------------------------------------------
-- 1) propostas_credito
-- ---------------------------------------------------------------------------
alter table public.propostas_credito
  add column if not exists com_seguro boolean null,               -- null = não informado
  add column if not exists pago_em timestamptz null,              -- momento do pagamento ao cliente
  add column if not exists oferta_id uuid null,                   -- FK composta abaixo
  add column if not exists publico_id uuid null references public.publicos_atendidos (id),
  add column if not exists vinculo_texto text null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'propostas_credito_oferta_tenant_fk') then
    -- crm_ofertas cascateia com o contato no expurgo: só a oferta some, a proposta fica.
    alter table public.propostas_credito add constraint propostas_credito_oferta_tenant_fk
      foreign key (oferta_id, agente_parceiro_id)
      references public.crm_ofertas (id, agente_parceiro_id) on delete set null (oferta_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'propostas_credito_pago_em_chk') then
    -- pago_em só com a data preenchida e no MESMO dia (horário de Brasília).
    alter table public.propostas_credito add constraint propostas_credito_pago_em_chk
      check (pago_em is null or (data_pagamento_cliente is not null
             and (pago_em at time zone 'America/Sao_Paulo')::date = data_pagamento_cliente));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'propostas_credito_vinculo_texto_chk') then
    alter table public.propostas_credito add constraint propostas_credito_vinculo_texto_chk
      check (vinculo_texto is null or char_length(vinculo_texto) <= 120);
  end if;
end $$;

comment on column public.propostas_credito.com_seguro is 'Proposta com seguro (copiado de condicoes_snapshot.comSeguro ao solicitar digitação; editável). Null = não informado.';
comment on column public.propostas_credito.pago_em is 'Data/hora do pagamento ao cliente. Opcional; quando preenchido, o dia (America/Sao_Paulo) = data_pagamento_cliente.';
comment on column public.propostas_credito.oferta_id is 'crm_ofertas da simulação (crm_solicitacoes_operacionais.oferta_id), gravado em solicitarDigitacao. Null sem lead ou após expurgo.';
comment on column public.propostas_credito.publico_id is 'Vínculo do servidor (catálogo publicos_atendidos). vinculo_texto é o fallback livre.';

-- Backfill oferta_id: só onde a simulação tem oferta viva do MESMO tenant (FK composta garante).
update public.propostas_credito p
   set oferta_id = s.oferta_id
  from public.crm_solicitacoes_operacionais s
  join public.crm_ofertas o on o.id = s.oferta_id and o.agente_parceiro_id = s.agente_parceiro_id
 where p.solicitacao_id = s.id
   and p.agente_parceiro_id = s.agente_parceiro_id
   and p.oferta_id is null
   and s.oferta_id is not null;

-- pago_em: SEM backfill (decisão do dono). Nulo = "hora não informada".
-- ATENÇÃO app: com pago_em preenchido, mudar/apagar data_pagamento_cliente exige mandar pago_em
-- junto (no mesmo UPDATE ou no mesmo p_patch da RPC), senão o CHECK recusa.

-- ---------------------------------------------------------------------------
-- 2) crm_solicitacoes_operacionais — chaves tipadas no jsonb (sem coluna nova)
--    Linhas antigas não têm as chaves: o CHECK só valida quando a chave existe.
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'crm_solic_resposta_tipada_chk') then
    alter table public.crm_solicitacoes_operacionais add constraint crm_solic_resposta_tipada_chk
      check (snapshot_condicoes is null or (
            (not (snapshot_condicoes ? 'valorBruto') or jsonb_typeof(snapshot_condicoes->'valorBruto') in ('number', 'null'))
        and (not (snapshot_condicoes ? 'comSeguro')  or jsonb_typeof(snapshot_condicoes->'comSeguro')  in ('boolean', 'null'))));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_solic_payload_publico_chk') then
    alter table public.crm_solicitacoes_operacionais add constraint crm_solic_payload_publico_chk
      check (not (payload ? 'publicoId') or jsonb_typeof(payload->'publicoId') = 'null'
             or (payload->>'publicoId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  end if;
end $$;

comment on column public.crm_solicitacoes_operacionais.snapshot_condicoes is
  'Resposta da simulação (RespostaSolicitacao): instituicaoId, instituicaoNome, produto, tabela, prazo, parcela, valorLiberado, valorBruto (number), comSeguro (boolean), taxa, validade, numeroSimulacao.';

-- ---------------------------------------------------------------------------
-- 3) crm_contatos — vínculo pelo catálogo (vinculo text continua: valor bruto vindo do WeSales/IA)
-- ---------------------------------------------------------------------------
alter table public.crm_contatos
  add column if not exists publico_id uuid null references public.publicos_atendidos (id);
comment on column public.crm_contatos.vinculo is 'Vínculo em texto (filtro de campanhas, IA, WeSales). Ao escolher do catálogo a app grava o nome do catálogo aqui e o id em publico_id.';
comment on column public.crm_contatos.publico_id is 'Vínculo do servidor no catálogo publicos_atendidos. Preenchimento automático depende do mapeamento do WeSales (pendente).';

-- ---------------------------------------------------------------------------
-- 4) RPC de edição: registra no histórico a versão que JÁ ESTÁ no banco (aplicada fora de
--    migration; corpo idêntico a brs-alvoconsig/docs/migrations-pendentes/20261028010000,
--    md5 d949bb1f…) e põe as colunas novas na lista branca. Sem pago_em na lista, mudar a
--    data de pagamento de uma proposta com pago_em quebraria no CHECK acima.
-- ---------------------------------------------------------------------------
create or replace function public.propostas_editar_campos(
  p_tenant uuid,
  p_proposta uuid,
  p_autor uuid,
  p_versao timestamptz,
  p_patch jsonb,
  p_diff jsonb,
  p_status_de uuid default null,
  p_status_para uuid default null,
  p_situacao_de uuid default null,
  p_situacao_para uuid default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_atual timestamptz;
  v_chave text;
  v_permitidas constant text[] := array[
    'numero_contrato', 'id_externo_if', 'tabela_comissao_id', 'tabela_texto',
    'valor_bruto', 'valor_liquido', 'valor_base', 'valor_parcela', 'num_parcelas',
    'atendente_crm_usuario_id', 'created_at', 'data_pagamento_cliente', 'pago_em',
    'com_seguro', 'publico_id', 'vinculo_texto',
    'status_proposta_id', 'grupo', 'situacao_proposta_id', 'finalizada_em', 'trava_expira_em', 'data_atualizacao'];
begin
  if p_tenant is null or p_proposta is null or p_autor is null or p_versao is null then
    raise exception 'propostas_editar_campos: parametros obrigatorios ausentes';
  end if;
  if p_diff is null or p_diff = '{}'::jsonb or p_patch is null or p_patch = '{}'::jsonb then
    return 'sem_mudanca';
  end if;
  for v_chave in select jsonb_object_keys(p_patch) loop
    if v_chave <> all (v_permitidas) then
      raise exception 'propostas_editar_campos: coluna nao permitida (%)', v_chave;
    end if;
  end loop;

  select updated_at into v_atual
    from public.propostas_credito
   where id = p_proposta and agente_parceiro_id = p_tenant and origem = 'manual'
   for update;
  if not found then return 'nao_encontrada'; end if;
  if v_atual is distinct from p_versao then return 'conflito'; end if;

  update public.propostas_credito set
    numero_contrato          = case when p_patch ? 'numero_contrato' then p_patch->>'numero_contrato' else numero_contrato end,
    id_externo_if            = case when p_patch ? 'id_externo_if' then p_patch->>'id_externo_if' else id_externo_if end,
    tabela_comissao_id       = case when p_patch ? 'tabela_comissao_id' then (p_patch->>'tabela_comissao_id')::uuid else tabela_comissao_id end,
    tabela_texto             = case when p_patch ? 'tabela_texto' then p_patch->>'tabela_texto' else tabela_texto end,
    valor_bruto              = case when p_patch ? 'valor_bruto' then (p_patch->>'valor_bruto')::numeric else valor_bruto end,
    valor_liquido            = case when p_patch ? 'valor_liquido' then (p_patch->>'valor_liquido')::numeric else valor_liquido end,
    valor_base               = case when p_patch ? 'valor_base' then (p_patch->>'valor_base')::numeric else valor_base end,
    valor_parcela            = case when p_patch ? 'valor_parcela' then (p_patch->>'valor_parcela')::numeric else valor_parcela end,
    num_parcelas             = case when p_patch ? 'num_parcelas' then (p_patch->>'num_parcelas')::int else num_parcelas end,
    atendente_crm_usuario_id = case when p_patch ? 'atendente_crm_usuario_id' then (p_patch->>'atendente_crm_usuario_id')::uuid else atendente_crm_usuario_id end,
    created_at               = case when p_patch ? 'created_at' then (p_patch->>'created_at')::timestamptz else created_at end,
    data_pagamento_cliente   = case when p_patch ? 'data_pagamento_cliente' then (p_patch->>'data_pagamento_cliente')::date else data_pagamento_cliente end,
    pago_em                  = case when p_patch ? 'pago_em' then (p_patch->>'pago_em')::timestamptz else pago_em end,
    com_seguro               = case when p_patch ? 'com_seguro' then (p_patch->>'com_seguro')::boolean else com_seguro end,
    publico_id               = case when p_patch ? 'publico_id' then (p_patch->>'publico_id')::uuid else publico_id end,
    vinculo_texto            = case when p_patch ? 'vinculo_texto' then p_patch->>'vinculo_texto' else vinculo_texto end,
    status_proposta_id       = case when p_patch ? 'status_proposta_id' then (p_patch->>'status_proposta_id')::uuid else status_proposta_id end,
    grupo                    = case when p_patch ? 'grupo' then p_patch->>'grupo' else grupo end,
    situacao_proposta_id     = case when p_patch ? 'situacao_proposta_id' then (p_patch->>'situacao_proposta_id')::uuid else situacao_proposta_id end,
    finalizada_em            = case when p_patch ? 'finalizada_em' then (p_patch->>'finalizada_em')::timestamptz else finalizada_em end,
    trava_expira_em          = case when p_patch ? 'trava_expira_em' then (p_patch->>'trava_expira_em')::timestamptz else trava_expira_em end,
    data_atualizacao         = case when p_patch ? 'data_atualizacao' then (p_patch->>'data_atualizacao')::timestamptz else data_atualizacao end, -- so quando o catalogo manda (flag atualiza_data_atualizacao do status); senao o relogio de inatividade segue
    updated_at               = now()
  where id = p_proposta and agente_parceiro_id = p_tenant and origem = 'manual';

  insert into public.propostas_eventos (proposta_id, agente_parceiro_id, tipo, autor_crm_usuario_id, status_de, status_para, situacao_de, situacao_para, dados)
  values (p_proposta, p_tenant, 'campos', p_autor, p_status_de, p_status_para, p_situacao_de, p_situacao_para, p_diff);

  return 'ok';
end;
$$;

revoke all on function public.propostas_editar_campos(uuid, uuid, uuid, timestamptz, jsonb, jsonb, uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.propostas_editar_campos(uuid, uuid, uuid, timestamptz, jsonb, jsonb, uuid, uuid, uuid, uuid) to service_role;

notify pgrst, 'reload schema';
