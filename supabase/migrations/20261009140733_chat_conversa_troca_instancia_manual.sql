-- Troca manual de instância pelo Master (CRM Alvo Consig): a troca vira um
-- checkpoint na timeline da conversa. Acrescenta o autor (crm_usuarios) ao
-- checkpoint, o motivo 'troca_manual' e a permissão atendimento.trocar_instancia
-- (só o perfil global master). Idempotente.

alter table public.chat_conversa_checkpoints
  add column if not exists autor_crm_usuario_id uuid null references public.crm_usuarios (id);

-- check inline da criação da tabela: nome padrão do Postgres
alter table public.chat_conversa_checkpoints
  drop constraint if exists chat_conversa_checkpoints_motivo_check;
alter table public.chat_conversa_checkpoints
  add constraint chat_conversa_checkpoints_motivo_check
  check (motivo in ('troca_instancia', 'reatribuicao', 'outro', 'troca_manual'));

insert into public.crm_perfis_permissoes (perfil_id, permissao)
select p.id, 'atendimento.trocar_instancia'
from public.crm_perfis p
where p.agente_parceiro_id is null and p.chave = 'master'
on conflict do nothing;

notify pgrst, 'reload schema';
