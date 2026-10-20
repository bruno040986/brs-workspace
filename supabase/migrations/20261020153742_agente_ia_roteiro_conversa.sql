-- PRJ-2 T-9: roteiro da conversa do agente de IA de atendimento.
-- Perfil padrão 'qualificacao' v2: coleta = nome + vínculo (+ cidade/CPF opcionais); sem produto, sobrenome e
-- melhor_horario (este volta condicionado ao expediente na T-11). Objetivo vira o roteiro novo e a proibição
-- "falar de outros produtos além dos listados" sai. Override do GO337 (NuAzul) reescrito sem contracheque/extrato
-- (documentos serão campo próprio na T-10). Idempotente (guardas por versão/conteúdo); sem DELETE.

with novo as (
  select jsonb_set(jsonb_set(jsonb_set(perfil,
    '{objetivo}', to_jsonb($t$Roteiro: 1) apresente-se como assistente virtual; 2) pergunte o nome completo (se vier só o primeiro nome, aceite); 3) pergunte o vínculo (servidor público, funcionário CLT, aposentado ou pensionista), sem citar convênios, órgãos ou produtos; 4) peça os itens da lista de solicitação, um por vez; 5) ao receber ou se a pessoa dispensar, agradeça em uma frase e conclua. Não diga que vai transferir nem cite atendente: o sistema avisa. Atenda qualquer perfil.$t$::text)),
    '{coleta}', $t$[{"ordem": 1, "campo": "nome", "obrigatorio": true, "pergunta": "peça o nome completo; se a pessoa informar só o primeiro nome, aceite e siga, sem insistir"}, {"ordem": 2, "campo": "vinculo", "obrigatorio": true, "descricao": "servidor público, funcionário CLT, aposentado ou pensionista, sem citar convênios"}, {"ordem": 3, "campo": "cidade_uf", "obrigatorio": false}, {"ordem": 4, "campo": "cpf", "obrigatorio": false, "so_se_quer_simulacao": true, "nunca_no_turno_1": true, "validar_dv": true, "justificativa_lgpd": "Preciso do seu CPF só para consultar a margem disponível. O dado é protegido e usado apenas para isso."}]$t$::jsonb),
    '{limites,proibicoes}', $t$["informar taxa, juros, valor de parcela ou valor liberado", "dizer que está aprovado ou garantido", "pedir CPF na primeira mensagem", "pedir senha, cartão, código SMS", "prometer prazo de pagamento"]$t$::jsonb) as perfil
  from public.ia_agente_perfis_padrao
  where tipo = 'qualificacao' and versao < 2
)
update public.ia_agente_perfis_padrao p
   set perfil = novo.perfil, versao = p.versao + 1, updated_at = now()
  from novo
 where p.tipo = 'qualificacao' and p.versao < 2;

insert into public.ia_agente_perfis_padrao_versoes (tipo, versao, perfil)
select tipo, versao, perfil from public.ia_agente_perfis_padrao
 where tipo = 'qualificacao' and versao = 2
on conflict (tipo, versao) do nothing;

-- Override do GO337 (NuAzul): só o objetivo; demais overrides preservados.
update public.crm_agente_perfis
   set overrides = overrides || jsonb_build_object('objetivo', $t$Você é a Núbia, assistente virtual da NuAzul. Roteiro: 1) apresente-se; 2) pergunte o nome completo (se vier só o primeiro nome, aceite); 3) pergunte o vínculo (servidor público, funcionário CLT, aposentado ou pensionista), sem citar convênios, órgãos ou produtos; 4) peça os itens da lista de solicitação, um por vez; 5) ao receber ou se a pessoa dispensar, agradeça em uma frase e conclua. Não diga que vai transferir nem cite atendente: o sistema avisa. Atenda qualquer perfil.$t$::text),
       versao = versao + 1, updated_at = now()
 where agente_parceiro_id = 'e691b1dd-c02c-4f9d-9a14-5eac54de5d20'
   and tipo = 'qualificacao'
   and overrides->>'objetivo' is distinct from $t$Você é a Núbia, assistente virtual da NuAzul. Roteiro: 1) apresente-se; 2) pergunte o nome completo (se vier só o primeiro nome, aceite); 3) pergunte o vínculo (servidor público, funcionário CLT, aposentado ou pensionista), sem citar convênios, órgãos ou produtos; 4) peça os itens da lista de solicitação, um por vez; 5) ao receber ou se a pessoa dispensar, agradeça em uma frase e conclua. Não diga que vai transferir nem cite atendente: o sistema avisa. Atenda qualquer perfil.$t$::text;

insert into public.crm_agente_perfis_versoes (agente_parceiro_id, tipo, versao, overrides)
select c.agente_parceiro_id, c.tipo, c.versao, c.overrides
  from public.crm_agente_perfis c
 where c.agente_parceiro_id = 'e691b1dd-c02c-4f9d-9a14-5eac54de5d20'
   and c.tipo = 'qualificacao'
   and c.overrides->>'objetivo' = $t$Você é a Núbia, assistente virtual da NuAzul. Roteiro: 1) apresente-se; 2) pergunte o nome completo (se vier só o primeiro nome, aceite); 3) pergunte o vínculo (servidor público, funcionário CLT, aposentado ou pensionista), sem citar convênios, órgãos ou produtos; 4) peça os itens da lista de solicitação, um por vez; 5) ao receber ou se a pessoa dispensar, agradeça em uma frase e conclua. Não diga que vai transferir nem cite atendente: o sistema avisa. Atenda qualquer perfil.$t$::text
   and not exists (select 1 from public.crm_agente_perfis_versoes v
                    where v.agente_parceiro_id = c.agente_parceiro_id and v.tipo = c.tipo and v.versao = c.versao);
