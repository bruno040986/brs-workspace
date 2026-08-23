-- Importador de planilhas do Comissionamento (Tabelas de Comissão agora;
-- Prazos Comissão e Coeficientes entram no mesmo motor depois).

-- Log de importações (auditoria linha a linha em resultado jsonb).
create table if not exists public.comissionamento_imports (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('tabelas', 'prazos', 'coeficientes')),
  arquivo_nome text not null,
  total_linhas integer not null default 0,
  criadas integer not null default 0,
  atualizadas integer not null default 0,
  sem_mudanca integer not null default 0,
  status text not null default 'concluido' check (status in ('concluido', 'erro')),
  erro text null,
  resultado jsonb not null default '[]'::jsonb,
  criado_por uuid null,
  created_at timestamptz not null default now()
);
create index if not exists comissionamento_imports_tipo_idx
  on public.comissionamento_imports (tipo, created_at desc);

-- Memória de de-paras: texto da planilha -> cadastro apontado pelo operador.
-- Nas próximas importações o mesmo texto resolve sozinho (não critica de novo).
create table if not exists public.comissionamento_import_aliases (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('financeira', 'convenio', 'forma_contrato', 'tipo_formalizacao')),
  texto_normalizado text not null,
  alvo_id uuid not null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  constraint comissionamento_import_aliases_unique unique (tipo, texto_normalizado)
);

do $$
declare
  t regclass;
  tabela text;
begin
  foreach tabela in array array['comissionamento_imports', 'comissionamento_import_aliases'] loop
    t := app_private.enable_rls_if_exists(tabela);
    perform app_private.apply_policy(t, tabela || '_select_permitted', 'SELECT', 'app_private.has_permission(''sistema-config-credito'', ''can_view'')');
  end loop;
end $$;

notify pgrst, 'reload schema';
