-- Origem do anúncio no lead, fase 1 (opção A: atribuir e vincular, sem criar lead).
-- Spec: .claude/tmp/spec-anuncio-lead.md §B1, §B2, §B6, §C4, §E (decisões do Bruno 07/10/2026).
--
-- - chat_anuncio_ocorrencias: uma linha por referral CTWA recebido (o engine grava,
--   idempotente por instancia_id + wa_id). Só service role; fora do Realtime.
-- - crm_meta_anuncios: cache dos nomes do anúncio/conjunto/campanha na Meta, por parceiro.
-- - crm_contato_anuncios: view (security_invoker) ocorrência → lead pela conversa.
-- - crm_relatorio_anuncios: RPC do relatório por anúncio (último clique, janela em dias).
-- - Permissão nova do CRM relatorios.anuncios (master e operacional globais).
-- - Backfill das conversas que já têm chat_conversas.origem_anuncio.
--
-- ORDEM DE PUBLICAÇÃO: esta migration ANTES do engine (insert na tabela) e do web
-- (view, RPC e permissão).
-- Idempotente: pode rodar duas vezes sem efeito na segunda.

-- `supabase db push` não roda a migration em transação: `set local` não vale.
set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Ocorrências de anúncio (§B1)
-- ---------------------------------------------------------------------------
create table if not exists public.chat_anuncio_ocorrencias (
  id bigint generated always as identity primary key,
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  instancia_id uuid not null references public.chat_instancias (id) on delete cascade,
  chat_conversa_id uuid not null references public.chat_conversas (id) on delete cascade,
  wa_id text not null,                 -- id da mensagem no provedor (= chat_mensagens_mapa.wa_id; YCloud usa ycloudId)
  provedor text not null check (provedor in ('baileys', 'zapi', 'ycloud', 'backfill')),
  fonte text not null default 'ctwa' check (fonte in ('ctwa', 'link')),
  recebido_em timestamptz not null,    -- occurredAt do inbound
  conversa_nova boolean not null,      -- a conversa nasceu desta mensagem
  source_type text null,
  source_id text null,
  source_url text null,
  headline text null,
  body text null,
  media_type text null,
  ctwa_clid text null,                 -- dado pessoal pseudônimo: retido enquanto a conversa existir
  boas_vindas text null,
  miniatura_path text null,            -- bucket crm-historico-midia
  created_at timestamptz not null default now(),
  constraint chat_anuncio_ocorrencias_instancia_wa_key unique (instancia_id, wa_id),
  constraint chat_anuncio_ocorrencias_tamanhos_check check (
    length(coalesce(headline, '')) <= 500 and length(coalesce(body, '')) <= 500
    and length(coalesce(ctwa_clid, '')) <= 512)
);

create index if not exists chat_anuncio_ocorrencias_parceiro_idx
  on public.chat_anuncio_ocorrencias (agente_parceiro_id, recebido_em desc);
create index if not exists chat_anuncio_ocorrencias_source_idx
  on public.chat_anuncio_ocorrencias (agente_parceiro_id, source_id, recebido_em desc) where source_id is not null;
create index if not exists chat_anuncio_ocorrencias_ctwa_clid_idx
  on public.chat_anuncio_ocorrencias (ctwa_clid) where ctwa_clid is not null;
create index if not exists chat_anuncio_ocorrencias_conversa_idx
  on public.chat_anuncio_ocorrencias (chat_conversa_id, recebido_em);

comment on table public.chat_anuncio_ocorrencias is
  'Uma linha por referral de anúncio (CTWA) recebido. Escrita só pelo engine (service role), idempotente por (instancia_id, wa_id). O lead vem de chat_conversas.crm_contato_id.';
comment on column public.chat_anuncio_ocorrencias.source_id is
  'ID do anúncio na Meta (CTWA). No Baileys é montado pelo aparelho do remetente: "não verificado" até a Meta confirmar (crm_meta_anuncios).';

-- ---------------------------------------------------------------------------
-- 2. Cache dos nomes na Meta (§B6)
-- ---------------------------------------------------------------------------
create table if not exists public.crm_meta_anuncios (
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  ad_id text not null,
  ad_nome text null,
  adset_id text null,
  adset_nome text null,
  campanha_id text null,
  campanha_nome text null,
  conta_id text null,
  status_efetivo text null,
  objetivo text null,
  resolvido_em timestamptz null,
  erro text null,
  primary key (agente_parceiro_id, ad_id)
);

-- ---------------------------------------------------------------------------
-- 3. Acesso: RLS ligada sem policy, só service role (padrão 20261005021849)
-- ---------------------------------------------------------------------------
alter table public.chat_anuncio_ocorrencias enable row level security;
alter table public.crm_meta_anuncios enable row level security;
revoke all on public.chat_anuncio_ocorrencias, public.crm_meta_anuncios from public, anon, authenticated;
grant select, insert, update, delete on public.chat_anuncio_ocorrencias, public.crm_meta_anuncios to service_role;

-- ---------------------------------------------------------------------------
-- 4. Índices de contato_id usados pelo relatório (não existiam em produção)
-- ---------------------------------------------------------------------------
create index if not exists propostas_credito_contato_idx
  on public.propostas_credito (contato_id, created_at) where contato_id is not null;
create index if not exists crm_solicitacoes_op_contato_idx
  on public.crm_solicitacoes_operacionais (contato_id, criado_em) where contato_id is not null;

-- ---------------------------------------------------------------------------
-- 5. View ocorrência → lead (§B2)
-- ---------------------------------------------------------------------------
create or replace view public.crm_contato_anuncios with (security_invoker = true) as
select c.crm_contato_id, o.*
from public.chat_anuncio_ocorrencias o
join public.chat_conversas c on c.id = o.chat_conversa_id
where c.crm_contato_id is not null;

revoke all on public.crm_contato_anuncios from public, anon, authenticated;
grant select on public.crm_contato_anuncios to service_role;

-- ---------------------------------------------------------------------------
-- 6. Relatório por anúncio (§E), modelo último clique
-- ---------------------------------------------------------------------------
-- Cada ocorrência do período abre uma janela [recebido_em, fim), com fim = o menor
-- entre a próxima ocorrência da MESMA pessoa (lead; sem lead, a conversa), em
-- qualquer instância e mesmo fora do período, e recebido_em + p_janela_dias.
-- As janelas de uma pessoa não se sobrepõem, então cada evento (lead novo,
-- simulação, proposta, venda) cai em no máximo uma ocorrência. Cada métrica é
-- agregada por source_id na sua própria CTE e só então juntada (sem join cruzado).
--
-- Colunas:
--   conversas / conversas_novas  conversas distintas com ocorrência no período (novas = conversa_nova)
--   leads                        leads distintos dessas conversas (tocados pelo anúncio no período)
--   leads_novos                  lead criado até 10 min antes da 1ª ocorrência dele, ou depois;
--                                atribuído só à ocorrência cuja janela contém greatest(criação, 1ª ocorrência)
--                                (último clique: o mesmo lead novo não conta em dois anúncios)
--   leads_existentes             leads tocados criados mais de 10 min antes da 1ª ocorrência dele
--                                (leads >= leads_novos + leads_existentes; a diferença é lead novo
--                                atribuído a outro anúncio ou criado depois da janela)
--   simulacoes                   crm_solicitacoes_operacionais tipo='simulacao' criadas na janela
--   propostas                    propostas_credito criadas na janela
--   vendas / valor_vendas        propostas da janela com grupo='pago' ou status='paga' (soma de valor_liquido)
--   mediana_min_ate_*            mediana em minutos da ocorrência até o evento (venda: finalizada_em,
--                                senão data_pagamento_cliente às 00:00 de Brasília; nunca negativa)
create or replace function public.crm_relatorio_anuncios(
  p_parceiro uuid,
  p_de timestamptz,
  p_ate timestamptz,
  p_instancia uuid default null,
  p_janela_dias int default 30)
returns table (
  source_id text,
  conversas bigint,
  conversas_novas bigint,
  leads bigint,
  leads_novos bigint,
  simulacoes bigint,
  propostas bigint,
  vendas bigint,
  valor_vendas numeric,
  mediana_min_ate_lead numeric,
  primeira_em timestamptz,
  ultima_em timestamptz,
  leads_existentes bigint,
  mediana_min_ate_simulacao numeric,
  mediana_min_ate_proposta numeric,
  mediana_min_ate_venda numeric)
language sql
stable
security definer
set search_path = ''
as $$
with oc as (
  select o.id, o.instancia_id, o.chat_conversa_id, o.source_id, o.recebido_em, o.conversa_nova, c.crm_contato_id,
         lead(o.recebido_em) over (partition by coalesce(c.crm_contato_id, o.chat_conversa_id)
                                   order by o.recebido_em, o.id) as proxima_em
  from public.chat_anuncio_ocorrencias o
  join public.chat_conversas c on c.id = o.chat_conversa_id
  join public.chat_instancias i on i.id = o.instancia_id and i.agente_parceiro_id = p_parceiro
  where o.agente_parceiro_id = p_parceiro
), jan as (
  select oc.*,
         least(coalesce(oc.proxima_em, 'infinity'::timestamptz),
               oc.recebido_em + make_interval(days => least(greatest(coalesce(p_janela_dias, 30), 1), 365))) as fim
  from oc
  where oc.recebido_em >= p_de and oc.recebido_em < p_ate
    and (p_instancia is null or oc.instancia_id = p_instancia)
), prim as (  -- 1ª ocorrência de cada lead (todas as instâncias, qualquer data)
  select oc.crm_contato_id, min(oc.recebido_em) as em
  from oc where oc.crm_contato_id is not null
  group by oc.crm_contato_id
), lead_jan as (  -- lead de cada ocorrência (1:1, sem multiplicar linhas)
  select j.source_id, j.recebido_em, j.fim, k.id as contato_id, k.created_at, p.em as prim_em
  from jan j
  join public.crm_contatos k on k.id = j.crm_contato_id and k.agente_parceiro_id = p_parceiro
  join prim p on p.crm_contato_id = k.id
), base as (
  select j.source_id,
         count(distinct j.chat_conversa_id) as conversas,
         count(distinct j.chat_conversa_id) filter (where j.conversa_nova) as conversas_novas,
         min(j.recebido_em) as primeira_em,
         max(j.recebido_em) as ultima_em
  from jan j
  group by j.source_id
), leads_m as (
  select l.source_id,
         count(distinct l.contato_id) as leads,
         count(distinct l.contato_id) filter (where l.created_at < l.prim_em - interval '10 minutes') as leads_existentes
  from lead_jan l
  group by l.source_id
), novos as (
  select l.source_id,
         count(distinct l.contato_id) as leads_novos,
         percentile_cont(0.5) within group (
           order by greatest(extract(epoch from (l.created_at - l.recebido_em)), 0) / 60) as mediana
  from lead_jan l
  where l.created_at >= l.prim_em - interval '10 minutes'
    and greatest(l.created_at, l.prim_em) >= l.recebido_em
    and greatest(l.created_at, l.prim_em) < l.fim
  group by l.source_id
), sims as (
  select l.source_id,
         count(distinct s.id) as simulacoes,
         percentile_cont(0.5) within group (order by extract(epoch from (s.criado_em - l.recebido_em)) / 60) as mediana
  from lead_jan l
  join public.crm_solicitacoes_operacionais s
    on s.contato_id = l.contato_id and s.agente_parceiro_id = p_parceiro and s.tipo = 'simulacao'
   and s.criado_em >= l.recebido_em and s.criado_em < l.fim
  group by l.source_id
), props as (
  select x.source_id,
         count(distinct x.id) as propostas,
         count(distinct x.id) filter (where x.venda) as vendas,
         coalesce(sum(x.valor_liquido) filter (where x.venda), 0) as valor_vendas,
         percentile_cont(0.5) within group (order by extract(epoch from (x.created_at - x.recebido_em)) / 60) as mediana_proposta,
         percentile_cont(0.5) within group (
           order by greatest(extract(epoch from (x.vendida_em - x.recebido_em)), 0) / 60)
           filter (where x.venda and x.vendida_em is not null) as mediana_venda
  from (
    select l.source_id, l.recebido_em, pr.id, pr.created_at, pr.valor_liquido,
           (pr.grupo = 'pago' or pr.status = 'paga') as venda,
           coalesce(pr.finalizada_em, pr.data_pagamento_cliente::timestamp at time zone 'America/Sao_Paulo') as vendida_em
    from lead_jan l
    join public.propostas_credito pr
      on pr.contato_id = l.contato_id and pr.agente_parceiro_id = p_parceiro
     and pr.created_at >= l.recebido_em and pr.created_at < l.fim
  ) x
  group by x.source_id
)
select b.source_id,
       b.conversas,
       b.conversas_novas,
       coalesce(lm.leads, 0),
       coalesce(n.leads_novos, 0),
       coalesce(s.simulacoes, 0),
       coalesce(p.propostas, 0),
       coalesce(p.vendas, 0),
       coalesce(p.valor_vendas, 0),
       round(n.mediana::numeric, 1),
       b.primeira_em,
       b.ultima_em,
       coalesce(lm.leads_existentes, 0),
       round(s.mediana::numeric, 1),
       round(p.mediana_proposta::numeric, 1),
       round(p.mediana_venda::numeric, 1)
from base b
left join leads_m lm on lm.source_id is not distinct from b.source_id
left join novos n on n.source_id is not distinct from b.source_id
left join sims s on s.source_id is not distinct from b.source_id
left join props p on p.source_id is not distinct from b.source_id
order by b.conversas desc, b.source_id nulls last;
$$;

revoke all on function public.crm_relatorio_anuncios(uuid, timestamptz, timestamptz, uuid, int) from public, anon, authenticated;
grant execute on function public.crm_relatorio_anuncios(uuid, timestamptz, timestamptz, uuid, int) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Permissão nova do CRM: relatorios.anuncios (master e operacional globais)
-- ---------------------------------------------------------------------------
insert into public.crm_perfis_permissoes (perfil_id, permissao)
select p.id, 'relatorios.anuncios'
from public.crm_perfis p
where p.agente_parceiro_id is null and p.chave in ('master', 'operacional')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 8. Backfill das conversas que já têm origem_anuncio (§C4)
-- ---------------------------------------------------------------------------
-- Miniatura fica de fora: o script do engine baixa thumbnail_url de
-- chat_conversas.origem_anuncio antes de o link da fbcdn expirar.
insert into public.chat_anuncio_ocorrencias (
  agente_parceiro_id, instancia_id, chat_conversa_id, wa_id, provedor, fonte, recebido_em, conversa_nova,
  source_type, source_id, source_url, headline, body, media_type, ctwa_clid)
select i.agente_parceiro_id, c.instancia_id, c.id, 'backfill:' || c.id, 'backfill',
       case when c.origem_anuncio->>'fonte' = 'link' then 'link' else 'ctwa' end,
       c.created_at, true,
       c.origem_anuncio->>'source_type', c.origem_anuncio->>'source_id', c.origem_anuncio->>'source_url',
       left(c.origem_anuncio->>'headline', 500), left(c.origem_anuncio->>'body', 500),
       c.origem_anuncio->>'media_type', nullif(left(c.origem_anuncio->>'ctwa_clid', 512), '')
from public.chat_conversas c
join public.chat_instancias i on i.id = c.instancia_id
where c.origem_anuncio is not null
  and jsonb_typeof(c.origem_anuncio) = 'object'
  and i.agente_parceiro_id is not null
on conflict (instancia_id, wa_id) do nothing;

reset lock_timeout;
notify pgrst, 'reload schema';
