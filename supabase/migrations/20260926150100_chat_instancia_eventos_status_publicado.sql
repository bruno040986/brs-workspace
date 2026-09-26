-- B6 (lote 2): publicar status do WhatsApp — cada publicação vira um evento da
-- instância; o engine conta esses eventos para o limite de 3 por dia.
alter table public.chat_instancia_eventos drop constraint if exists chat_instancia_eventos_tipo_check;
alter table public.chat_instancia_eventos
  add constraint chat_instancia_eventos_tipo_check
  check (tipo in ('conexao', 'desconexao_sistema', 'desconexao_externa', 'reconexao', 'liberacao_antecipada', 'numero_divergente', 'restricao', 'banimento', 'status_publicado'));
