-- ORDEM OBRIGATÓRIA: aplicar DEPOIS de 20261020153742_agente_ia_roteiro_conversa.sql (T-9 faz v1->v2; esta faz v2->v3).
-- Sem a T-9 a guarda `versao = 2` não casa e nada é alterado.
-- PRJ-2 T-10: o que o agente de IA solicita (documentos/dados), tentativas de confirmação e mensagens fixas
-- de recebimento/transferência. Perfil padrão 'qualificacao' v3: novas chaves `solicitar` (top-level),
-- `limites.tentativas_confirmacao` e `pos_qualificacao.mensagem_documentos`/`mensagem_transferencia`.
-- Override por parceiro = mesmo mecanismo da aba Perfil (crm_agente_perfis.overrides); NÃO mexe em overrides
-- (o GO337 herda o padrão). Idempotente (guarda por versão); sem DELETE.

with novo as (
  select jsonb_set(jsonb_set(jsonb_set(jsonb_set(perfil,
    '{solicitar}', $t$["CPF", "Último contracheque", "Extrato ou print que mostre as margens disponíveis"]$t$::jsonb),
    '{limites,tentativas_confirmacao}', '2'::jsonb),
    '{pos_qualificacao,mensagem_documentos}', to_jsonb($t$Recebi seus documentos, {nome}. Vou conferir a disponibilidade de um atendente.$t$::text)),
    '{pos_qualificacao,mensagem_transferencia}', to_jsonb($t$Pronto, {nome}! Passei o seu atendimento para {atendente}, que já te chama por aqui.$t$::text)) as perfil
  from public.ia_agente_perfis_padrao
  where tipo = 'qualificacao' and versao = 2
)
update public.ia_agente_perfis_padrao p
   set perfil = novo.perfil, versao = p.versao + 1, updated_at = now()
  from novo
 where p.tipo = 'qualificacao' and p.versao = 2;

insert into public.ia_agente_perfis_padrao_versoes (tipo, versao, perfil)
select tipo, versao, perfil from public.ia_agente_perfis_padrao
 where tipo = 'qualificacao' and versao = 3
on conflict (tipo, versao) do nothing;
