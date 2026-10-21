-- GO337 (NuAzul): remove os overrides antigos de pos_qualificacao.mensagem_transferencia e .mensagem_fora_expediente,
-- para valerem os padrões novos. Demais chaves do override intactas; outros parceiros intocados.
-- Idempotente: só atua se alguma das duas chaves ainda existir.
-- ROLLBACK (valores antigos, v12):
--   mensagem_transferencia:    {nome}, vou te encaminhar para {atendente}, que dará continuidade ao seu atendimento e verificará as condições disponíveis para você.
--   mensagem_fora_expediente:  Nosso atendimento humano funciona {horario}. Sua solicitação ficou registrada para a equipe dar continuidade no próximo expediente.
-- (restaurar = overrides || jsonb_build_object('pos_qualificacao.mensagem_transferencia', '...', 'pos_qualificacao.mensagem_fora_expediente', '...'))
with atual as (
  update public.crm_agente_perfis
     set overrides = overrides - 'pos_qualificacao.mensagem_transferencia' - 'pos_qualificacao.mensagem_fora_expediente',
         versao = versao + 1, updated_at = now()
   where agente_parceiro_id = 'e691b1dd-c02c-4f9d-9a14-5eac54de5d20'
     and tipo = 'qualificacao'
     and (overrides ? 'pos_qualificacao.mensagem_transferencia' or overrides ? 'pos_qualificacao.mensagem_fora_expediente')
  returning agente_parceiro_id, tipo, versao, overrides, atualizado_por
)
insert into public.crm_agente_perfis_versoes (agente_parceiro_id, tipo, versao, overrides, atualizado_por, created_at)
select agente_parceiro_id, tipo, versao, overrides, atualizado_por, now() from atual;
