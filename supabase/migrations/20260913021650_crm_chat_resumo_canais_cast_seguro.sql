-- Correção da RPC crm_chat_resumo_canais (Fable, 12/09/2026): a 1ª versão
-- resolvia "o outro usuário" do canal direto numa subconsulta LATERAL com
-- `where c.tipo = 'direto'` e cast `split_part(...)::uuid` no SELECT. O
-- planejador pode puxar a subconsulta para cima e avaliar o cast ANTES do
-- filtro — para canais 'equipe'/'pessoal' o split_part devolve '' e o cast
-- explode (22P02). Detectado em teste antes de qualquer código usar a RPC.
-- Agora o cast fica dentro de um CASE por tipo: CASE só avalia o ramo
-- escolhido.
--
-- APLICADA via Supabase MCP (apply_migration) com esta mesma versão
-- registrada — este arquivo é o espelho no repositório.
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
  -- canal 'direto': chave = 'direto:<menor_id>:<maior_id>'; o outro é o que não sou eu.
  -- Cast só dentro do ramo 'direto' do CASE (avaliação garantida por ramo).
  left join crm_usuarios o
    on o.id = case
      when c.tipo = 'direto' then (
        case when split_part(c.chave, ':', 2) = p_crm_usuario_id::text
             then split_part(c.chave, ':', 3)
             else split_part(c.chave, ':', 2)
        end
      )::uuid
    end
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
