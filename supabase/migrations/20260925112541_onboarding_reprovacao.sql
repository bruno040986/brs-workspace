-- Cadastros Recebidos v2 — Fatia 2: reprovação final + histórico por CPF/CNPJ
-- (docs/PLANO-CADASTROS-RECEBIDOS-V2-2026-09-25.md).
--
-- 1) Processo ganha o status final 'reprovado' com categoria, motivo, autor,
--    data e a CÓPIA CONGELADA do cadastro (agente + itens + docs + evidências)
--    no momento da reprovação — uma nova tentativa pode sobrescrever o
--    cadastro do agente sem apagar a prova do que foi analisado.
-- 2) Um agente passa a ter N processos (histórico de tentativas); só pode
--    existir UM processo vivo por agente (índice parcial).
-- 3) corban_onboarding_reprovacoes_docs: índice dos documentos envolvidos em
--    cada reprovação (CNPJ da empresa, CPF do titular/sócios/administradores/
--    testemunha) para alertar numa tentativa futura.
--
-- ORDEM DE PUBLICAÇÃO: o portal novo (que não usa mais o upsert por
-- agente_parceiro_id) vai ao ar ANTES desta migration; ela derruba a UNIQUE
-- que o upsert antigo exigia.

alter table public.corban_onboarding_processos
  drop constraint if exists corban_onboarding_processos_status_check;
alter table public.corban_onboarding_processos
  add constraint corban_onboarding_processos_status_check
  check (status in ('em_andamento','aguardando_correcao','correcao_recebida','concluido','cancelado','reprovado'));

alter table public.corban_onboarding_processos
  add column if not exists reprovacao_categoria text null
    check (reprovacao_categoria in ('serasa','judicial','documentacao','improcedencia','outro')),
  add column if not exists reprovacao_motivo text null,
  add column if not exists reprovado_por uuid null,
  add column if not exists reprovado_em timestamptz null,
  add column if not exists cadastro_snapshot jsonb null;

-- 1 agente → N processos; só 1 vivo.
alter table public.corban_onboarding_processos
  drop constraint if exists corban_onboarding_processos_agente_unique;
create unique index if not exists corban_onboarding_processos_agente_vivo_uidx
  on public.corban_onboarding_processos (agente_parceiro_id)
  where status not in ('reprovado','cancelado');
create index if not exists corban_onboarding_processos_agente_idx
  on public.corban_onboarding_processos (agente_parceiro_id, created_at desc);

create table if not exists public.corban_onboarding_reprovacoes_docs (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.corban_onboarding_processos(id) on delete cascade,
  agente_parceiro_id uuid not null references public.agentes_parceiros(id) on delete cascade,
  -- só dígitos
  documento text not null,
  tipo text not null check (tipo in ('cpf','cnpj')),
  papel text not null check (papel in ('empresa','titular','socio','administrador','testemunha')),
  nome text not null default '',
  categoria text not null check (categoria in ('serasa','judicial','documentacao','improcedencia','outro')),
  motivo text not null default '',
  reprovado_em timestamptz not null default now(),
  reprovado_por uuid null,
  created_at timestamptz not null default now()
);
create index if not exists corban_onboarding_reprovacoes_docs_documento_idx
  on public.corban_onboarding_reprovacoes_docs (documento);
create index if not exists corban_onboarding_reprovacoes_docs_processo_idx
  on public.corban_onboarding_reprovacoes_docs (processo_id);

-- RLS igual às demais tabelas do onboarding.
do $$
declare
  t regclass;
begin
  t := app_private.enable_rls_if_exists('corban_onboarding_reprovacoes_docs');
  perform app_private.apply_policy(t, 'corban_onboarding_reprovacoes_docs_select_permitted', 'SELECT',
    'app_private.has_permission(''agente-corban-cadastros-recebidos'', ''can_view'')');
  perform app_private.apply_policy(t, 'corban_onboarding_reprovacoes_docs_insert_permitted', 'INSERT', null,
    'app_private.has_permission(''agente-corban-cadastros-recebidos'', ''can_include'')');
  perform app_private.apply_policy(t, 'corban_onboarding_reprovacoes_docs_update_permitted', 'UPDATE',
    'app_private.has_permission(''agente-corban-cadastros-recebidos'', ''can_edit'')');
  perform app_private.apply_policy(t, 'corban_onboarding_reprovacoes_docs_delete_permitted', 'DELETE',
    'app_private.has_permission(''agente-corban-cadastros-recebidos'', ''can_delete'')');
end $$;

notify pgrst, 'reload schema';
