-- Fixture para *_chat_instancias_saude.sql (Workspace). COPIAR para
-- brs-alvoconsig/tests/db/saude-instancias-fixture.sql. Roda ANTES da migration;
-- tests/db/saude-instancias.sql roda DEPOIS. Sobre o bootstrap.sql do CRM.
-- O bootstrap tem chat_instancias mínima (id, agente_parceiro_id, deleted_at):
-- aqui entram só as colunas que a migration lê, todas com default/nulas para não
-- quebrar os INSERT posicionais das suítes antigas.
alter table public.chat_instancias
  add column if not exists provedor text not null default 'baileys',
  add column if not exists papel text not null default 'receptiva',
  add column if not exists status text not null default 'desconectada',
  add column if not exists sessao_cifrada text,
  add column if not exists proxy_url_cifrada text,
  add column if not exists pareada_em timestamptz,
  add column if not exists disparo_liberado_em timestamptz,
  add column if not exists created_at timestamptz not null default now();
alter table public.crm_parceiro_config add column if not exists disparo_aquecimento_horas integer not null default 48;

-- chat_instancia_eventos como em produção ANTES da migration (checks inline →
-- nomes padrão _tipo_check/_motivo_check, que a migration dropa e recria).
create table if not exists public.chat_instancia_eventos (
  id uuid primary key default gen_random_uuid(),
  instancia_id uuid not null references public.chat_instancias (id) on delete cascade,
  agente_parceiro_id uuid null,
  tipo text not null check (tipo in ('conexao', 'desconexao_sistema', 'desconexao_externa', 'reconexao', 'liberacao_antecipada', 'numero_divergente', 'restricao', 'banimento', 'status_publicado', 'proxy_configurado', 'proxy_removido', 'proxy_falha', 'proxy_testado')),
  motivo text null check (motivo in ('banimento', 'restricao_meta', 'desconexao_manual', 'desconexao_aparelho', 'mudanca_aparelho', 'mudanca_aplicativo', 'outro')),
  prazo_horas integer null,
  observacao text null,
  numero_detectado text null,
  origem text not null check (origem in ('engine', 'usuario')),
  autor_crm_usuario_id uuid null,
  created_at timestamptz not null default now()
);

-- Perfis globais (mesmos ids do agentes-ia-fixture; não duplica se já existem).
insert into public.crm_perfis values
  ('00000000-0000-0000-0000-0000000000a1', null, 'master'),
  ('00000000-0000-0000-0000-0000000000a2', null, 'operacional')
on conflict do nothing;

-- Parceiro 5 com quarentena de 48 h.
insert into public.agentes_parceiros values ('00000000-0000-0000-0005-000000000001') on conflict do nothing;
insert into public.crm_parceiro_config (agente_parceiro_id, habilitado, disparo_aquecimento_horas)
  values ('00000000-0000-0000-0005-000000000001', true, 48) on conflict do nothing;
insert into public.crm_campanhas_parceiro (id, agente_parceiro_id) values ('00000000-0000-0000-0005-0000000000c1', '00000000-0000-0000-0005-000000000001');
insert into public.crm_templates_mensagem (id) values ('00000000-0000-0000-0005-0000000000e1');

-- Instâncias (sessao_cifrada fictícia: o teste só usa IS NOT NULL)
--  a1 disparo conectada, 1º conexao há 30 h, enviou há 2 h      → pareada -30h, novo, LIBERADA
--  a2 disparo conectada, 401 → conexao há 19 h; depois 403→conexao há 4 h (mesma sessão), sem envio → pareada -19h, não liberada
--  a3 disparo conectada, sem eventos, criada há 10 h, enviou há 1 h → pareada = created_at, LIBERADA
--  a4 disparo conectada, conexao há 100 h, enviou há 50 h       → pareada -100h (fora da janela), não liberada
--  a5 disparo aguardando QR, sem sessão                          → intocada (nula)
--  a6 excluída com sessão                                        → intocada (nula)
--  a7 disparo desconectada, pareada_em já preenchida há 5 h, enviou há 1 h → pareada mantida, origem nula, não liberada (não conectada)
--  a8 disparo conectada, reconexao (QR) há 6 h → conexao há 6 h, enviou há 1 h, liberação antiga (antes do pareamento) → LIBERADA de novo
insert into public.chat_instancias (id, agente_parceiro_id, deleted_at, provedor, papel, status, sessao_cifrada, pareada_em, disparo_liberado_em, created_at) values
  ('00000000-0000-0000-0005-0000000000a1', '00000000-0000-0000-0005-000000000001', null, 'baileys', 'disparo', 'conectada', 'x', null, null, now() - interval '40 hours'),
  ('00000000-0000-0000-0005-0000000000a2', '00000000-0000-0000-0005-000000000001', null, 'baileys', 'disparo', 'conectada', 'x', null, null, now() - interval '300 hours'),
  ('00000000-0000-0000-0005-0000000000a3', '00000000-0000-0000-0005-000000000001', null, 'baileys', 'disparo', 'conectada', 'x', null, null, now() - interval '10 hours'),
  ('00000000-0000-0000-0005-0000000000a4', '00000000-0000-0000-0005-000000000001', null, 'baileys', 'disparo', 'conectada', 'x', null, null, now() - interval '200 hours'),
  ('00000000-0000-0000-0005-0000000000a5', '00000000-0000-0000-0005-000000000001', null, 'baileys', 'disparo', 'aguardando_qr', null, null, null, now() - interval '3 hours'),
  ('00000000-0000-0000-0005-0000000000a6', '00000000-0000-0000-0005-000000000001', now() - interval '1 hour', 'baileys', 'disparo', 'desconectada', 'x', null, null, now() - interval '90 hours'),
  ('00000000-0000-0000-0005-0000000000a7', '00000000-0000-0000-0005-000000000001', null, 'baileys', 'disparo', 'desconectada', 'x', now() - interval '5 hours', null, now() - interval '90 hours'),
  ('00000000-0000-0000-0005-0000000000a8', '00000000-0000-0000-0005-000000000001', null, 'baileys', 'disparo', 'conectada', 'x', null, now() - interval '80 hours', now() - interval '100 hours');

insert into public.chat_instancia_eventos (instancia_id, tipo, motivo, observacao, origem, created_at) values
  ('00000000-0000-0000-0005-0000000000a1', 'conexao', null, null, 'engine', now() - interval '30 hours'),
  ('00000000-0000-0000-0005-0000000000a2', 'conexao', null, null, 'engine', now() - interval '200 hours'),
  ('00000000-0000-0000-0005-0000000000a2', 'desconexao_externa', null, 'Sessão encerrada no aparelho (código 401).', 'engine', now() - interval '20 hours'),
  ('00000000-0000-0000-0005-0000000000a2', 'conexao', null, null, 'engine', now() - interval '19 hours'),
  ('00000000-0000-0000-0005-0000000000a2', 'desconexao_externa', null, 'WhatsApp recusou a conexão 10 vezes seguidas (código 403).', 'engine', now() - interval '5 hours'),
  ('00000000-0000-0000-0005-0000000000a2', 'conexao', null, null, 'engine', now() - interval '4 hours'),
  ('00000000-0000-0000-0005-0000000000a4', 'conexao', null, null, 'engine', now() - interval '100 hours'),
  ('00000000-0000-0000-0005-0000000000a6', 'conexao', null, null, 'engine', now() - interval '2 hours'),
  ('00000000-0000-0000-0005-0000000000a8', 'conexao', null, null, 'engine', now() - interval '90 hours'),
  ('00000000-0000-0000-0005-0000000000a8', 'reconexao', 'restricao_meta', null, 'usuario', now() - interval '6 hours 1 minute'),
  ('00000000-0000-0000-0005-0000000000a8', 'conexao', null, null, 'engine', now() - interval '6 hours');

insert into public.crm_disparo_fila (campanha_id, agente_parceiro_id, telefone_e164, instancia_id, template_id, status, enviado_em) values
  ('00000000-0000-0000-0005-0000000000c1', '00000000-0000-0000-0005-000000000001', '+5561900000001', '00000000-0000-0000-0005-0000000000a1', '00000000-0000-0000-0005-0000000000e1', 'enviado', now() - interval '2 hours'),
  ('00000000-0000-0000-0005-0000000000c1', '00000000-0000-0000-0005-000000000001', '+5561900000002', '00000000-0000-0000-0005-0000000000a3', '00000000-0000-0000-0005-0000000000e1', 'enviado', now() - interval '1 hour'),
  ('00000000-0000-0000-0005-0000000000c1', '00000000-0000-0000-0005-000000000001', '+5561900000003', '00000000-0000-0000-0005-0000000000a4', '00000000-0000-0000-0005-0000000000e1', 'enviado', now() - interval '50 hours'),
  ('00000000-0000-0000-0005-0000000000c1', '00000000-0000-0000-0005-000000000001', '+5561900000004', '00000000-0000-0000-0005-0000000000a7', '00000000-0000-0000-0005-0000000000e1', 'enviado', now() - interval '1 hour'),
  ('00000000-0000-0000-0005-0000000000c1', '00000000-0000-0000-0005-000000000001', '+5561900000005', '00000000-0000-0000-0005-0000000000a8', '00000000-0000-0000-0005-0000000000e1', 'enviado', now() - interval '1 hour'),
  ('00000000-0000-0000-0005-0000000000c1', '00000000-0000-0000-0005-000000000001', '+5561900000006', '00000000-0000-0000-0005-0000000000a2', '00000000-0000-0000-0005-0000000000e1', 'falhou', null);
