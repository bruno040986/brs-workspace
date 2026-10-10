-- Fixture para *_crm_maturacao.sql (Workspace). Roda sobre o bootstrap.sql do CRM
-- (brs-alvoconsig/tests/db/bootstrap.sql), DEPOIS da migration antiga
-- 20260905125422_crm_disparo_trafego_tecnico.sql (estado de produção antes da
-- limpeza) e ANTES da migration nova. maturacao.sql roda depois.
-- Só dados sintéticos.

-- chat_instancias: colunas que a migration lê (todas com default/nulas).
alter table public.chat_instancias
  add column if not exists provedor text not null default 'baileys',
  add column if not exists papel text not null default 'disparo',
  add column if not exists status text not null default 'conectada',
  add column if not exists proxy_url_cifrada text,
  add column if not exists banida_em timestamptz,
  add column if not exists restrito_ate timestamptz,
  add column if not exists proxy_ip_em timestamptz,
  add column if not exists reconexao_falhou_em timestamptz;
alter table public.chat_instancias
  add column if not exists proxy_configurado boolean generated always as (proxy_url_cifrada is not null) stored;

-- chat_instancia_eventos como em produção (após 20261006161026).
create table if not exists public.chat_instancia_eventos (
  id uuid primary key default gen_random_uuid(),
  instancia_id uuid not null references public.chat_instancias (id) on delete cascade,
  agente_parceiro_id uuid null,
  tipo text not null check (tipo in ('conexao', 'desconexao_sistema', 'desconexao_externa', 'reconexao', 'liberacao_antecipada', 'numero_divergente', 'restricao', 'banimento', 'status_publicado', 'proxy_configurado', 'proxy_removido', 'proxy_falha', 'proxy_testado', 'analise_pedida', 'exclusao', 'reconexao_falhou')),
  motivo text null,
  prazo_horas integer null,
  observacao text null,
  numero_detectado text null,
  origem text not null check (origem in ('engine', 'usuario')),
  autor_crm_usuario_id uuid null,
  created_at timestamptz not null default now()
);

-- Perfis: globais + um master de parceiro (este NÃO recebe a permissão).
insert into public.crm_perfis values
  ('00000000-0000-0000-0000-0000000000a1', null, 'master'),
  ('00000000-0000-0000-0000-0000000000a2', null, 'operacional'),
  ('00000000-0000-0000-0007-0000000000a9', '00000000-0000-0000-0007-000000000001', 'master')
on conflict do nothing;

-- Parceiro 7 (o do teste) e parceiro 8 (outro).
insert into public.agentes_parceiros values ('00000000-0000-0000-0007-000000000001'), ('00000000-0000-0000-0008-000000000001') on conflict do nothing;
insert into public.crm_parceiro_config (agente_parceiro_id, habilitado) values
  ('00000000-0000-0000-0007-000000000001', true), ('00000000-0000-0000-0008-000000000001', true) on conflict do nothing;
insert into public.crm_campanhas_parceiro (id, agente_parceiro_id) values ('00000000-0000-0000-0007-0000000000d1', '00000000-0000-0000-0007-000000000001');
insert into public.crm_templates_mensagem (id) values ('00000000-0000-0000-0007-0000000000d2');

-- Instâncias (proxy_url_cifrada fictícia: só IS NOT NULL importa)
--  b1 b2 b3 disparo+proxy · b4 receptiva+proxy  → elegíveis
--  b5 sem proxy · b6 zapi · b7 banida · b8 restrição vigente · b9 outro parceiro · ba excluída → inelegíveis
insert into public.chat_instancias (id, agente_parceiro_id, deleted_at, provedor, papel, proxy_url_cifrada, banida_em, restrito_ate) values
  ('00000000-0000-0000-0007-0000000000b1', '00000000-0000-0000-0007-000000000001', null, 'baileys', 'disparo', 'x', null, null),
  ('00000000-0000-0000-0007-0000000000b2', '00000000-0000-0000-0007-000000000001', null, 'baileys', 'disparo', 'x', null, null),
  ('00000000-0000-0000-0007-0000000000b3', '00000000-0000-0000-0007-000000000001', null, 'baileys', 'disparo', 'x', null, null),
  ('00000000-0000-0000-0007-0000000000b4', '00000000-0000-0000-0007-000000000001', null, 'baileys', 'receptiva', 'x', null, now() - interval '1 day'),
  ('00000000-0000-0000-0007-0000000000b5', '00000000-0000-0000-0007-000000000001', null, 'baileys', 'disparo', null, null, null),
  ('00000000-0000-0000-0007-0000000000b6', '00000000-0000-0000-0007-000000000001', null, 'zapi', 'disparo', 'x', null, null),
  ('00000000-0000-0000-0007-0000000000b7', '00000000-0000-0000-0007-000000000001', null, 'baileys', 'disparo', 'x', now() - interval '2 hours', null),
  ('00000000-0000-0000-0007-0000000000b8', '00000000-0000-0000-0007-000000000001', null, 'baileys', 'disparo', 'x', null, now() + interval '1 day'),
  ('00000000-0000-0000-0008-0000000000b9', '00000000-0000-0000-0008-000000000001', null, 'baileys', 'disparo', 'x', null, null),
  ('00000000-0000-0000-0007-0000000000ba', '00000000-0000-0000-0007-000000000001', now() - interval '1 hour', 'baileys', 'disparo', 'x', null, null);
-- proxy aplicado na sessão atual (o engine carimba proxy_ip_em ao conectar)
update public.chat_instancias set proxy_ip_em = now() where proxy_url_cifrada is not null;
-- Integração: com a migration de saúde (chat_instancias.status default 'desconectada') o ADD COLUMN acima é no-op; a maturação exige destino 'conectada'.
update public.chat_instancias set status = 'conectada' where agente_parceiro_id in ('00000000-0000-0000-0007-000000000001', '00000000-0000-0000-0008-000000000001');

-- b4 já enviou 5 disparos hoje (teto) e 3 ontem (não contam).
insert into public.crm_disparo_fila (campanha_id, agente_parceiro_id, telefone_e164, instancia_id, template_id, status, enviado_em)
select '00000000-0000-0000-0007-0000000000d1', '00000000-0000-0000-0007-000000000001', '+55619000000' || lpad(g::text, 2, '0'),
       '00000000-0000-0000-0007-0000000000b4', '00000000-0000-0000-0007-0000000000d2', 'enviado',
       case when g <= 5 then now() - interval '1 minute' else now() - interval '2 days' end
from generate_series(1, 8) g;
