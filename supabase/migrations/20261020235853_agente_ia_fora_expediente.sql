-- ORDEM OBRIGATÓRIA: aplicar DEPOIS de 20261020223847_agente_ia_fila_encerramento.sql (T-14 faz v4->v5; esta faz v5->v6).
-- Sem a T-14 a guarda `versao = 5` não casa e o perfil padrão não é alterado (o engine usa os padrões do código, iguais aos daqui).
-- Independe de 20261020235417_crm_expediente_feriados.sql (cadastro do expediente), mas faz sentido aplicar as duas juntas.
--
-- PRJ-2 T-11 (decisão do Bruno): fora do expediente a IA CONTINUA a conversa e a coleta, pergunta o melhor período do dia
-- (manhã, tarde, noite) e informa o retorno; dentro do expediente não pergunta melhor horário. Texto e conduta vêm do perfil.
-- Perfil padrão 'qualificacao' v6:
--   `fora_expediente_ativo` (true: a IA segue coletando fora do expediente; false = comportamento antigo, só o aviso e espera abrir),
--   `pergunta_melhor_horario` (texto), `instrucao_fora_expediente` (lista),
--   `pos_qualificacao.mensagem_fora_expediente` = texto novo com {horario} (próxima abertura, ex.: "amanhã às 08:00").
-- Valores IDÊNTICOS aos padrões do código do engine (prompt.ts PADRAO_PERGUNTA_MELHOR_HORARIO / PADRAO_INSTRUCAO_FORA_EXPEDIENTE,
-- limites.ts TEXTO_FORA_EXPEDIENTE_PADRAO). NÃO mexe em overrides de parceiro. Idempotente (guarda por versão); sem DELETE.
-- A chave antiga `horario` ({fuso, janela:null}) fica: o engine só a lê como compatibilidade (inicio/fim), e ela vale 24 h.

with novo as (
  select jsonb_set(
           perfil || $t${"fora_expediente_ativo": true, "pergunta_melhor_horario": "Pergunte, no fim da coleta, qual o melhor período do dia (manhã, tarde ou noite) para o atendente falar com a pessoa; informe quando o atendimento humano retorna.", "instrucao_fora_expediente": ["Não prometa horário exato de atendimento; só informe a janela em que o atendimento humano funciona.", "Continue a conversa e peça normalmente os dados e documentos da lista."]}$t$::jsonb,
           '{pos_qualificacao,mensagem_fora_expediente}',
           to_jsonb($t$Nosso atendimento humano retorna {horario}. Já vou adiantando seu atendimento por aqui e a equipe continua com você assim que abrir.$t$::text)) as perfil
  from public.ia_agente_perfis_padrao
  where tipo = 'qualificacao' and versao = 5
)
update public.ia_agente_perfis_padrao p
   set perfil = novo.perfil, versao = p.versao + 1, updated_at = now()
  from novo
 where p.tipo = 'qualificacao' and p.versao = 5;

insert into public.ia_agente_perfis_padrao_versoes (tipo, versao, perfil)
select tipo, versao, perfil from public.ia_agente_perfis_padrao
 where tipo = 'qualificacao' and versao = 6
on conflict (tipo, versao) do nothing;
