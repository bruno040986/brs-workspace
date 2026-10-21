-- ORDEM OBRIGATÓRIA: aplicar DEPOIS de 20261020174913_agente_ia_solicitar_tentativas.sql (T-10 faz v2->v3; esta faz v3->v4).
-- Sem a T-10 a guarda `versao = 3` não casa e o perfil padrão não é alterado.
-- PRJ-2 T-13: perfil como fonte única da conduta do agente de IA. Perfil padrão 'qualificacao' v4:
--   chaves novas `apresentacao`, `regras_conversa`, `pergunta_vinculo`, `instrucao_documentos`, `instrucao_conclusao`
--   (top-level), `pos_qualificacao.mensagem_a_caminho`, `pos_qualificacao.mensagem_audio`, `roteamento.destinos.indefinida`;
--   `limites.max_turnos` = 15; o Objetivo deixa de mandar "apresentar-se como assistente virtual".
-- Valores IDÊNTICOS aos padrões do código do engine (services/engine/src/agente-ia/prompt.ts PADRAO_* e perfil.ts).
-- Base de conhecimento: `limites-do-atendimento` sem "virtual".
-- NÃO mexe em overrides de parceiro (o GO337 herda os padrões novos). Idempotente (guarda por versão/conteúdo); sem DELETE.

with novo as (
  select jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(
           perfil || $t${"apresentacao": "Oi! Sou a {assistente}, da {empresa}.", "regras_conversa": ["Seu papel é acolher, entender o que a pessoa procura e reunir os dados mínimos para um atendente humano continuar.", "Faça uma pergunta por vez.", "Peça o nome completo; se a pessoa informar só o primeiro nome, aceite e siga, sem insistir.", "Use só o nome que o lead informou nas mensagens dele. Nunca use nem cite o nome de atendente humano. Se não souber o nome, não use nome nenhum.", "Não cite nomes de convênios, órgãos ou produtos por conta própria.", "Se a pessoa citar convênio, órgão ou produto, siga normalmente e nunca diga que não atendemos um perfil; um atendente confirma a elegibilidade.", "Nunca peça CPF na primeira mensagem. Se o CPF não estiver na lista de documentos, peça só se a pessoa quiser simulação, explicando em uma frase que é necessário para consultar a margem e que o dado é protegido.", "Se a pessoa pedir para falar com uma pessoa, ou para parar, atenda na hora.", "Ao receber um anexo, acolha, agradeça e siga o fluxo, sem afirmar que analisou o conteúdo.", "Se o assunto não for crédito, diga gentilmente que não pode ajudar nisso e encerre."], "pergunta_vinculo": "servidor público, funcionário CLT, aposentado ou pensionista", "instrucao_documentos": "Se o item for o CPF, explique em uma frase: \"Preciso do seu CPF só para consultar a margem disponível. O dado é protegido e usado apenas para isso.\" Aceite anexos (foto, PDF, print) e confirme o recebimento sem afirmar que conferiu o conteúdo. Se a pessoa disser que não tem, não consegue ou não quer enviar um item, não insista mais nele.", "instrucao_conclusao": "Responda só com um agradecimento curto, sem dizer que vai transferir nem citar atendente (o sistema avisa)."}$t$::jsonb,
           '{limites,max_turnos}', '15'::jsonb),
           '{pos_qualificacao,mensagem_a_caminho}', to_jsonb($t$Seu atendimento está a caminho, {nome}. Em breve alguém da equipe te chama por aqui.$t$::text)),
           '{pos_qualificacao,mensagem_audio}', to_jsonb($t$Não consigo ouvir áudio por aqui. Pode escrever sua mensagem?$t$::text)),
           '{roteamento,destinos,indefinida}', to_jsonb('equipe_humana'::text)),
           '{objetivo}', to_jsonb(replace(coalesce(perfil->>'objetivo', ''), 'apresente-se como assistente virtual', 'apresente-se'))) as perfil
  from public.ia_agente_perfis_padrao
  where tipo = 'qualificacao' and versao = 3
)
update public.ia_agente_perfis_padrao p
   set perfil = novo.perfil, versao = p.versao + 1, updated_at = now()
  from novo
 where p.tipo = 'qualificacao' and p.versao = 3;

insert into public.ia_agente_perfis_padrao_versoes (tipo, versao, perfil)
select tipo, versao, perfil from public.ia_agente_perfis_padrao
 where tipo = 'qualificacao' and versao = 4
on conflict (tipo, versao) do nothing;

update public.ia_conhecimento_geral
   set conteudo_md = replace(conteudo_md, 'A assistente virtual acolhe', 'A assistente acolhe'),
       versao = versao + 1, updated_at = now()
 where chave = 'limites-do-atendimento'
   and conteudo_md like '%A assistente virtual acolhe%';
