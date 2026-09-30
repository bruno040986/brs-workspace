-- Roda DEPOIS das migrations 20260930140134/135/136 num banco descartável:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/esteira_migrations_check.sql
-- Executado com sucesso em 30/09/2026 (docker supabase/postgres 17.6 + esqueleto das tabelas dependentes).
-- Checagens das migrations da esteira (fatias 1a/2/3). Roda em transação e
-- dá ROLLBACK no fim: não deixa dado. Falha = RAISE EXCEPTION.
begin;

-- ---------------------------------------------------------------------------
-- Seeds completos
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from public.propostas_status; if n <> 8 then raise exception 'status: esperado 8, veio %', n; end if;
  select count(*) into n from public.propostas_situacoes; if n <> 30 then raise exception 'situacoes: esperado 30, veio %', n; end if;
  select count(*) into n from public.propostas_status where padrao_cadastro; if n <> 1 then raise exception 'padrao_cadastro: esperado 1, veio %', n; end if;
  select count(*) into n from public.propostas_status where pendente; if n <> 1 then raise exception 'pendente: esperado 1, veio %', n; end if;
  select count(*) into n from public.propostas_status where libera_contratos; if n <> 2 then raise exception 'libera_contratos: esperado 2, veio %', n; end if;
  select count(*) into n from public.propostas_status where alerta_observacao; if n <> 2 then raise exception 'alerta_observacao: esperado 2, veio %', n; end if;
  select count(*) into n from public.propostas_esteira_config; if n <> 1 then raise exception 'esteira_config: esperado 1, veio %', n; end if;
  select count(*) into n from public.crm_perfis_permissoes where permissao like 'propostas.%' or permissao = 'config.esteira';
  if n <> 12 then raise exception 'crm_perfis_permissoes: esperado 12 (5+4+2+1), veio %', n; end if;
  raise notice 'OK seeds: 8 status, 30 situacoes, 1 config, 12 chaves de perfil';
end $$;

-- segundo padrao_cadastro é recusado
do $$ begin
  insert into public.propostas_status (nome, grupo, padrao_cadastro) values ('OUTRO PADRAO', 'em_andamento', true);
  raise exception 'FALHA: aceitou 2o padrao_cadastro';
exception when unique_violation then raise notice 'OK unique padrao_cadastro'; end $$;

-- ---------------------------------------------------------------------------
-- Tenant A e B
-- ---------------------------------------------------------------------------
insert into public.agentes_parceiros (id) values ('aaaaaaaa-0000-0000-0000-000000000001'), ('bbbbbbbb-0000-0000-0000-000000000002');
insert into public.crm_usuarios (id, auth_user_id, agente_parceiro_id, nome, email) values
  ('aaaaaaaa-1111-0000-0000-000000000001', 'aaaaaaaa-9999-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'userA', 'a@x'),
  ('bbbbbbbb-1111-0000-0000-000000000002', 'bbbbbbbb-9999-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'userB', 'b@x');
insert into public.crm_parceiro_config (agente_parceiro_id) values ('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.crm_solicitacoes_operacionais (id, agente_parceiro_id, solicitado_por) values
  ('aaaaaaaa-2222-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001'),
  ('bbbbbbbb-2222-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-1111-0000-0000-000000000002');

-- defaults da config por tenant
do $$ declare r record; begin
  select * into r from public.crm_parceiro_config where agente_parceiro_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if r.sla_simulacao_min <> 15 or r.sla_digitacao_min <> 60 or r.trava_min <> 10 or r.dias_sem_atualizacao <> 3 then raise exception 'defaults SLA errados'; end if;
  raise notice 'OK defaults SLA (15/60/10/3)';
end $$;
do $$ begin
  update public.crm_parceiro_config set trava_min = 1; raise exception 'FALHA: trava_min=1 aceito';
exception when check_violation then raise notice 'OK check trava_min'; end $$;

-- ---------------------------------------------------------------------------
-- Proposta manual: constraints
-- ---------------------------------------------------------------------------
-- sem IF nem texto → recusa
do $$ begin
  insert into public.propostas_credito (cpf, origem, agente_parceiro_id, atendente_crm_usuario_id)
  values ('12345678901', 'manual', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001');
  raise exception 'FALHA: aceitou proposta sem IF';
exception when check_violation then raise notice 'OK if_check'; end $$;
-- manual sem atendente → recusa
do $$ begin
  insert into public.propostas_credito (cpf, origem, agente_parceiro_id, instituicao_texto)
  values ('12345678901', 'manual', 'aaaaaaaa-0000-0000-0000-000000000001', 'Banco X');
  raise exception 'FALHA: aceitou manual sem atendente';
exception when check_violation then raise notice 'OK manual_check'; end $$;
-- atendente do tenant B numa proposta do tenant A → recusa (FK composta)
do $$ begin
  insert into public.propostas_credito (cpf, origem, agente_parceiro_id, instituicao_texto, atendente_crm_usuario_id)
  values ('12345678901', 'manual', 'aaaaaaaa-0000-0000-0000-000000000001', 'Banco X', 'bbbbbbbb-1111-0000-0000-000000000002');
  raise exception 'FALHA: aceitou atendente de outro tenant';
exception when foreign_key_violation then raise notice 'OK FK composta atendente x tenant'; end $$;
-- solicitação do tenant B numa proposta do tenant A → recusa
do $$ begin
  insert into public.propostas_credito (cpf, origem, agente_parceiro_id, instituicao_texto, atendente_crm_usuario_id, solicitacao_id)
  values ('12345678901', 'manual', 'aaaaaaaa-0000-0000-0000-000000000001', 'Banco X', 'aaaaaaaa-1111-0000-0000-000000000001', 'bbbbbbbb-2222-0000-0000-000000000002');
  raise exception 'FALHA: aceitou solicitacao de outro tenant';
exception when foreign_key_violation then raise notice 'OK FK composta solicitacao x tenant'; end $$;

-- proposta válida do tenant A (na fila, status padrão)
insert into public.propostas_credito (id, cpf, origem, agente_parceiro_id, instituicao_texto, atendente_crm_usuario_id, solicitacao_id, status_proposta_id, grupo)
select 'aaaaaaaa-3333-0000-0000-000000000001', '12345678901', 'manual', 'aaaaaaaa-0000-0000-0000-000000000001', 'Banco X',
       'aaaaaaaa-1111-0000-0000-000000000001', 'aaaaaaaa-2222-0000-0000-000000000001', s.id, s.grupo
from public.propostas_status s where s.padrao_cadastro;

do $$ declare r record; begin
  select * into r from public.propostas_credito where id = 'aaaaaaaa-3333-0000-0000-000000000001';
  if not r.pendente_normalizacao then raise exception 'pendente_normalizacao deveria ser true'; end if;
  if r.status <> 'criada' then raise exception 'status legado deveria ficar criada'; end if;
  if r.digitada_em is not null then raise exception 'digitada_em deveria ser nulo'; end if;
  raise notice 'OK proposta manual criada (pendente_normalizacao gerado, status legado=criada)';
end $$;

-- 2ª proposta viva pra mesma solicitação → recusa
do $$ begin
  insert into public.propostas_credito (cpf, origem, agente_parceiro_id, instituicao_texto, atendente_crm_usuario_id, solicitacao_id, grupo)
  values ('12345678901', 'manual', 'aaaaaaaa-0000-0000-0000-000000000001', 'Banco X', 'aaaaaaaa-1111-0000-0000-000000000001', 'aaaaaaaa-2222-0000-0000-000000000001', 'em_andamento');
  raise exception 'FALHA: aceitou 2a proposta viva na mesma solicitacao';
exception when unique_violation then raise notice 'OK 1 proposta viva por solicitacao'; end $$;

-- proposta 'api' sem parceiro continua aceita (fluxo FyDigital não regride)
with x as (insert into public.financial_institutions (name) values ('IF API') returning id)
insert into public.propostas_credito (cpf, instituicao_financeira_id) select '12345678901', id from x;
do $$ declare n int; begin
  select count(*) into n from public.propostas_credito where origem = 'api'; if n <> 1 then raise exception 'api: esperado 1'; end if;
  raise notice 'OK proposta origem=api sem tenant aceita';
end $$;

-- ---------------------------------------------------------------------------
-- Filhos: cruzamento de tenant recusado
-- ---------------------------------------------------------------------------
do $$ begin
  insert into public.propostas_eventos (proposta_id, agente_parceiro_id, tipo)
  values ('aaaaaaaa-3333-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'criada');
  raise exception 'FALHA: evento com tenant B numa proposta de A';
exception when foreign_key_violation then raise notice 'OK evento nao cruza tenant'; end $$;
do $$ begin
  insert into public.propostas_eventos (proposta_id, agente_parceiro_id, tipo, autor_crm_usuario_id)
  values ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'comentario', 'bbbbbbbb-1111-0000-0000-000000000002');
  raise exception 'FALHA: autor de B em evento de A';
exception when foreign_key_violation then raise notice 'OK autor do evento nao cruza tenant'; end $$;
insert into public.propostas_eventos (proposta_id, agente_parceiro_id, tipo, autor_crm_usuario_id)
values ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'criada', 'aaaaaaaa-1111-0000-0000-000000000001');

do $$ begin
  insert into public.propostas_documentos (proposta_id, agente_parceiro_id, origem, bucket, storage_path, sha256, nome)
  values ('aaaaaaaa-3333-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'upload', 'parceiro-midias', 'b/x.pdf', repeat('a', 64), 'x.pdf');
  raise exception 'FALHA: documento com tenant B numa proposta de A';
exception when foreign_key_violation then raise notice 'OK documento nao cruza tenant'; end $$;
insert into public.propostas_documentos (proposta_id, agente_parceiro_id, origem, bucket, storage_path, sha256, nome)
values ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'upload', 'parceiro-midias', 'a/x.pdf', repeat('a', 64), 'x.pdf');
do $$ begin
  insert into public.propostas_documentos (proposta_id, agente_parceiro_id, origem, bucket, storage_path, sha256, nome)
  values ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'chat', 'parceiro-midias', 'a/y.pdf', repeat('a', 64), 'y.pdf');
  raise exception 'FALHA: aceitou sha256 duplicado na mesma proposta';
exception when unique_violation then raise notice 'OK dedupe por sha256'; end $$;

-- mudar o tenant da proposta com filhos → bloqueado pela FK
do $$ begin
  update public.propostas_credito set agente_parceiro_id = 'bbbbbbbb-0000-0000-0000-000000000002' where id = 'aaaaaaaa-3333-0000-0000-000000000001';
  raise exception 'FALHA: trocou o tenant de proposta com filhos';
exception when foreign_key_violation then raise notice 'OK tenant da proposta imutavel com filhos'; end $$;

-- ---------------------------------------------------------------------------
-- Grants: eventos append-only para service_role; tabelas fechadas p/ authenticated
-- ---------------------------------------------------------------------------
do $$ begin
  if has_table_privilege('service_role', 'public.propostas_eventos', 'DELETE') then raise exception 'service_role nao devia poder DELETE em eventos'; end if;
  if not has_table_privilege('service_role', 'public.propostas_eventos', 'INSERT') then raise exception 'service_role devia poder INSERT em eventos'; end if;
  if has_table_privilege('authenticated', 'public.propostas_credito', 'SELECT') then raise exception 'authenticated nao devia ter SELECT em propostas_credito'; end if;
  if has_table_privilege('authenticated', 'public.propostas_status', 'SELECT') then raise exception 'authenticated nao devia ter SELECT em propostas_status'; end if;
  if has_table_privilege('anon', 'public.crm_notificacoes', 'SELECT') then raise exception 'anon nao devia ter SELECT em crm_notificacoes'; end if;
  if has_table_privilege('authenticated', 'public.crm_notificacoes', 'INSERT') then raise exception 'authenticated nao devia ter INSERT em crm_notificacoes'; end if;
  raise notice 'OK grants';
end $$;

-- ---------------------------------------------------------------------------
-- RLS de crm_notificacoes: usuário A só vê as suas (auth.uid() simulado via JWT claims)
-- ---------------------------------------------------------------------------
insert into public.crm_notificacoes (agente_parceiro_id, crm_usuario_id, modulo, tipo, entidade_tipo, entidade_id, titulo) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 'digitacoes', 'pendencia', 'proposta', 'aaaaaaaa-3333-0000-0000-000000000001', 'para A'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-1111-0000-0000-000000000002', 'solicitacoes', 'simulacao_respondida', 'solicitacao', 'bbbbbbbb-2222-0000-0000-000000000002', 'para B');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-9999-0000-0000-000000000001","role":"authenticated"}', true);
do $$ declare n int; t text; begin
  select count(*), min(titulo) into n, t from public.crm_notificacoes;
  if n <> 1 or t <> 'para A' then raise exception 'RLS: A deveria ver só a sua (viu % / %)', n, t; end if;
  raise notice 'OK RLS: usuario A ve 1 notificacao (a sua)';
end $$;
do $$ begin
  update public.crm_notificacoes set visto_em = now();
  raise exception 'FALHA: authenticated conseguiu UPDATE em crm_notificacoes';
exception when insufficient_privilege then raise notice 'OK authenticated sem UPDATE (marcarVisto e pela action)'; end $$;
do $$ declare n int; begin
  select count(*) into n from public.propostas_credito;
  raise exception 'FALHA: authenticated leu propostas_credito (%)', n;
exception when insufficient_privilege then raise notice 'OK authenticated nao le propostas_credito'; end $$;

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-9999-0000-0000-000000000002","role":"authenticated"}', true);
do $$ declare n int; t text; begin
  select count(*), min(titulo) into n, t from public.crm_notificacoes;
  if n <> 1 or t <> 'para B' then raise exception 'RLS: B deveria ver só a sua'; end if;
  raise notice 'OK RLS: usuario B ve 1 notificacao (a sua)';
end $$;
-- sem sessão → nada
select set_config('request.jwt.claims', '', true);
do $$ declare n int; begin
  select count(*) into n from public.crm_notificacoes;
  if n <> 0 then raise exception 'RLS: anonimo/sem claims viu %', n; end if;
  raise notice 'OK RLS: sem sessao ve 0';
end $$;
reset role;

-- Realtime: tabela na publicação
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'crm_notificacoes') then
    raise exception 'crm_notificacoes fora da publicacao supabase_realtime'; end if;
  raise notice 'OK publicacao realtime';
end $$;

-- Idempotência: reaplicar as 3 migrations não pode falhar (feito fora, pelo script)
rollback;
