-- Aquecimento de disparo precisa de "quando este aparelho foi pareado", e
-- `conectada_em` NÃO é isso: o engine reescreve aquele carimbo a cada abertura
-- de socket (é o token de posse usado por `atualizarInstanciaSeDono`), então
-- todo deploy do Railway reconecta as 8 instâncias e zeraria o relógio de
-- aquecimento de todas — travando o disparo por 48 h a cada publicação, e
-- invalidando qualquer liberação manual junto.
--
-- `pareada_em` só muda quando a credencial muda: carimbada no `open` de uma
-- conexão que começou SEM sessão salva (leitura de QR) e zerada quando o 401
-- apaga a credencial. Reconexão com a mesma credencial não mexe.
--
-- Sem backfill de propósito: para as instâncias já pareadas não existe
-- evidência de quando o pareamento ocorreu (o histórico só começa hoje, em
-- chat_instancia_eventos). NULL significa "pareamento desconhecido", e a
-- regra de elegibilidade trata desconhecido como liberado — aquecimento é
-- sinalizador, não bloqueio (decisão do Bruno, 13/09/2026); inventar um
-- bloqueio a partir de dado ausente pararia o disparo de números antigos e
-- saudáveis.
alter table public.chat_instancias
  add column if not exists pareada_em timestamptz null;

comment on column public.chat_instancias.pareada_em is
  'Quando ESTE pareamento (credencial atual) foi criado. Só muda ao ler QR de novo ou ao perder a credencial (401). Base do aquecimento de disparo — nunca usar conectada_em, que é carimbo de posse do socket e muda a cada reconexão.';
