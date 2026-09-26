-- Cadastros Recebidos v2 — Fatia 5: Templates de Mensagens
-- (docs/PLANO-CADASTROS-RECEBIDOS-V2-2026-09-25.md, decisão do Bruno 24/09).
--
-- Os textos de e-mail e WhatsApp saem do código. O catálogo (quais templates
-- existem, variáveis, canais, texto PADRÃO) vive em src/lib/mensagens/catalogo.ts;
-- esta tabela guarda só o que foi PERSONALIZADO. Sem linha = usa o padrão.
-- Cada salvamento gera uma versão (histórico com autor).
create table if not exists public.mensagem_templates (
  chave text primary key,
  email_assunto text null,
  email_html text null,
  whatsapp_texto text null,
  versao integer not null default 1,
  updated_by uuid null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.mensagem_templates_versoes (
  id uuid primary key default gen_random_uuid(),
  chave text not null,
  versao integer not null,
  email_assunto text null,
  email_html text null,
  whatsapp_texto text null,
  updated_by uuid null,
  created_at timestamptz not null default now()
);
create index if not exists mensagem_templates_versoes_chave_idx
  on public.mensagem_templates_versoes (chave, versao desc);

-- RLS: leitura para quem opera Cadastros Recebidos ou o menu; escrita só pelo menu.
-- O portal lê via service role.
do $$
declare
  t regclass;
  tabela text;
  ler text := 'app_private.has_permission(''workspace-templates-mensagens'', ''can_view'') or app_private.has_permission(''agente-corban-cadastros-recebidos'', ''can_view'')';
  escrever text := 'app_private.has_permission(''workspace-templates-mensagens'', ''can_edit'')';
begin
  foreach tabela in array array['mensagem_templates', 'mensagem_templates_versoes'] loop
    t := app_private.enable_rls_if_exists(tabela);
    perform app_private.apply_policy(t, tabela || '_select_permitted', 'SELECT', ler);
    perform app_private.apply_policy(t, tabela || '_insert_permitted', 'INSERT', null, escrever);
    perform app_private.apply_policy(t, tabela || '_update_permitted', 'UPDATE', escrever);
    perform app_private.apply_policy(t, tabela || '_delete_permitted', 'DELETE', escrever);
  end loop;
end $$;

-- Permissão nova (regra dos 4 pontos): Agente Corban › Templates de Mensagens.
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, 'workspace-templates-mensagens', true, true, true, false, false
from public.profile_permissions pp
where pp.resource_name = 'sistema-usuarios-root' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, 'workspace-templates-mensagens', true, true, true, false, false
from public.user_permissions up
where up.resource_name = 'sistema-usuarios-root' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

notify pgrst, 'reload schema';
