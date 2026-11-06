-- APLICADA em produção em 06/11/2026 pelo dono (editor SQL do Supabase; não consta em supabase_migrations). Arquivo preservado para o repositório refletir o banco.
-- Etapa 1 — busca por trecho (pg_trgm) nas listas.
-- Decisão do dono 06/11/2026: instalar já (o volume vai crescer com novos parceiros).
--
-- Extensão no schema `extensions` (padrão Supabase; evita o advisor extension_in_public).
--
-- SEM CONCURRENTLY: migration roda em transação. Hoje é irrelevante (propostas_credito 30 linhas,
-- crm_solicitacoes_operacionais 215, crm_contatos 1.687): o lock SHARE dura milissegundos.
-- ponytail: quando uma tabela passar de ~100 mil linhas, recriar à mão FORA de transação:
--   create index concurrently <nome>_novo on ... ; drop index concurrently <nome>; alter index ... rename
-- (se o concurrently falhar fica INVALID: conferir pg_index.indisvalid e dropar antes de repetir).
--
-- CPF/telefone "sem pontuação": em 06/11/2026 os valores gravados JÁ são só dígitos (cpf: 0 linhas
-- com não dígito nas 3 tabelas; telefone: só '+' na frente em 3 propostas, o que não atrapalha o
-- trecho de dígitos). Por isso o índice é na coluna CRUA e a app normaliza o TERMO (só dígitos).
-- Expressão regexp_replace no índice não serviria: o PostgREST (supabase-js) só filtra coluna ou
-- caminho json, nunca expressão; coluna gerada reescreveria a tabela e quebraria qualquer INSERT
-- que mandasse a coluna. Se alguma origem passar a gravar CPF/telefone formatado, aí sim criar
-- coluna gerada <col>_digitos e índice nela.
--
-- Como a app USA estes índices (o WHERE tem de ser ILIKE '%termo%' sobre a MESMA coluna/caminho):
--   propostas:  .or('nome_cliente.ilike.%x%,id_externo_if.ilike.%x%,numero_contrato.ilike.%x%')
--               .ilike('cpf', '%<digitos>%')   .ilike('telefone_cliente', '%<digitos>%')
--   contatos:   .or('nome.ilike.%x%,email.ilike.%x%')  .or('cpf.ilike.%<dig>%,telefone.ilike.%<dig>%')
--   simulações: .ilike('payload->>nome', '%x%')   .ilike('pessoa->>cpf', '%<digitos>%')
--               (com lead o CPF está no contato: buscar em crm_contatos e filtrar por contato_id)
-- Termo com menos de 3 caracteres não usa trigram (varre a tabela; ok com o volume atual).
-- Sem unaccent: "joao" não acha "João".

create extension if not exists pg_trgm with schema extensions;

-- propostas_credito
create index if not exists propostas_nome_trgm_idx
  on public.propostas_credito using gin (nome_cliente extensions.gin_trgm_ops);
create index if not exists propostas_cpf_trgm_idx
  on public.propostas_credito using gin (cpf extensions.gin_trgm_ops);
create index if not exists propostas_id_externo_trgm_idx
  on public.propostas_credito using gin (id_externo_if extensions.gin_trgm_ops);
create index if not exists propostas_contrato_trgm_idx
  on public.propostas_credito using gin (numero_contrato extensions.gin_trgm_ops);
create index if not exists propostas_telefone_trgm_idx
  on public.propostas_credito using gin (telefone_cliente extensions.gin_trgm_ops);

-- crm_contatos
create index if not exists crm_contatos_nome_trgm_idx
  on public.crm_contatos using gin (nome extensions.gin_trgm_ops);
create index if not exists crm_contatos_cpf_trgm_idx
  on public.crm_contatos using gin (cpf extensions.gin_trgm_ops);
create index if not exists crm_contatos_telefone_trgm_idx
  on public.crm_contatos using gin (telefone extensions.gin_trgm_ops);
create index if not exists crm_contatos_email_trgm_idx
  on public.crm_contatos using gin (email extensions.gin_trgm_ops);

-- crm_solicitacoes_operacionais: índice por EXPRESSÃO no caminho json (o PostgREST gera
-- exatamente "payload"->>'nome' / "pessoa"->>'cpf'). Mais simples e seguro que coluna gerada:
-- não reescreve a tabela e não muda nenhuma escrita. payload.nome existe nas 215 linhas;
-- pessoa.cpf só nas sem lead (169).
create index if not exists crm_solic_payload_nome_trgm_idx
  on public.crm_solicitacoes_operacionais using gin ((payload->>'nome') extensions.gin_trgm_ops);
create index if not exists crm_solic_pessoa_cpf_trgm_idx
  on public.crm_solicitacoes_operacionais using gin ((pessoa->>'cpf') extensions.gin_trgm_ops);
