-- Chat interno — resumo dos canais em UMA consulta (Fable, 12/09/2026).
-- Substitui o N+1 de getCanais (chat-interno-actions.ts:93-155): 4 + 2N
-- consultas por tick, a cada 10 s por aba (3.000 POST/dia para 35 msgs).
-- Tenant-safe por construção: só canais do parceiro informado em que o
-- usuário informado é membro. Executada pelo servidor (service role);
-- não exposta a `authenticated`.
--
-- APLICADA via Supabase MCP (apply_migration) com esta mesma versão
-- registrada — este arquivo é o espelho no repositório.
create index if not exists crm_chat_membros_usuario_idx
  on public.crm_chat_membros (crm_usuario_id);

create or replace function public.crm_chat_resumo_canais(p_agente_parceiro_id uuid, p_crm_usuario_id uuid)
returns table (
  canal_id uuid,
  tipo text,
  chave text,
  nome text,
  lido_ate timestamptz,
  outro_usuario_id uuid,
  outro_nome text,
  outro_ativo boolean,
  ultima_conteudo text,
  ultima_tipo text,
  ultima_em timestamptz,
  nao_lidas bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.tipo,
    c.chave,
    c.nome,
    m.lido_ate,
    o.id,
    coalesce(nullif(o.nome_exibicao, ''), o.nome),
    o.ativo,
    u.conteudo,
    u.tipo,
    u.created_at,
    coalesce(n.qtd, 0)
  from crm_chat_membros m
  join crm_chat_canais c
    on c.id = m.canal_id
   and c.agente_parceiro_id = p_agente_parceiro_id
  -- canal 'direto': chave = 'direto:<menor_id>:<maior_id>'; o outro é o que não sou eu
  left join lateral (
    select case
      when split_part(c.chave, ':', 2)::uuid = p_crm_usuario_id then split_part(c.chave, ':', 3)::uuid
      else split_part(c.chave, ':', 2)::uuid
    end as id
    where c.tipo = 'direto'
  ) oid on true
  left join crm_usuarios o on o.id = oid.id
  -- última mensagem do canal (índice crm_chat_mensagens_canal_idx, varrido ao contrário)
  left join lateral (
    select x.conteudo, x.tipo, x.created_at
    from crm_chat_mensagens x
    where x.canal_id = c.id
    order by x.created_at desc
    limit 1
  ) u on true
  -- não lidas: depois do lido_ate, e mensagens do próprio autor não contam (sistema/lembrete contam)
  left join lateral (
    select count(*) as qtd
    from crm_chat_mensagens x
    where x.canal_id = c.id
      and (x.autor_crm_usuario_id is null or x.autor_crm_usuario_id <> p_crm_usuario_id)
      and (m.lido_ate is null or x.created_at > m.lido_ate)
  ) n on true
  where m.crm_usuario_id = p_crm_usuario_id;
$$;

revoke all on function public.crm_chat_resumo_canais(uuid, uuid) from public;
revoke all on function public.crm_chat_resumo_canais(uuid, uuid) from anon;
revoke all on function public.crm_chat_resumo_canais(uuid, uuid) from authenticated;
grant execute on function public.crm_chat_resumo_canais(uuid, uuid) to service_role;

comment on function public.crm_chat_resumo_canais(uuid, uuid) is 'Chat interno do CRM: canais do usuário com última mensagem e não-lidas numa consulta só (substitui o N+1 de getCanais). Só service role.';
