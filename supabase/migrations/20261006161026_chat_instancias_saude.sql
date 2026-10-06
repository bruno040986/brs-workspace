-- Saúde dos números Baileys + quarentena fail-closed (Bruno, 06/10/2026).
--
-- A quarentena de `crm_parceiro_config.disparo_aquecimento_horas` (48 h) deixa
-- de ser sinalizador e passa a BLOQUEAR o disparo; `pareada_em` nulo = bloqueado
-- (revoga a decisão de 13/09 registrada em 20260913221955). Por isso esta
-- migration faz o backfill de `pareada_em` e libera as instâncias que JÁ
-- disparavam no pareamento atual — senão o deploy do engine pararia o disparo.
--
-- ORDEM DE PUBLICAÇÃO: esta migration ANTES do engine/web que usam as colunas
-- e os novos valores de CHECK (insert de evento com tipo/motivo novo falha mudo).
--
-- Idempotente: pode rodar duas vezes sem efeito na segunda.

-- `supabase db push` não roda a migration em transação: `set local` não vale.
-- A tabela de eventos recebe INSERT o tempo todo; falha rápido e dá para repetir.
set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Colunas novas em chat_instancias (todas nulas por padrão)
-- ---------------------------------------------------------------------------
alter table public.chat_instancias
  add column if not exists banida_em timestamptz null,
  add column if not exists analise_pedida_em timestamptz null,
  add column if not exists quarentena_origem text null
    constraint chat_instancias_quarentena_origem_check
    check (quarentena_origem in ('novo', 'pos_restricao', 'pos_banimento')),
  add column if not exists reconexao_falhou_em timestamptz null,
  add column if not exists proxy_ip text null,
  add column if not exists proxy_ip_em timestamptz null,
  -- Coluna gerada: o navegador sabe que há proxy sem selecionar a coluna cifrada.
  -- Reescreve a tabela (poucas dezenas de linhas) sob lock exclusivo curto.
  add column if not exists proxy_configurado boolean
    generated always as (proxy_url_cifrada is not null) stored;

comment on column public.chat_instancias.banida_em is
  'Banimento registrado (após tentativa de QR ou por botão). Limpo quando um novo pareamento tem sucesso.';
comment on column public.chat_instancias.analise_pedida_em is
  'Pedido de análise do banimento à Meta (previsão 24-48 h). Limpo quando um novo pareamento tem sucesso.';
comment on column public.chat_instancias.quarentena_origem is
  'Tipo da quarentena do pareamento atual: novo (Quarentena Novo Número), pos_restricao (Quarentena Pós-Restrição), pos_banimento (Quarentena Pós-Banimento). Duração = crm_parceiro_config.disparo_aquecimento_horas a partir de pareada_em.';
comment on column public.chat_instancias.reconexao_falhou_em is
  'Tentativas automáticas de reconexão esgotadas (403 repetido, conflito, N falhas): "Reconexão falhou, refaça o pareamento manual do QR Code". Limpo ao parear.';
comment on column public.chat_instancias.proxy_ip is
  'IP de saída observado pelo engine ao conectar com proxy (best-effort). Zerado ao salvar/remover proxy.';
comment on column public.chat_instancias.proxy_ip_em is
  'Quando o proxy foi aplicado na sessão atual (marca de "proxy ativo"). Zerado ao salvar/remover proxy.';
comment on column public.chat_instancias.proxy_configurado is
  'Gerada: proxy_url_cifrada is not null. Usar no navegador em vez da coluna cifrada.';
comment on column public.chat_instancias.disparo_liberado_em is
  'Liberação antecipada da quarentena (só master, permissão config.liberar_disparo); só vale se >= pareada_em (pareamento atual).';

-- ---------------------------------------------------------------------------
-- 2. CHECKs de chat_instancia_eventos (mantém todos os valores atuais)
-- ---------------------------------------------------------------------------
alter table public.chat_instancia_eventos drop constraint if exists chat_instancia_eventos_tipo_check;
alter table public.chat_instancia_eventos
  add constraint chat_instancia_eventos_tipo_check
  check (tipo in ('conexao', 'desconexao_sistema', 'desconexao_externa', 'reconexao', 'liberacao_antecipada', 'numero_divergente', 'restricao', 'banimento', 'status_publicado', 'proxy_configurado', 'proxy_removido', 'proxy_falha', 'proxy_testado',
                  'analise_pedida', 'exclusao', 'reconexao_falhou'));

alter table public.chat_instancia_eventos drop constraint if exists chat_instancia_eventos_motivo_check;
alter table public.chat_instancia_eventos
  add constraint chat_instancia_eventos_motivo_check
  check (motivo in ('banimento', 'restricao_meta', 'desconexao_manual', 'desconexao_aparelho', 'mudanca_aparelho', 'mudanca_aplicativo', 'outro',
                    'analise_negada_banimento_definitivo', 'numero_perdido_operadora', 'mudanca_finalidade', 'numero_pre_aquecido'));

-- ---------------------------------------------------------------------------
-- 3. Backfill de pareada_em (só onde é nulo; Baileys não excluídas com sessão)
-- ---------------------------------------------------------------------------
-- Último `conexao` que abriu um ciclo novo: sem evento anterior, ou depois de
-- desconexao_sistema / reconexao (QR lido de novo) / desconexao_externa de
-- sessão encerrada (401). Sem evidência: created_at. Sem sessão (aguardando QR)
-- fica nulo e o engine carimba no próximo QR.
with ciclo as (
  select instancia_id, tipo, created_at,
         lag(tipo) over w as ant_tipo,
         lag(observacao) over w as ant_obs
  from public.chat_instancia_eventos
  where tipo in ('conexao', 'desconexao_externa', 'desconexao_sistema', 'reconexao')
  window w as (partition by instancia_id order by created_at)
), ultimo as (
  select instancia_id, max(created_at) as em
  from ciclo
  where tipo = 'conexao'
    and (ant_tipo is null
         or ant_tipo in ('desconexao_sistema', 'reconexao')
         or (ant_tipo = 'desconexao_externa' and ant_obs like 'Sessão encerrada%'))
  group by instancia_id
)
update public.chat_instancias i
set pareada_em = coalesce((select u.em from ultimo u where u.instancia_id = i.id), i.created_at),
    quarentena_origem = coalesce(i.quarentena_origem, 'novo')
where i.pareada_em is null
  and i.deleted_at is null
  and i.provedor = 'baileys'
  and i.sessao_cifrada is not null;

-- ---------------------------------------------------------------------------
-- 4. Libera quem JÁ disparava neste pareamento quando a quarentena passou a valer
-- ---------------------------------------------------------------------------
-- Só instâncias de disparo conectadas, ainda na janela, sem liberação válida e
-- com envio depois do pareamento. Fora da janela não altera nada (idempotente:
-- na 2ª execução disparo_liberado_em >= pareada_em).
with alvo as (
  update public.chat_instancias i
  set disparo_liberado_em = now()
  where i.deleted_at is null
    and i.provedor = 'baileys'
    and i.papel = 'disparo'
    and i.status = 'conectada'
    and i.pareada_em is not null
    and i.pareada_em + make_interval(hours => coalesce(
          (select c.disparo_aquecimento_horas from public.crm_parceiro_config c where c.agente_parceiro_id = i.agente_parceiro_id), 48)) > now()
    and (i.disparo_liberado_em is null or i.disparo_liberado_em < i.pareada_em)
    and exists (select 1 from public.crm_disparo_fila q
                where q.instancia_id = i.id and q.status = 'enviado' and q.enviado_em >= i.pareada_em)
  returning i.id, i.agente_parceiro_id
)
insert into public.chat_instancia_eventos (instancia_id, agente_parceiro_id, tipo, motivo, origem, observacao)
select id, agente_parceiro_id, 'liberacao_antecipada', 'outro', 'engine',
       '[migração] já disparava neste pareamento quando a quarentena passou a valer'
from alvo;

-- ---------------------------------------------------------------------------
-- 5. Permissão nova do CRM: config.liberar_disparo (só o perfil global master)
-- ---------------------------------------------------------------------------
insert into public.crm_perfis_permissoes (perfil_id, permissao)
select p.id, 'config.liberar_disparo'
from public.crm_perfis p
where p.agente_parceiro_id is null and p.chave = 'master'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 6. Saneamento do histórico de restrições falsas: NÃO apagar nem reescrever.
-- ---------------------------------------------------------------------------
-- Até 06/10 o fluxo pedia o motivo ANTES do QR, então "restrição" era marcada
-- e o QR conectava em seguida. Para recalcular baseline (taxa de restrição),
-- tratar como FALSA a `reconexao/restricao_meta` seguida de `conexao` da mesma
-- instância em até 10 min (em 06/10: 3 de 7):
--
--   select e.id, e.instancia_id, e.created_at,
--          exists (select 1 from public.chat_instancia_eventos c
--                  where c.instancia_id = e.instancia_id and c.tipo = 'conexao'
--                    and c.created_at > e.created_at
--                    and c.created_at <= e.created_at + interval '10 minutes') as falsa
--   from public.chat_instancia_eventos e
--   where e.tipo = 'reconexao' and e.motivo = 'restricao_meta';

reset lock_timeout;
notify pgrst, 'reload schema';
