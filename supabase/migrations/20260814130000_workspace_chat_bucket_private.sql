-- Segurança: torna o bucket de anexos do chat privado. Os anexos passam a ser
-- servidos por URL assinada de curta duração (gerada no GET de mensagens), em vez
-- de URL pública permanente. Anexos antigos continuam acessíveis: o path é extraído
-- da URL pública guardada e assinado sob demanda.

UPDATE storage.buckets SET public = false WHERE id = 'workspace-chat';

notify pgrst, 'reload schema';
