# Proposta de schema — etapa 5 (ferramentas de atendimento externo)

Data: 05/09/2026, sessão Sonnet. Rascunho de SQL para revisão do Fable — nada
aqui foi aplicado. Cobre os itens da seção 5 do
[plano](PLANO-IMPLEMENTACAO-ALVOCONSIG-2026-09-05.md) que não dá pra fechar
com o schema atual do `brs-alvoconsig`/`brs-workspace`. O restante da seção 5
(o que dava pra fazer sem migration) já foi implementado — ver
[handoff](HANDOFF-ALVOCONSIG-2026-09-05.md).

## 1. Disputa de atribuição não é atômica (achado novo, ligado à seção 5)

`atribuirConversa` (`brs-alvoconsig/apps/web/src/lib/crm/atendimento-actions.ts:489`)
lê o assignee atual no Chatwoot, decide a mensagem (assumiu/transferiu) e só
depois escreve — sem trava entre as duas chamadas. Dois atendentes clicando
"assumir" ao mesmo tempo podem os dois ver "✅ atendimento assumido por você",
com o Chatwoot fica com o último que escreveu. Isso é o Chatwoot (sistema
externo) quem guarda o assignee, então uma trava no nosso Postgres não torna a
escrita no Chatwoot atômica por si só — mas serializa as CHAMADAS que fazem
essa escrita, o que já elimina a janela de corrida na prática (só uma
`atribuirConversa` por conversa roda por vez; a segunda vê o resultado da
primeira antes de decidir o que fazer).

```sql
alter table public.chat_conversas
  add column atribuicao_lock_por uuid null references public.crm_usuarios(id),
  add column atribuicao_lock_expira timestamptz null;

-- Reivindicação atômica (uma única UPDATE): quem não conseguir, sabe na hora
-- que outro atendente está processando a mesma transferência.
create function public.chat_conversa_atribuicao_lock(p_id uuid, p_usuario uuid, p_segundos integer default 15)
returns boolean language sql security definer set search_path = '' as $$
  update public.chat_conversas set atribuicao_lock_por = p_usuario,
    atribuicao_lock_expira = clock_timestamp() + make_interval(secs => greatest(5, least(p_segundos, 60)))
  where id = p_id and (atribuicao_lock_por is null or atribuicao_lock_expira < clock_timestamp())
  returning true;
$$;

create function public.chat_conversa_atribuicao_liberar(p_id uuid, p_usuario uuid)
returns void language sql security definer set search_path = '' as $$
  update public.chat_conversas set atribuicao_lock_por = null, atribuicao_lock_expira = null
  where id = p_id and atribuicao_lock_por = p_usuario;
$$;

revoke all on function public.chat_conversa_atribuicao_lock(uuid,uuid,integer), public.chat_conversa_atribuicao_liberar(uuid,uuid) from public,anon,authenticated;
grant execute on function public.chat_conversa_atribuicao_lock(uuid,uuid,integer), public.chat_conversa_atribuicao_liberar(uuid,uuid) to service_role;
```

**Uso em `atribuirConversa`:** reivindicar o lock antes de `obterConversa`; se
`false`, devolver "Outro atendente está processando esta conversa agora,
tente de novo em instantes." (não é erro, é "tente já já"); liberar em
`finally` (sucesso ou falha) pra não travar a conversa se algo no meio
explodir.

**Aceite:** duas chamadas simultâneas pra assumir a mesma conversa — só uma
"ganha"; a outra recebe a mensagem de disputa, não uma falsa confirmação.

## 2. Tags por conversa (seção 5, ainda não existe)

```sql
create table public.crm_tags (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros(id),
  nome text not null,
  cor text not null default '#94a3b8',
  created_at timestamptz not null default now(),
  unique(agente_parceiro_id, nome)
);
create table public.chat_conversa_tags (
  conversa_id uuid not null references public.chat_conversas(id) on delete cascade,
  tag_id uuid not null references public.crm_tags(id) on delete cascade,
  criado_por uuid null references public.crm_usuarios(id),
  created_at timestamptz not null default now(),
  primary key(conversa_id, tag_id)
);
alter table public.crm_tags enable row level security;
alter table public.chat_conversa_tags enable row level security;
revoke all on public.crm_tags, public.chat_conversa_tags from public, anon, authenticated;
grant select, insert, update, delete on public.crm_tags, public.chat_conversa_tags to service_role;
```

Segue o padrão já usado nas tabelas de atendimento (RLS ligado, zero policy —
tudo servido por Server Action/service role com filtro de parceiro na app;
comentário original em `20260830090000_crm_atendimento.sql`).

**Aceite:** criar/editar/excluir tag do parceiro; aplicar/remover tag numa
conversa; tag de um parceiro nunca aparece pra outro.

## 3. Agendamento individual persistente (seção 5, distinto do disparo em massa)

Mensagem agendada pra UMA conversa (não confundir com `crm_disparo_fila`, que
é campanha). Mesmo padrão de lease/claim que acabou de entrar em produção pra
disparo (`crm_disparo_claim`/`finish`, migration `crm_disparo_duravel`) —
reaproveitar o desenho, não a tabela, já que os campos são bem diferentes.

```sql
create table public.chat_mensagens_agendadas (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros(id),
  chatwoot_conversation_id integer not null,
  instancia_id uuid not null references public.chat_instancias(id),
  criado_por uuid not null references public.crm_usuarios(id),
  telefone_e164 text not null,
  texto text,
  midia jsonb,
  agendado_para timestamptz not null,
  status text not null default 'pendente' check(status in ('pendente','enviado','cancelado','falhou','incerto')),
  lease_token uuid,
  lease_until timestamptz,
  ultimo_erro text,
  enviado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index chat_mensagens_agendadas_pendentes_idx on public.chat_mensagens_agendadas (agendado_para) where status = 'pendente';
alter table public.chat_mensagens_agendadas enable row level security;
revoke all on public.chat_mensagens_agendadas from public, anon, authenticated;
grant select, insert, update on public.chat_mensagens_agendadas to service_role;

-- claim/finish: mesmo contrato de crm_disparo_claim/finish (lease vencida
-- nunca volta sozinha se sends_external; ver 20260905013755_crm_disparo_duravel.sql).
```

**Por que precisa de tabela (não dá pra fazer só no cliente):** "revalidar
acesso, alocação e disponibilidade da instância no horário de envio" (plano,
seção 5) exige um WORKER rodando no horário agendado, não só o navegador
aberto — se o atendente fechar a aba, a mensagem tem que sair mesmo assim.

**Aceite:** agendar, cancelar, reagendar; revalidação no envio rejeita se a
instância caiu ou o atendente perdeu acesso à conversa entre o agendamento e o
disparo; reinício do worker não perde nem duplica.

## Itens que NÃO precisam de schema (backlog pra próxima sessão Sonnet)

- **Rascunho por conversa/usuário**: dá pra fazer só com `localStorage`
  (perda ao trocar de aparelho é aceitável pra rascunho). Não comecei porque
  `ConversaCentro.tsx` tem dois `<textarea>` controlados pelo mesmo estado
  `texto` em pontos diferentes do JSX (around linhas 404 e 608) e eu não tinha
  certeza de QUAL fluxo cada um atende sem ver a tela rodando — investigar
  isso antes de mexer.
- **Responder mensagem citada + ver contexto da citação**: `enviarMensagem`
  do engine já aceita `atributos` (`content_attributes`) livre — Chatwoot
  aceita `in_reply_to` nesse campo nativamente. Provavelmente dá pra fazer
  sem schema novo, só wiring (UI pra escolher a mensagem, engine repassar o
  atributo, render mostrar o preview da citada). Não tentei por ser
  transversal (CRM + engine) e eu não ter como validar visualmente o resultado.
- **Pesquisar mensagens**: Chatwoot tem endpoint de busca
  (`GET /api/v1/accounts/{id}/search?q=`) — dá pra expor como mais um
  `resource` em `/api/crm/atendimento`, mesmo padrão do que já existe.
- **Galeria de arquivos/imagens/documentos**: sem endpoint dedicado no
  Chatwoot; teria que agregar anexos das mensagens já paginadas. Sem schema
  novo, mas pode ficar lento em conversas muito longas sem um índice —
  medir antes de decidir se precisa de tabela própria.
- **Ordenar fila por espera (maior/menor)**: a API de conversas do Chatwoot já
  devolve `waiting_since` no payload (não lido hoje —
  `ChatwootConversa` em `lib/chat/chatwoot.ts:237` não declara o campo, mas ele
  vem no JSON). Dá pra tentar ler e ordenar por ele sem migration; falta
  confirmar ao vivo se o Chatwoot desta instalação realmente zera esse campo
  só com resposta humana (não com o eco do próprio disparo) antes de confiar
  nele pro "não contar mensagem técnica".
- **Sidebar recolhível + navegação por teclado + estados vazio/carregamento/
  erro**: não achei nenhum recolhimento de sidebar hoje no atendimento
  (`FilaConversas.tsx`/`AtendimentoShell.tsx`). É trabalho de UI puro, mas é
  a tela mais usada do CRM — melhor fazer com o navegador aberto do que às
  cegas; não tentei nesta sessão.
