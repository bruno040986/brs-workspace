-- APLICADA em produção em 06/11/2026 pelo dono (editor SQL do Supabase; não consta em supabase_migrations). Arquivo preservado para o repositório refletir o banco.
-- Etapa 1 — fórum/linha do tempo unificado do CASO.
--
-- Caso = a simulação (crm_solicitacoes_operacionais.id). Toda proposta manual nasce de uma
-- simulação (30/30 em produção têm solicitacao_id) e a simulação nunca é apagada.
--
-- Eventos automáticos continuam onde estão (crm_solicitacoes_eventos, propostas_eventos).
-- Notas de pessoas (destinatário, resposta, leitura) ficam em crm_casos_notas, por caso.
-- A linha do tempo é a VIEW crm_casos_linha_tempo, que une as três; nada é copiado.
-- Os propostas_eventos tipo='comentario' antigos aparecem na view como nota legada.
--
-- Resposta (decisão do dono 06/11/2026): uma nota responde a NO MÁXIMO UM de
--   parent_nota_id                 -> outra nota do mesmo caso
--   parent_solicitacao_evento_id   -> crm_solicitacoes_eventos do mesmo caso
--   parent_proposta_evento_id      -> propostas_eventos da proposta da nota (exige proposta_id,
--                                     que por FK pertence ao mesmo caso)
-- Tudo por FK composta (sem trigger). Na view: parent_origem + parent_id, que casam com
-- (origem, id) da própria view.
-- Notificar quem gerou o evento: a app lê autor_crm_usuario_id da linha pai na view e, se não
-- for nulo nem o próprio autor, grava destinatario_tipo='pessoa' para ele (senão 'todos'), a
-- linha em crm_casos_notas_destinatarios e a crm_notificacoes (tipo='nota',
-- entidade_tipo='solicitacao', entidade_id=solicitacao_id). crm_notificacoes não muda.
--
-- Destinatários materializados no envio (1 linha por pessoa). "Enviado" = created_at da nota;
-- "lido" = destinatarios.lido_em. Quem envia não pode ser destinatário (CHECK nas duas tabelas).

-- ---------------------------------------------------------------------------
-- 0) Alvos de FK composta (redundantes com as PKs; o Postgres exige índice único)
-- ---------------------------------------------------------------------------
create unique index if not exists propostas_credito_id_solicitacao_uq
  on public.propostas_credito (id, solicitacao_id);
create unique index if not exists crm_solicitacoes_eventos_id_solicitacao_uq
  on public.crm_solicitacoes_eventos (id, solicitacao_id);
create unique index if not exists propostas_eventos_id_proposta_uq
  on public.propostas_eventos (id, proposta_id);

-- ---------------------------------------------------------------------------
-- 1) Notas (append-only: sem UPDATE/DELETE para ninguém)
-- ---------------------------------------------------------------------------
create table if not exists public.crm_casos_notas (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null,
  solicitacao_id uuid not null,                       -- o caso
  proposta_id uuid null,                              -- fase de proposta
  autor_crm_usuario_id uuid not null,
  destinatario_tipo text not null check (destinatario_tipo in ('pessoa', 'todos')),
  destinatario_crm_usuario_id uuid null,
  parent_nota_id uuid null,
  parent_solicitacao_evento_id uuid null,
  parent_proposta_evento_id uuid null,
  texto text not null check (char_length(btrim(texto)) between 1 and 4000),
  -- [{bucket, path, mime, nome, tamanho, sha256}] no bucket privado parceiro-midias,
  -- path 'casos/<agente_parceiro_id>/<solicitacao_id>/<uuid>.<ext>' (conferido no servidor).
  anexos jsonb not null default '[]'::jsonb
    check (jsonb_typeof(anexos) = 'array' and jsonb_array_length(anexos) <= 10),
  created_at timestamptz not null default now(),
  constraint crm_casos_notas_destinatario_chk
    check ((destinatario_tipo = 'pessoa') = (destinatario_crm_usuario_id is not null)),
  constraint crm_casos_notas_autor_nao_destinatario_chk
    check (destinatario_crm_usuario_id is distinct from autor_crm_usuario_id),
  constraint crm_casos_notas_parent_unico_chk
    check (num_nonnulls(parent_nota_id, parent_solicitacao_evento_id, parent_proposta_evento_id) <= 1),
  constraint crm_casos_notas_parent_nao_propria_chk
    check (parent_nota_id is distinct from id),
  -- FK composta MATCH SIMPLE não é checada com coluna nula: sem proposta_id a FK do evento de
  -- proposta passaria batido. Este CHECK fecha a brecha.
  constraint crm_casos_notas_parent_proposta_evento_chk
    check (parent_proposta_evento_id is null or proposta_id is not null),
  -- alvos das FKs compostas abaixo
  constraint crm_casos_notas_id_solicitacao_uq unique (id, solicitacao_id),
  constraint crm_casos_notas_id_tenant_autor_uq unique (id, agente_parceiro_id, autor_crm_usuario_id),
  constraint crm_casos_notas_solicitacao_fk foreign key (solicitacao_id, agente_parceiro_id)
    references public.crm_solicitacoes_operacionais (id, agente_parceiro_id) on delete cascade,
  constraint crm_casos_notas_proposta_fk foreign key (proposta_id, solicitacao_id)
    references public.propostas_credito (id, solicitacao_id),
  constraint crm_casos_notas_autor_fk foreign key (autor_crm_usuario_id, agente_parceiro_id)
    references public.crm_usuarios (id, agente_parceiro_id),
  constraint crm_casos_notas_destinatario_fk foreign key (destinatario_crm_usuario_id, agente_parceiro_id)
    references public.crm_usuarios (id, agente_parceiro_id),
  constraint crm_casos_notas_parent_nota_fk foreign key (parent_nota_id, solicitacao_id)
    references public.crm_casos_notas (id, solicitacao_id),
  constraint crm_casos_notas_parent_solic_evento_fk foreign key (parent_solicitacao_evento_id, solicitacao_id)
    references public.crm_solicitacoes_eventos (id, solicitacao_id),
  constraint crm_casos_notas_parent_prop_evento_fk foreign key (parent_proposta_evento_id, proposta_id)
    references public.propostas_eventos (id, proposta_id)
);
create index if not exists crm_casos_notas_caso_idx on public.crm_casos_notas (solicitacao_id, created_at);
create index if not exists crm_casos_notas_parent_nota_idx on public.crm_casos_notas (parent_nota_id) where parent_nota_id is not null;
create index if not exists crm_casos_notas_parent_solic_ev_idx on public.crm_casos_notas (parent_solicitacao_evento_id) where parent_solicitacao_evento_id is not null;
create index if not exists crm_casos_notas_parent_prop_ev_idx on public.crm_casos_notas (parent_proposta_evento_id) where parent_proposta_evento_id is not null;

comment on table public.crm_casos_notas is
  'Notas de pessoas no caso (solicitacao_id), append-only. Resposta a nota OU a evento automático (no máximo um parent_*).';

-- ---------------------------------------------------------------------------
-- 2) Destinatários + leitura. Única mudança permitida: lido_em de null para um valor.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_casos_notas_destinatarios (
  nota_id uuid not null,
  agente_parceiro_id uuid not null,
  autor_crm_usuario_id uuid not null,                 -- cópia (pela FK) para o CHECK abaixo
  crm_usuario_id uuid not null,
  lido_em timestamptz null,
  primary key (nota_id, crm_usuario_id),
  constraint crm_casos_notas_dest_autor_chk check (crm_usuario_id <> autor_crm_usuario_id),
  constraint crm_casos_notas_dest_nota_fk foreign key (nota_id, agente_parceiro_id, autor_crm_usuario_id)
    references public.crm_casos_notas (id, agente_parceiro_id, autor_crm_usuario_id) on delete cascade,
  constraint crm_casos_notas_dest_usuario_fk foreign key (crm_usuario_id, agente_parceiro_id)
    references public.crm_usuarios (id, agente_parceiro_id)
);
-- "minhas não lidas" (balão/contador) e "marcar lidas ao abrir o drawer"
create index if not exists crm_casos_notas_dest_nao_lidas_idx
  on public.crm_casos_notas_destinatarios (crm_usuario_id, nota_id) where lido_em is null;

create or replace function app_private.crm_casos_notas_leitura_guarda()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.lido_em is not null or new.lido_em is null
     or (new.nota_id, new.agente_parceiro_id, new.autor_crm_usuario_id, new.crm_usuario_id)
        is distinct from (old.nota_id, old.agente_parceiro_id, old.autor_crm_usuario_id, old.crm_usuario_id) then
    raise exception 'crm_casos_notas_destinatarios: só é permitido marcar como lido uma vez';
  end if;
  return new;
end;
$$;
revoke all on function app_private.crm_casos_notas_leitura_guarda() from public, anon, authenticated;

do $$ begin
  create trigger crm_casos_notas_leitura_guarda
    before update on public.crm_casos_notas_destinatarios
    for each row execute function app_private.crm_casos_notas_leitura_guarda();
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 3) RLS + grants (padrão do CRM: só service_role; append-only no grant) + gate restritivo
--    igual às outras tabelas (m4_gate_tipo_interno), por defesa em profundidade.
-- ---------------------------------------------------------------------------
alter table public.crm_casos_notas enable row level security;
alter table public.crm_casos_notas_destinatarios enable row level security;
revoke all on public.crm_casos_notas, public.crm_casos_notas_destinatarios
  from public, anon, authenticated, service_role;
grant select, insert on public.crm_casos_notas to service_role;
grant select, insert on public.crm_casos_notas_destinatarios to service_role;
grant update (lido_em) on public.crm_casos_notas_destinatarios to service_role;

do $$ begin
  create policy seg_gate_tipo_interno on public.crm_casos_notas as restrictive for all to authenticated
    using ((select app_private.seg_tipo_conta()) = 'interno') with check ((select app_private.seg_tipo_conta()) = 'interno');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy seg_gate_tipo_interno on public.crm_casos_notas_destinatarios as restrictive for all to authenticated
    using ((select app_private.seg_tipo_conta()) = 'interno') with check ((select app_private.seg_tipo_conta()) = 'interno');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 4) Linha do tempo do caso (leitura). security_invoker: a view NÃO fura RLS/grant.
--    automatico = true -> sem leitura. Leitura das notas vem de crm_casos_notas_destinatarios.
--    parent_origem/parent_id casam com origem/id de outra linha desta view.
-- ---------------------------------------------------------------------------
create or replace view public.crm_casos_linha_tempo
with (security_invoker = true) as
select se.id, se.agente_parceiro_id, se.solicitacao_id, null::uuid as proposta_id,
       'solicitacao_evento'::text as origem, 'transicao'::text as tipo, true as automatico,
       se.autor_crm_usuario_id, se.nota,
       jsonb_build_object('status_de', se.status_de, 'status_para', se.status_para,
                          'atribuido_de', se.atribuido_de, 'atribuido_para', se.atribuido_para) as dados,
       '[]'::jsonb as anexos, null::text as parent_origem, null::uuid as parent_id,
       null::text as destinatario_tipo, null::uuid as destinatario_crm_usuario_id, se.created_at
  from public.crm_solicitacoes_eventos se
union all
select pe.id, pe.agente_parceiro_id, p.solicitacao_id, pe.proposta_id,
       'proposta_evento', pe.tipo, pe.tipo <> 'comentario',
       pe.autor_crm_usuario_id, pe.nota,
       pe.dados || jsonb_build_object('status_de', pe.status_de, 'status_para', pe.status_para,
                                      'situacao_de', pe.situacao_de, 'situacao_para', pe.situacao_para),
       '[]'::jsonb, null::text, null::uuid, null::text, null::uuid, pe.created_at
  from public.propostas_eventos pe
  join public.propostas_credito p on p.id = pe.proposta_id and p.agente_parceiro_id = pe.agente_parceiro_id
 where p.solicitacao_id is not null
union all
select n.id, n.agente_parceiro_id, n.solicitacao_id, n.proposta_id,
       'nota', 'nota', false,
       n.autor_crm_usuario_id, n.texto, '{}'::jsonb, n.anexos,
       case when n.parent_nota_id is not null then 'nota'
            when n.parent_solicitacao_evento_id is not null then 'solicitacao_evento'
            when n.parent_proposta_evento_id is not null then 'proposta_evento' end,
       coalesce(n.parent_nota_id, n.parent_solicitacao_evento_id, n.parent_proposta_evento_id),
       n.destinatario_tipo, n.destinatario_crm_usuario_id, n.created_at
  from public.crm_casos_notas n;

revoke all on public.crm_casos_linha_tempo from public, anon, authenticated, service_role;
grant select on public.crm_casos_linha_tempo to service_role;
comment on view public.crm_casos_linha_tempo is
  'Linha do tempo do caso (solicitacao_id): eventos da simulação + da proposta + notas. Sempre filtrar por agente_parceiro_id e solicitacao_id. parent_origem/parent_id apontam para (origem,id) de outra linha.';

notify pgrst, 'reload schema';
