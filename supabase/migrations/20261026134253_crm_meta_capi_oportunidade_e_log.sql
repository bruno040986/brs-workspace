-- Check-in de anúncio: pergunta única de OPORTUNIDADE + histórico de envios à Meta. Piloto GO337.
-- Decisão do Bruno (2026-10-26): as perguntas margem e refin viram uma só, "O lead tem possibilidade de negócio?"
-- (oportunidade sim|nao), com marcações OPCIONAIS dos tipos (margem, refin, portabilidade) quando sim; venda como hoje.
-- Para a Meta nada muda: oportunidade=sim gera o QualifiedLead (um por ciclo); venda=sim gera o Purchase (e garante o
-- QualifiedLead). Os tipos são só relatório interno.
--
-- CONTRATO (o que o web do CRM e o cron podem assumir):
--  * crm_anuncio_checkins ganha oportunidade (sim|nao|nulo), oportunidade_em, oportunidade_por e oportunidade_tipos
--    (text[] subconjunto de margem|refin|portabilidade, sem repetição, ordem fixa; vazio quando oportunidade <> 'sim').
--    margem/refin FICAM (histórico) e o backfill preenche oportunidade dos ciclos existentes.
--  * Pergunta 1 respondida = oportunidade not null (ou, legado, margem e refin ambos respondidos). Encerra com
--    pergunta 1 respondida E venda sim|nao; senão cobra de novo em X h de expediente (como antes).
--  * crm_anuncio_checkin_responder ganha o 10º argumento p_tipos text[] default null (assinatura de 9 sai):
--      - 'oportunidade' + 'sim': grava os tipos (nulo = nenhum); 'nao': limpa os tipos (p_tipos é ignorado).
--      - trocar só os tipos (mesma resposta sim) NÃO é correção (sem motivo, evento intacto), mas só o autor ou
--        p_pode_corrigir_qualquer, e até 7 dias depois do encerramento.
--      - trocar sim<->nao é correção: motivo, autoria, prazo e cancelamento do evento pendente como antes.
--      - 'margem'/'refin' continuam aceitos (web antigo durante a janela de deploy: esta migration sobe antes do
--        web) e são a mesma pergunta 1: qualquer um 'sim' => oportunidade 'sim' (+ tipo); ambos 'nao' => 'nao';
--        senão nulo. Depois que o caminho novo respondeu 'oportunidade' no ciclo (há linha no histórico), o legado
--        só grava margem/refin: nunca muda nem apaga a oportunidade, os tipos ou o evento.
--  * crm_meta_envios_log: histórico de CADA chamada à Meta (fila, botão de teste, descobrir dataset), só service_role
--    (select/insert), limpeza por crm_meta_envios_log_limpar(dias). Sem token, ctwa_clid, telefone, CPF ou nome:
--    só códigos/HTTP, a mensagem de erro da Meta cortada em 300 e o fbtrace_id.
--
-- Erros da RPC (message): os de antes (checkin_inexistente, checkin_desligado, resposta_invalida, valor_obrigatorio,
-- proposta_invalida, motivo_obrigatorio, prazo_correcao_vencido, correcao_nao_permitida) + tipos_invalidos.
--
-- ORDEM DE PUBLICAÇÃO: depois de 20261022220433_crm_meta_capi_checkin; ANTES do web que usa 'oportunidade'/p_tipos.
--
-- ROLLBACK (manual): o web antigo continua funcionando com esta migration no ar (ramos legados). Para desfazer:
--   drop function if exists public.crm_meta_envios_log_limpar(integer);
--   drop table if exists public.crm_meta_envios_log;
--   e reaplicar a seção 7 de 20261022220433_crm_meta_capi_checkin.sql (assinatura de 9) depois de
--   drop function public.crm_anuncio_checkin_responder(uuid, uuid, text, text, numeric, uuid, uuid, text, boolean, text[]);
--   as colunas oportunidade* podem ficar (nulas para o código antigo); o CHECK de pergunta do histórico precisa
--   continuar aceitando 'oportunidade' enquanto houver linhas com ela.
--
-- Idempotente: pode rodar duas vezes sem efeito na segunda.

-- `supabase db push` não roda a migration em transação: `set local` não vale.
set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Ciclo: pergunta única de oportunidade (+ tipos) e backfill
-- ---------------------------------------------------------------------------
alter table public.crm_anuncio_checkins
  add column if not exists oportunidade text null,
  add column if not exists oportunidade_em timestamptz null,
  add column if not exists oportunidade_por uuid null references public.crm_usuarios (id) on delete set null,
  add column if not exists oportunidade_tipos text[] not null default '{}';
alter table public.crm_anuncio_checkins drop constraint if exists crm_anuncio_checkins_oportunidade_check;
alter table public.crm_anuncio_checkins add constraint crm_anuncio_checkins_oportunidade_check
  check (oportunidade in ('sim', 'nao'));
-- Subconjunto (elemento nulo não passa no <@) e só com oportunidade = 'sim'. Repetição/ordem: a RPC normaliza.
alter table public.crm_anuncio_checkins drop constraint if exists crm_anuncio_checkins_oportunidade_tipos_check;
alter table public.crm_anuncio_checkins add constraint crm_anuncio_checkins_oportunidade_tipos_check
  check (oportunidade_tipos <@ array['margem', 'refin', 'portabilidade']::text[]
         and (oportunidade is not distinct from 'sim' or cardinality(oportunidade_tipos) = 0));

comment on column public.crm_anuncio_checkins.oportunidade is
  'Pergunta 1 do check-in: "O lead tem possibilidade de negócio?" sim|nao (nulo = não respondida). sim => QualifiedLead.';
comment on column public.crm_anuncio_checkins.oportunidade_tipos is
  'Tipos marcados quando oportunidade = sim (margem|refin|portabilidade, opcionais). Só relatório interno, não vai à Meta.';
comment on column public.crm_anuncio_checkins.margem is
  'LEGADO (até 2026-10-26): margem disponível. Substituída por oportunidade + oportunidade_tipos; mantida como histórico.';
comment on column public.crm_anuncio_checkins.refin is
  'LEGADO (até 2026-10-26): refin disponível. Substituída por oportunidade + oportunidade_tipos; mantida como histórico.';
comment on table public.crm_anuncio_checkins is
  'Check-in de anúncio: 1 ciclo por conversa YCloud (oportunidade/venda; margem/refin legados). Escrita: insert/adiar pelo TS, respostas só pela RPC crm_anuncio_checkin_responder.';

-- Backfill (só ciclos ainda sem oportunidade): margem ou refin sim => sim (tipos correspondentes); ambos nao => nao;
-- demais ficam nulos. em/por = a resposta MAIS ANTIGA entre as que definem o resultado (e o autor dela).
update public.crm_anuncio_checkins c
   set oportunidade = b.op, oportunidade_tipos = b.tipos, oportunidade_em = r.em, oportunidade_por = r.por
  from (select x.id, x.margem, x.margem_em, x.margem_por, x.refin, x.refin_em, x.refin_por,
               case when x.margem = 'sim' or x.refin = 'sim' then 'sim' else 'nao' end as op,
               array_remove(array[case when x.margem = 'sim' then 'margem' end, case when x.refin = 'sim' then 'refin' end], null)::text[] as tipos
          from public.crm_anuncio_checkins x
         where x.oportunidade is null
           and (x.margem = 'sim' or x.refin = 'sim' or (x.margem = 'nao' and x.refin = 'nao'))) b
  cross join lateral (
    select v.em, v.por
      from (values (b.margem, b.margem_em, b.margem_por), (b.refin, b.refin_em, b.refin_por)) v(resp, em, por)
     where v.resp = b.op
     order by v.em nulls last
     limit 1) r
 where c.id = b.id;

-- ---------------------------------------------------------------------------
-- 2. Histórico de respostas: pergunta 'oportunidade' (antigas ficam) + tipos gravados
-- ---------------------------------------------------------------------------
alter table public.crm_anuncio_checkin_respostas add column if not exists tipos text[] null;
alter table public.crm_anuncio_checkin_respostas drop constraint if exists crm_anuncio_checkin_respostas_pergunta_check;
alter table public.crm_anuncio_checkin_respostas add constraint crm_anuncio_checkin_respostas_pergunta_check
  check (pergunta in ('oportunidade', 'margem', 'refin', 'venda'));
alter table public.crm_anuncio_checkin_respostas drop constraint if exists crm_anuncio_checkin_respostas_tipos_check;
alter table public.crm_anuncio_checkin_respostas add constraint crm_anuncio_checkin_respostas_tipos_check
  check (tipos is null or (pergunta = 'oportunidade' and tipos <@ array['margem', 'refin', 'portabilidade']::text[]));
comment on column public.crm_anuncio_checkin_respostas.tipos is
  'Pergunta oportunidade: tipos gravados nesta resposta (troca só de tipos = linha com resposta = resposta_anterior, sem motivo).';

-- ---------------------------------------------------------------------------
-- 3. RPC atômica de resposta (assinatura de 10 argumentos)
-- ---------------------------------------------------------------------------
-- Erros (message, para o TS traduzir): checkin_inexistente, checkin_desligado, resposta_invalida, tipos_invalidos,
-- valor_obrigatorio, proposta_invalida, motivo_obrigatorio, prazo_correcao_vencido, correcao_nao_permitida.
-- !!! NUNCA conceder EXECUTE a authenticated/anon: p_parceiro e p_pode_corrigir_qualquer vêm do chamador !!!
-- A de 9 argumentos sai antes: com as duas, a chamada por nome do PostgREST fica ambígua. O web antigo (9 args por
-- nome) continua resolvendo nesta, porque p_tipos tem default.
drop function if exists public.crm_anuncio_checkin_responder(uuid, uuid, text, text, numeric, uuid, uuid, text, boolean);
create or replace function public.crm_anuncio_checkin_responder(
  p_parceiro uuid,
  p_checkin uuid,
  p_pergunta text,
  p_resposta text,
  p_valor numeric default null,
  p_proposta uuid default null,
  p_usuario uuid default null,
  p_motivo text default null,
  p_pode_corrigir_qualquer boolean default false,
  p_tipos text[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  c public.crm_anuncio_checkins%rowtype;
  cfg public.crm_parceiro_config%rowtype;
  e public.crm_meta_eventos%rowtype;
  v_atual text;
  v_mudou boolean;
  v_tipos text[];
  v_op text;
  v_valor numeric(14,2);
  v_proposta uuid;
  v_correcao boolean;
  v_ja_enviado boolean := false;
  v_corte timestamptz;
  v_oc bigint;
  v_oc_provedor text;
  v_oc_waba text;
  v_status text;
  v_ev text;
  v_desejado boolean;
  v_ev_valor numeric(14,2);
begin
  -- 1. Trava o ciclo e confere a liberação + interruptor do parceiro.
  select * into c from public.crm_anuncio_checkins where id = p_checkin and agente_parceiro_id = p_parceiro for update;
  if not found then raise exception 'checkin_inexistente'; end if;
  select * into cfg from public.crm_parceiro_config where agente_parceiro_id = p_parceiro;
  if not found or not cfg.checkin_anuncio_ativo or cfg.meta_conversoes_status not in ('teste', 'pago')
     or cfg.meta_conversoes_ate < now() then
    raise exception 'checkin_desligado';
  end if;

  -- 2. Valida o par, os tipos e o valor.
  if p_pergunta is null or p_pergunta not in ('oportunidade', 'margem', 'refin', 'venda')
     or p_resposta is null or p_resposta not in ('sim', 'nao', 'em_andamento')
     or (p_resposta = 'em_andamento' and p_pergunta <> 'venda') then
    raise exception 'resposta_invalida';
  end if;
  if cardinality(p_tipos) > 0
     and (p_pergunta <> 'oportunidade' or array_position(p_tipos, null) is not null
          or not (p_tipos <@ array['margem', 'refin', 'portabilidade']::text[])) then
    raise exception 'tipos_invalidos';
  end if;
  if p_pergunta = 'oportunidade' then
    -- Sem repetição, ordem fixa; 'nao' limpa (p_tipos ignorado).
    v_tipos := case when p_resposta = 'sim' then array(
      select t from unnest(array['margem', 'refin', 'portabilidade']::text[]) with ordinality u(t, n)
       where t = any (p_tipos) order by n) else '{}'::text[] end;
  end if;
  if p_pergunta = 'venda' and p_resposta = 'sim' then
    v_valor := p_valor;
    v_proposta := p_proposta;
    if v_valor is null or v_valor <= 0 then raise exception 'valor_obrigatorio'; end if;
  end if;
  if p_proposta is not null and (v_proposta is null or not exists (
       select 1 from public.propostas_credito pr where pr.id = p_proposta and pr.agente_parceiro_id = p_parceiro)) then
    raise exception 'proposta_invalida';
  end if;

  v_atual := case p_pergunta when 'oportunidade' then c.oportunidade when 'margem' then c.margem
                             when 'refin' then c.refin else c.venda end;
  v_mudou := v_atual is distinct from p_resposta;

  -- 3. Mesma resposta (e mesmos valor/proposta/tipos): devolve o estado sem gravar (duplo clique).
  if v_mudou
     or (p_pergunta = 'venda' and (c.venda_valor is distinct from v_valor or c.venda_proposta_id is distinct from v_proposta))
     or (p_pergunta = 'oportunidade' and c.oportunidade_tipos is distinct from v_tipos) then

    -- Correção = trocar uma resposta final (sim/nao, ou o valor/proposta da venda). Trocar só os tipos não é
    -- correção (sem motivo), mas tem a mesma restrição de autoria e prazo. Conferido sob o lock.
    v_correcao := coalesce(v_atual in ('sim', 'nao'), false) and (v_mudou or p_pergunta = 'venda');
    if v_correcao or not v_mudou then
      if v_correcao and length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'motivo_obrigatorio'; end if;
      if c.encerrado_em < now() - interval '7 days' then raise exception 'prazo_correcao_vencido'; end if;
      if not coalesce(p_pode_corrigir_qualquer, false) and (p_usuario is null or p_usuario is distinct from
           case p_pergunta when 'oportunidade' then c.oportunidade_por when 'margem' then c.margem_por
                           when 'refin' then c.refin_por else c.venda_por end) then
        raise exception 'correcao_nao_permitida';
      end if;
    end if;

    -- 4. Grava a resposta.
    if p_pergunta = 'oportunidade' then
      if v_mudou then c.oportunidade := p_resposta; c.oportunidade_em := now(); c.oportunidade_por := p_usuario; end if;
      c.oportunidade_tipos := v_tipos;
    elsif p_pergunta in ('margem', 'refin') then
      if p_pergunta = 'margem' then
        c.margem := p_resposta; c.margem_em := now(); c.margem_por := p_usuario;
      else
        c.refin := p_resposta; c.refin_em := now(); c.refin_por := p_usuario;
      end if;
      -- Legado = a mesma pergunta 1: qualquer sim => sim; ambos nao => nao; senão ainda não respondida.
      -- Só recalcula se o caminho novo nunca respondeu 'oportunidade' neste ciclo: uma oportunidade gravada pelo
      -- web novo (com seus tipos e o evento) nunca é apagada por uma chamada legada; margem/refin ficam só no histórico.
      if not exists (select 1 from public.crm_anuncio_checkin_respostas h where h.checkin_id = c.id and h.pergunta = 'oportunidade') then
        v_op := case when c.margem = 'sim' or c.refin = 'sim' then 'sim'
                     when c.margem = 'nao' and c.refin = 'nao' then 'nao' end;
        if v_op is distinct from c.oportunidade then
          c.oportunidade := v_op;
          c.oportunidade_em := case when v_op is not null then now() end;
          c.oportunidade_por := case when v_op is not null then p_usuario end;
        end if;
        c.oportunidade_tipos := case when v_op = 'sim' then array_remove(
          array[case when c.margem = 'sim' then 'margem' end, case when c.refin = 'sim' then 'refin' end], null)::text[]
          else '{}'::text[] end;
      end if;
    else
      c.venda := p_resposta; c.venda_em := now(); c.venda_por := p_usuario;
      c.venda_valor := v_valor; c.venda_proposta_id := v_proposta;
    end if;

    -- 5. Encerra quando a pergunta 1 está respondida e venda sim/nao; senão reabre e cobra de novo em X h de expediente.
    if (c.oportunidade is not null or (c.margem is not null and c.refin is not null)) and c.venda in ('sim', 'nao') then
      c.encerrado_em := coalesce(c.encerrado_em, now());
    else
      c.encerrado_em := null;
      c.proxima_pergunta_em := public.crm_expediente_somar_horas(p_parceiro, now(), cfg.checkin_intervalo_horas);
    end if;

    update public.crm_anuncio_checkins
       set oportunidade = c.oportunidade, oportunidade_em = c.oportunidade_em, oportunidade_por = c.oportunidade_por,
           oportunidade_tipos = c.oportunidade_tipos,
           margem = c.margem, margem_em = c.margem_em, margem_por = c.margem_por,
           refin = c.refin, refin_em = c.refin_em, refin_por = c.refin_por,
           venda = c.venda, venda_em = c.venda_em, venda_por = c.venda_por,
           venda_valor = c.venda_valor, venda_proposta_id = c.venda_proposta_id,
           encerrado_em = c.encerrado_em, proxima_pergunta_em = c.proxima_pergunta_em
     where id = c.id;

    -- 6. Clique atribuído: último com clid até agora, posterior ao encerramento do ciclo anterior (P4).
    select max(x.encerrado_em) into v_corte
      from public.crm_anuncio_checkins x
     where x.chat_conversa_id = c.chat_conversa_id and x.id <> c.id and x.created_at < c.created_at;
    select o.id, i.provedor, i.ycloud_waba_id into v_oc, v_oc_provedor, v_oc_waba
      from public.chat_anuncio_ocorrencias o
      join public.chat_instancias i on i.id = o.instancia_id
     where o.chat_conversa_id = c.chat_conversa_id and o.agente_parceiro_id = p_parceiro
       and o.fonte = 'ctwa' and o.ctwa_clid is not null and o.recebido_em <= now()
       and (v_corte is null or o.recebido_em > v_corte)
     order by o.recebido_em desc, o.id desc
     limit 1;
    v_status := case
      when cfg.meta_capi_status = 'desligado' then 'desligado'
      when v_oc is null then 'sem_clid'
      when v_oc_provedor is distinct from 'ycloud' or v_oc_waba is null then 'sem_envio_baileys'
      else 'pendente' end;

    -- 7. Sincroniza a fila: QualifiedLead = oportunidade OU venda sim (um só por ciclo); Purchase = venda sim.
    foreach v_ev in array array['QualifiedLead', 'Purchase'] loop
      v_desejado := case v_ev
        when 'QualifiedLead' then coalesce(c.oportunidade = 'sim' or c.venda = 'sim', false)
        else c.venda is not distinct from 'sim' end;
      v_ev_valor := case when v_ev = 'Purchase' then c.venda_valor end;
      select * into e from public.crm_meta_eventos m where m.checkin_id = c.id and m.evento = v_ev for update;
      if not found then
        if v_desejado then
          insert into public.crm_meta_eventos (agente_parceiro_id, checkin_id, ocorrencia_id, evento, event_id, event_time, valor, status, proximo_retry_em)
          values (p_parceiro, c.id, v_oc, v_ev, 'brs:' || c.id || case when v_ev = 'Purchase' then ':purchase' else ':ql' end,
                  now(), v_ev_valor, v_status, now() + interval '10 minutes')
          on conflict (checkin_id, evento) do nothing;
        end if;
      elsif e.status = 'enviado' or (e.status = 'processando' and v_desejado) then
        -- Já saiu (ou está saindo e continua desejado): nunca desfaz nem reenvia (a Meta não deduplica). Só marca no histórico.
        if not v_desejado or e.valor is distinct from v_ev_valor then v_ja_enviado := true; end if;
      elsif not v_desejado then
        -- Inclui 'processando' (linha travada acima). Se o envio já tiver saído, o cron grava 'enviado' por cima deste
        -- 'cancelado': o que aconteceu de fato prevalece.
        update public.crm_meta_eventos set status = 'cancelado' where id = e.id and status <> 'cancelado';
      elsif e.status = 'cancelado' then
        -- Nunca saiu: reativa com o MESMO event_id e nova janela de correção.
        update public.crm_meta_eventos
           set status = v_status, ocorrencia_id = v_oc, event_time = now(), valor = v_ev_valor, tentativas = 0,
               proximo_retry_em = now() + interval '10 minutes', ultimo_erro = null, teste = false,
               fbtrace_id = null, enviado_em = null
         where id = e.id;
      elsif e.valor is distinct from v_ev_valor then
        update public.crm_meta_eventos set valor = v_ev_valor where id = e.id;
      end if;
    end loop;

    -- 8. Histórico.
    insert into public.crm_anuncio_checkin_respostas
      (checkin_id, pergunta, resposta, resposta_anterior, valor, proposta_id, motivo_correcao, evento_ja_enviado, respondido_por, tipos)
    values (c.id, p_pergunta, p_resposta, v_atual, v_valor, v_proposta,
            case when v_correcao then left(trim(p_motivo), 500) end, v_ja_enviado, p_usuario,
            case when p_pergunta = 'oportunidade' then v_tipos end);
  end if;

  return (
    select jsonb_build_object(
      'checkin', to_jsonb(x),
      'eventos', coalesce((select jsonb_agg(jsonb_build_object('evento', m.evento, 'status', m.status) order by m.evento)
                             from public.crm_meta_eventos m where m.checkin_id = x.id), '[]'::jsonb))
    from public.crm_anuncio_checkins x where x.id = p_checkin);
end $function$;

comment on function public.crm_anuncio_checkin_responder(uuid, uuid, text, text, numeric, uuid, uuid, text, boolean, text[]) is
  'Grava 1 resposta do check-in (oportunidade+tipos | venda; margem/refin legados) e sincroniza crm_meta_eventos (atraso de 10 min). security definer: NUNCA conceder EXECUTE a authenticated/anon; só service_role.';
revoke all on function public.crm_anuncio_checkin_responder(uuid, uuid, text, text, numeric, uuid, uuid, text, boolean, text[]) from public, anon, authenticated;
grant execute on function public.crm_anuncio_checkin_responder(uuid, uuid, text, text, numeric, uuid, uuid, text, boolean, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Histórico de envios à Meta (log da conexão)
-- ---------------------------------------------------------------------------
-- Sem token, ctwa_clid, telefone, CPF ou nome (nem o corpo do pedido). Só o resultado: HTTP, códigos da Meta, a
-- mensagem de erro dela cortada (<= 300; pode citar ids técnicos como WABA/dataset) e o fbtrace_id.
create table if not exists public.crm_meta_envios_log (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  evento_id uuid null references public.crm_meta_eventos (id) on delete set null,  -- nulo: botão de teste / descobrir dataset
  origem text not null,
  teste boolean not null default false,  -- saiu com test_event_code
  ok boolean not null,
  http integer null,                     -- nulo = não chegou a ter resposta (rede/timeout)
  meta_codigo integer null,              -- error.code
  meta_subcodigo integer null,           -- error.error_subcode
  meta_tipo text null,                   -- error.type
  mensagem text null,                    -- error.message cortada pelo TS (nunca o corpo enviado)
  fbtrace_id text null,
  evento text null,                      -- nome enviado à Meta (nulo em descobrir_dataset)
  criado_em timestamptz not null default now()
);
alter table public.crm_meta_envios_log drop constraint if exists crm_meta_envios_log_origem_check;
alter table public.crm_meta_envios_log add constraint crm_meta_envios_log_origem_check
  check (origem in ('fila', 'botao_teste', 'descobrir_dataset'));
alter table public.crm_meta_envios_log drop constraint if exists crm_meta_envios_log_mensagem_check;
alter table public.crm_meta_envios_log add constraint crm_meta_envios_log_mensagem_check
  check (length(mensagem) <= 300);
-- Mesmos nomes de crm_meta_eventos.evento (o botão de teste também manda QualifiedLead) + TestEvent.
alter table public.crm_meta_envios_log drop constraint if exists crm_meta_envios_log_evento_check;
alter table public.crm_meta_envios_log add constraint crm_meta_envios_log_evento_check
  check (evento in ('QualifiedLead', 'Purchase', 'TestEvent'));
-- on delete set null de crm_meta_eventos (e "envios deste evento") sem varrer o log.
create index if not exists crm_meta_envios_log_evento_idx
  on public.crm_meta_envios_log (evento_id) where evento_id is not null;
create index if not exists crm_meta_envios_log_parceiro_idx
  on public.crm_meta_envios_log (agente_parceiro_id, criado_em desc);

comment on table public.crm_meta_envios_log is
  'Histórico de chamadas à API de Conversões da Meta (fila, botão de teste, descobrir dataset). Sem token, ctwa_clid, telefone, CPF ou nome. Limpeza: crm_meta_envios_log_limpar(dias).';

alter table public.crm_meta_envios_log enable row level security;
revoke all on public.crm_meta_envios_log from public, anon, authenticated, service_role;
grant select, insert on public.crm_meta_envios_log to service_role;

-- Apaga o que tem mais de p_dias (padrão 30) e devolve quantos. security definer: o service_role não tem delete.
create or replace function public.crm_meta_envios_log_limpar(p_dias integer default 30)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare v_apagados integer;
begin
  if p_dias is null or p_dias < 1 then raise exception 'dias_invalido'; end if;
  delete from public.crm_meta_envios_log where criado_em < now() - make_interval(days => p_dias);
  get diagnostics v_apagados = row_count;
  return v_apagados;
end $function$;

comment on function public.crm_meta_envios_log_limpar(integer) is
  'Apaga o histórico de envios à Meta com mais de p_dias (padrão 30); devolve a contagem. Só service_role.';
revoke all on function public.crm_meta_envios_log_limpar(integer) from public, anon, authenticated;
grant execute on function public.crm_meta_envios_log_limpar(integer) to service_role;

reset lock_timeout;
notify pgrst, 'reload schema';
