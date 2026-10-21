-- ORDEM OBRIGATÓRIA: aplicar DEPOIS de 20261020191637_agente_ia_perfil_fonte_unica.sql (T-13 faz v3->v4; esta faz v4->v5).
-- Sem a T-13 a guarda `versao = 4` não casa e o perfil padrão não é alterado (o resto desta migration vale assim mesmo).
-- Aplicar ANTES do deploy do engine da T-14: o engine novo marca `pendente_desde` em linhas `aguardando_atendente` para a IA
-- responder dúvidas na fila, e só o claim novo (abaixo) as reivindica. O engine antigo nunca marca essas linhas: o claim novo é
-- inofensivo para ele.
--
-- PRJ-2 T-14 (decisão do Bruno): enquanto a conversa está na fila SEM atendente definido a IA responde dúvidas; quando o
-- atendente é definido sai UMA mensagem de encerramento com o nome dele e a IA nunca mais responde. Texto e conduta vêm do perfil.
--   1. Perfil padrão 'qualificacao' v5: `pos_qualificacao.mensagem_transferencia` = mensagem de encerramento aprovada;
--      chaves novas `fila_ativa` (true), `instrucao_fila` (lista), `fila_max_respostas` (3).
--      Valores IDÊNTICOS aos padrões do código do engine (perfil.ts MENSAGEM_ENCERRAMENTO_PADRAO / FILA_MAX_RESPOSTAS_PADRAO,
--      prompt.ts PADRAO_INSTRUCAO_FILA). NÃO mexe em overrides de parceiro.
--   2. chat_agente_conversas.aviso_encerramento_enviado_em: carimbo do envio único do encerramento (a entrega pelo CRM não envia
--      WhatsApp; o tick do engine detecta a entrega e envia).
--   3. crm_agente_turno_claim: passa a reivindicar também `aguardando_atendente` com mensagem pendente (turno de dúvida na fila).
--      Mesma assinatura e retorno. Não religa a qualificação: o engine trata essa linha em modo fila e nunca muda o status dela.
--   4. Base de conhecimento `limites-do-atendimento`: sem a frase do CPF "só quando a pessoa quer simulação" (contradiz `solicitar`).
--   5. crm_agente_espera_entregar: não entrega linha com lease vivo (o fim do engine segura o lease até enviar o recibo/texto de
--      espera; sem isto o encerramento "A partir deste momento..." podia sair ANTES deles). Mesma assinatura e retorno.
-- Idempotente (guardas por versão/conteúdo, IF NOT EXISTS, CREATE OR REPLACE); sem DELETE.

-- 1. Perfil padrão v4 -> v5 --------------------------------------------------------------------------------------------------
with novo as (
  select jsonb_set(
           perfil || $t${"fila_ativa": true, "fila_max_respostas": 3, "instrucao_fila": ["A conversa já está na fila e um atendente da equipe vai continuar o atendimento. Enquanto isso, responda só dúvidas gerais, com base na base de conhecimento e no dossiê do convênio.", "Não colete mais dados e não peça documentos nem CPF.", "Não prometa prazo e não diga quando alguém vai atender.", "Se não souber a resposta, diga que o atendente confirma.", "Quando fizer sentido, lembre com naturalidade que a conversa está na fila.", "Responda em poucas frases."]}$t$::jsonb,
           '{pos_qualificacao,mensagem_transferencia}',
           to_jsonb($t$A partir deste momento, o atendimento será de {atendente} e eu não estarei mais com a conversa disponível para responder.$t$::text)) as perfil
  from public.ia_agente_perfis_padrao
  where tipo = 'qualificacao' and versao = 4
)
update public.ia_agente_perfis_padrao p
   set perfil = novo.perfil, versao = p.versao + 1, updated_at = now()
  from novo
 where p.tipo = 'qualificacao' and p.versao = 4;

insert into public.ia_agente_perfis_padrao_versoes (tipo, versao, perfil)
select tipo, versao, perfil from public.ia_agente_perfis_padrao
 where tipo = 'qualificacao' and versao = 5
on conflict (tipo, versao) do nothing;

-- 2. Carimbo do encerramento -------------------------------------------------------------------------------------------------
alter table public.chat_agente_conversas add column if not exists aviso_encerramento_enviado_em timestamptz;
comment on column public.chat_agente_conversas.aviso_encerramento_enviado_em is
  'PRJ-2 T-14: mensagem de encerramento (atendente definido) reivindicada/enviada pelo engine. Nulo = ainda não saiu.';
-- Varredura do tick (entregas da espera das últimas 2 h ainda sem encerramento).
create index if not exists chat_agente_conversas_encerramento_idx
  on public.chat_agente_conversas (roteado_em)
  where status = 'encerrada' and aviso_encerramento_enviado_em is null and roteado_para is not null;

-- 3. Claim: em_qualificacao OU aguardando_atendente (dúvida na fila) ---------------------------------------------------------
create or replace function public.crm_agente_turno_claim(p_limit integer default 10, p_janela_s integer default 4, p_lease_s integer default 60, p_provedores text[] default null::text[])
 returns setof public.chat_agente_conversas
 language sql
 security definer
 set search_path to ''
as $function$
  with cand as (
    select c.id
    from public.chat_agente_conversas c
    join public.chat_instancias i on i.id = c.instancia_id
    where (c.status = 'em_qualificacao' or (c.status = 'aguardando_atendente' and c.roteado_para is null))
      and c.pendente_desde is not null
      and c.pendente_desde < clock_timestamp() - make_interval(secs => p_janela_s)
      and (c.lease_ate is null or c.lease_ate < clock_timestamp())
      and (p_provedores is null or i.provedor = any (p_provedores))
    order by c.pendente_desde
    limit greatest(p_limit, 0)
    for update of c skip locked
  )
  update public.chat_agente_conversas c
  set lease_ate = clock_timestamp() + make_interval(secs => p_lease_s),
      lease_token = gen_random_uuid(),
      updated_at = now()
  from cand
  where c.id = cand.id
  returning c.*;
$function$;

-- 4. Base de conhecimento: CPF coerente com a lista `solicitar` do perfil ----------------------------------------------------
update public.ia_conhecimento_geral
   set conteudo_md = replace(conteudo_md,
         'O CPF só é pedido quando a pessoa quer simulação, com a explicação de que é necessário para consultar a margem e que o dado é protegido.',
         'Os documentos e dados pedidos (como CPF, contracheque ou extrato de margem) dependem da configuração do parceiro; quando o CPF é pedido, vem com a explicação de que é necessário para consultar a margem e que o dado é protegido.'),
       versao = versao + 1, updated_at = now()
 where chave = 'limites-do-atendimento'
   and conteudo_md like '%O CPF só é pedido quando a pessoa quer simulação%';

-- 5. Entrega da espera respeita o lease vivo ---------------------------------------------------------------------------------
-- Idêntica à de 20261005023447 (corpo, assinatura, grants preservados pelo CREATE OR REPLACE) + `lease_ate` livre/vencido.
create or replace function public.crm_agente_espera_entregar(p_parceiro uuid, p_usuario uuid, p_max_abertas integer default 5)
returns setof public.chat_agente_conversas language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_conversa uuid;
begin
  if not exists (select 1 from public.crm_usuarios where id = p_usuario and agente_parceiro_id = p_parceiro and ativo) then
    raise exception 'crm_agente_espera_entregar: usuário % não é atendente ativo do parceiro %', p_usuario, p_parceiro;
  end if;
  -- serializa entregas ao mesmo atendente (garante a contagem de abertas)
  insert into public.crm_presenca (crm_usuario_id, agente_parceiro_id) values (p_usuario, p_parceiro) on conflict do nothing;
  perform 1 from public.crm_presenca where crm_usuario_id = p_usuario for update;
  if (select count(*) from public.chat_conversas where atendente_atual_id = p_usuario) >= greatest(p_max_abertas, 0) then
    return;
  end if;
  select c.id, c.chat_conversa_id into v_id, v_conversa
  from public.chat_agente_conversas c
  where c.agente_parceiro_id = p_parceiro and c.status = 'aguardando_atendente' and c.roteado_para is null
    and (c.lease_ate is null or c.lease_ate < clock_timestamp())
  order by c.created_at
  limit 1
  for update of c skip locked;
  if v_id is null then return; end if;
  update public.chat_conversas set atendente_atual_id = p_usuario where id = v_conversa;
  update public.crm_contatos ct set atendente_id = p_usuario
  from public.chat_conversas cc
  where cc.id = v_conversa and ct.id = cc.crm_contato_id and ct.atendente_id is null;
  return query
    update public.chat_agente_conversas
    set roteado_para = p_usuario, roteado_em = clock_timestamp(), roteamento_motivo = 'espera',
        status = 'encerrada', updated_at = now()
    where id = v_id
    returning *;
end $$;
