-- Proxy por instância Baileys (ProxyADS: HTTP/SOCKS5, usuário/senha).
-- A URL completa (com credencial) fica cifrada (AES-256-GCM, cofre do engine,
-- mesmo padrão de sessao_cifrada/credencial_cifrada); NUNCA é lida pelo navegador.
-- RLS: chat_instancias já tem; coluna nova herda as políticas da tabela.
alter table public.chat_instancias
  add column if not exists proxy_url_cifrada text;

comment on column public.chat_instancias.proxy_url_cifrada is
  'URL do proxy da instância (http/https/socks5/socks5h) cifrada pelo engine. Null = sai pelo IP do servidor. Nunca expor ao cliente.';

-- Eventos de auditoria do proxy (sem credencial; só protocolo, host, porta e resultado).
-- Mesmo padrão da 20260926150100: a tabela já restringe `tipo` por CHECK, então os
-- novos tipos precisam entrar na lista (senão o insert best-effort do engine falha mudo).
alter table public.chat_instancia_eventos drop constraint if exists chat_instancia_eventos_tipo_check;
alter table public.chat_instancia_eventos
  add constraint chat_instancia_eventos_tipo_check
  check (tipo in ('conexao', 'desconexao_sistema', 'desconexao_externa', 'reconexao', 'liberacao_antecipada', 'numero_divergente', 'restricao', 'banimento', 'status_publicado', 'proxy_configurado', 'proxy_removido', 'proxy_falha', 'proxy_testado'));
