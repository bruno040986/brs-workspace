-- Lote 2, correção W1 (27/09/2026): "apagar para todos" precisa de um status terminal.
-- O Workspace já gravava 'revogada' e o CHECK recusava em silêncio; o engine passa a
-- gravar o mesmo valor quando o CONTATO apaga (REVOKE via messages.update).
alter table public.chat_mensagem_status drop constraint if exists chat_mensagem_status_status_check;
alter table public.chat_mensagem_status
  add constraint chat_mensagem_status_status_check
  check (status in ('enviado', 'entregue', 'lido', 'falhou', 'revogada'));
