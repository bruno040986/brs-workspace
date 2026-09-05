-- Revogação efetiva no acesso direto/Realtime; usa o mesmo fallback de perfil
-- global da sessão CRM. Participação em canal de outro tenant nunca é suficiente.
create or replace function app_private.crm_chat_membro_do_canal(p_canal_id uuid)
returns boolean language sql security definer stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.crm_chat_membros m
    join public.crm_chat_canais c on c.id = m.canal_id
    join public.crm_usuarios u on u.id = m.crm_usuario_id
      and u.agente_parceiro_id = c.agente_parceiro_id
    join public.crm_parceiro_config cfg on cfg.agente_parceiro_id = c.agente_parceiro_id
      and cfg.habilitado = true
    join public.crm_perfis p on
      (u.perfil_id is not null and p.id = u.perfil_id
        and (p.agente_parceiro_id is null or p.agente_parceiro_id = u.agente_parceiro_id))
      or (u.perfil_id is null and p.agente_parceiro_id is null and p.chave = u.papel)
    join public.crm_perfis_permissoes pp on pp.perfil_id = p.id
      and pp.permissao = 'chat_interno.usar'
    where m.canal_id = p_canal_id and u.auth_user_id = auth.uid() and u.ativo = true
  );
$$;
revoke all on function app_private.crm_chat_membro_do_canal(uuid) from public, anon;
grant execute on function app_private.crm_chat_membro_do_canal(uuid) to authenticated;
