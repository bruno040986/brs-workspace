-- Cadastros Recebidos v2 — Fatia 1: evidência obrigatória nas verificações
-- externas (docs/PLANO-CADASTROS-RECEBIDOS-V2-2026-09-25.md).
--
-- 1) corban_onboarding_evidencias: print/PDF anexado a um ITEM do checklist
--    (Presença Digital, Chave PIX), com hash SHA-256 e carimbo de captura.
--    Prova que, naquele momento, a informação verificada era procedente.
-- 2) corban_onboarding_docs_analise (Serasa / Cartão CNPJ) ganha hash,
--    tamanho e mime — o upload da Análise já é a evidência desses itens.

create table if not exists public.corban_onboarding_evidencias (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.corban_onboarding_processos(id) on delete cascade,
  item_id uuid not null references public.corban_onboarding_itens(id) on delete cascade,
  -- Path dentro do bucket privado `partner-analise` (exibição por signed URL).
  arquivo_url text not null,
  file_name text not null default '',
  mime_type text not null default '',
  tamanho_bytes bigint not null default 0,
  hash_sha256 text not null,
  observacao text null,
  capturado_em timestamptz not null default now(),
  created_by uuid null,
  created_at timestamptz not null default now()
);
create index if not exists corban_onboarding_evidencias_processo_idx
  on public.corban_onboarding_evidencias (processo_id);
create index if not exists corban_onboarding_evidencias_item_idx
  on public.corban_onboarding_evidencias (item_id);

alter table public.corban_onboarding_docs_analise
  add column if not exists hash_sha256 text null,
  add column if not exists tamanho_bytes bigint null,
  add column if not exists mime_type text null;

-- RLS igual às demais tabelas do onboarding (permissão agente-corban-cadastros-recebidos).
do $$
declare
  t regclass;
begin
  t := app_private.enable_rls_if_exists('corban_onboarding_evidencias');
  perform app_private.apply_policy(t, 'corban_onboarding_evidencias_select_permitted', 'SELECT',
    'app_private.has_permission(''agente-corban-cadastros-recebidos'', ''can_view'')');
  perform app_private.apply_policy(t, 'corban_onboarding_evidencias_insert_permitted', 'INSERT', null,
    'app_private.has_permission(''agente-corban-cadastros-recebidos'', ''can_include'')');
  perform app_private.apply_policy(t, 'corban_onboarding_evidencias_update_permitted', 'UPDATE',
    'app_private.has_permission(''agente-corban-cadastros-recebidos'', ''can_edit'')');
  perform app_private.apply_policy(t, 'corban_onboarding_evidencias_delete_permitted', 'DELETE',
    'app_private.has_permission(''agente-corban-cadastros-recebidos'', ''can_delete'')');
end $$;

notify pgrst, 'reload schema';
