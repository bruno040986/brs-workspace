-- ---------------------------------------------------------------------------
-- Mídia no chat interno (plano AlvoConsig, seção 7: "foto, figurinhas,
-- áudios, imagens e documentos"). O CHECK de tipo era fechado.
--
-- Convenção do payload (a app valida tamanho/MIME no servidor antes de gravar):
--   { "bucket": "parceiro-midias",
--     "path": "chat-interno/<agente_parceiro_id>/<canal_id>/<uuid>.<ext>",
--     "mime": "...", "nome": "...", "tamanho": 12345 }
-- Bucket reaproveitado (privado, já criado em 20260829150000, URL assinada
-- na leitura) — sem bucket novo. O prefixo por parceiro/canal é o que a app
-- usa pra checar posse antes de assinar a URL; nunca assinar path vindo do
-- navegador sem conferir que ele pertence ao canal que o usuário participa.
-- A policy de SELECT/Realtime de crm_chat_mensagens (crm_chat_membro_do_canal)
-- já cobre os tipos novos — nada muda na autorização.
-- ---------------------------------------------------------------------------
alter table public.crm_chat_mensagens drop constraint if exists crm_chat_mensagens_tipo_check;
alter table public.crm_chat_mensagens add constraint crm_chat_mensagens_tipo_check
  check (tipo in ('texto', 'solicitacao_simulacao', 'oferta_simulada', 'lembrete', 'sistema',
                  'imagem', 'audio', 'documento', 'figurinha'));
