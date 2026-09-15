-- BRS Messenger: atendente padrão por departamento (paridade Digisac).
-- Fecha o ciclo "Departamento padrão" (por instância, já existe em
-- chat_instancias.departamento_id): agora o departamento também pode ter um
-- atendente padrão, usado pelo roteamento automático (atribuirDepartamentosAutomaticos)
-- quando a conversa cai no departamento pela conexão e o CONTATO não tem um
-- atendente padrão próprio (chat_contato_meta.atendente_padrao_chatwoot_id,
-- que continua tendo prioridade).
alter table public.chat_departamentos
  add column if not exists atendente_padrao_chatwoot_id integer null;
