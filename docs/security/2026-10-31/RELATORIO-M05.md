# Relatório M05 — eventos, incidentes, evidências e monitor de configuração

Branch `security/incidente-2026-10-31`. Commits locais `84f1e6fb` (banco + testes SQL) e `e8a7ce61` (TS, cron, painel). Nada publicado, nenhuma migration remota, nenhuma chamada a provedor.

## 1. Desenho versus PT02 §5 (C)
| PT02 | Implementação |
|---|---|
| Estados independentes | Tabelas e máquinas separadas: `seg_incidentes` (aberto/em_analise/contido/encerrado), `seg_diagnosticos_ia` (nao_solicitado/pendente/em_execucao/concluido/indisponivel/adiado/invalido), `seg_notificacao_intencoes`, `seg_notificacao_tentativas`, `seg_recibos`. Nenhuma depende de IA. Adaptação: o PT02 prevê `em_acompanhamento`/`falso_positivo`; usei os estados pedidos na tarefa (aberto/em_analise/contido/encerrado). |
| Persistência antes do efeito | `seg_registrar_evento` grava evento, incidente, vínculo e intenção na mesma transação. `seg_tentativa_preparar` grava a tentativa como `enviando` (com `operation_id`) antes de o M06 chamar o provedor e recusa quem não é dono do lease. |
| Lease/concorrência | `seg_intencao_claim` usa `FOR UPDATE SKIP LOCKED`. Lease vencido com tentativa `enviando` vira `incerta` (nunca volta a pendente, sem reenvio). Lease vencido sem tentativa `enviando` (prova de que nada saiu) volta a `pendente`. `seg_intencao_finish` só vale para o dono com lease válido. |
| Idempotência | `unique(fonte,id_origem)` no evento; `unique(incidente,versao_alerta,destino,tipo)` + `dedupe_key` na intenção; reprocessar o mesmo evento não conta de novo. `seg_recibo_registrar` idempotente e monotônico (aceita < entregue < lida; ausência de recibo nunca rebaixa). |
| Agrupamento | Chave `regra|contexto|bucket da janela` (janela fixa, 10 min). Advisory lock por chave. Limiar por regra (`regra.<r>.limiar`): eventos abaixo do limiar ficam em `seg_evento_classificacoes` e são ligados quando o incidente abre. Escalada de gravidade incrementa `versao_alerta` e cria nova intenção. |
| Cardinalidade | Máx. 50 incidentes distintos por regra por hora (lock por regra); excedente cai em 1 incidente `agregado` ("volume anômalo") com `eventos_suprimidos`. Teto de 200 eventos vinculados por incidente; acima só contagem. |
| Alto/crítico sem esperar IA | Intenção `pendente` criada na hora para alta/crítica. Média/baixa não criam intenção (resumo é do M06). |
| RLS | RLS ligada sem política em todas as tabelas `seg_*`; REVOKE de PUBLIC/anon/authenticated em tabelas, views, sequências e funções; GRANT só `service_role`. Leitura via `seg_v_incidentes`, `seg_v_incidente_eventos`, `seg_v_intencoes`. |

Não implementado (M06/M08): contadores de orçamento atômicos (`contadores_orcamento` do PT02 — os valores estão em `seg_config`, falta a tabela de contagem), renderização de template, envio, IA, resumo periódico, reconciliação manual.

## 2. Arquivos
- `supabase/migrations/20261101040000_security_m05_incidentes.sql` — tudo de banco, idempotente. Funções: `seg_registrar_evento` (L269), `seg_intencao_claim` (L404), `seg_tentativa_preparar`, `seg_intencao_finish`, `seg_recibo_registrar`, `seg_monitor_itens` (L484), `seg_monitor_baseline_definir`, `seg_monitor_snapshot` (L552). Seed do recurso de permissão no fim.
- `supabase/tests/run-m05.sh`, `supabase/tests/security_m05_incidentes.sql`.
- `src/lib/seguranca/{tipos,normalizar,regras,registrar,lacunas}.ts`, `src/lib/seguranca/__tests__/seguranca.test.ts`.
- `src/app/api/cron/seguranca-monitor/route.ts` (CRON_SECRET via `isCronAuthorized`), entrada `*/5` em `vercel.json`.
- Painel: `src/app/(dashboard)/usuarios/seguranca/incidentes/page.tsx` e `[id]/page.tsx` (somente leitura; filtros de gravidade, estado e regra; desvios abertos; lacunas de fonte).
- Linhas únicas em arquivos compartilhados (mesmo padrão do M04): `src/lib/auth/permissions.ts` (rota), `src/lib/nav/divisoes.ts` (menu "Segurança › Incidentes"), `usuarios/page.tsx` (catálogo de recursos), `src/lib/auth/__tests__/gate-lacunas.txt` (cron autentica por segredo).

## 3. Recurso de permissão
`seguranca-incidentes` (can_view). O Workspace não tem tabela de recursos: o recurso existe pela linha em `user_permissions`/`profile_permissions` e pelo catálogo em `usuarios/page.tsx`. A migration concede SOMENTE a `bruno.rodrigues@brspromotora.com.br` (menor privilégio). Demais pessoas: pela tela de Perfis. Se o e-mail não existir em `public.users`, ninguém recebe (nenhum erro).

## 4. Interface para M04 e M06
**M04 (e actions de usuários)**: `import { registrarEventoSeguranca } from '@/lib/seguranca/registrar'`; `await registrarEventoSeguranca({ fonte, tipo, idOrigem?, identidadeInformada?, identidadeValidadaUserId?, requestId?, ipObservado?, userAgentObservado?, payload? })`. Nunca lança; devolve `{ok}`. Tipos com regra: `login.falha` (limiar 5 por identificador, 15 por origem), `login.pausa`/`login.bloqueio` (alta, imediato), `login.concluido` (só gera incidente se fora do expediente em `user_schedules` e com `identidadeValidadaUserId`), `permissao.alterada`/`perfil.alterado` (alta), `fator.desconhecido` (alta), `signup.tentativa` (crítica). Não enviar senha/código no payload (é sanitizado de qualquer forma). Use `idOrigem` estável (ex.: `acessos_log:<id>`) para idempotência. Pontos a ligar (NÃO editados por mim): fim de cada etapa em `src/lib/auth*`/`app/acesso/*`; `saveUserDirectly`/`saveProfile` em `usuarios/actions.ts` (M03-B); `acesso-actions.ts`.
**M06**: `rpc('seg_intencao_claim', {p_owner})` -> para cada intenção, `rpc('seg_tentativa_preparar', {p_intencao, p_owner, p_canal, p_config_ref})` (devolve `operation_id`) -> chamar o canal -> atualizar a tentativa (service_role) -> `rpc('seg_intencao_finish', {p_id, p_owner, p_estado, p_retry_apos})`; recibos por `seg_recibo_registrar`. INC-n só pode ser citado depois do commit (a função já retorna após commit do RPC).

## 5. Valores (todos em `seg_config`, "proposta, não decisão do Bruno")
PT02 §5.6: janela 10 min; resumo 15 min; 50 chaves/regra/h; 200 eventos; orçamento 20/h e 60/dia; WhatsApp 6/h, 20/dia, 10/instância/dia; slot crítico 1/h; IA 1+2, 30/dia, 200 eventos; retomada 5 por 10 min; saúde 30 min. Do executor (sem valor no PT02): limiar 5 falhas/identificador e 15/origem, lease 120 s, tolerância 10 min para conta Auth sem cadastro. Lista de buckets públicos permitidos: `[]` (decisão 4).

## 6. Monitor de configuração
`seg_monitor_snapshot()` lê `pg_policies` (public, storage), ACL de relações via `aclexplode` (em vez de `role_table_grants`, que depende do papel que consulta), `storage.buckets` e `auth.users` sem `public.users`. Sem baseline: modo absoluto (só violações). Com baseline (`seg_monitor_baseline_definir`, que recusa violações sem `true` explícito): novo/alterado/removido. Críticos: policy `{public|anon}`+`true`, grant de escrita a anon sem RLS, bucket público fora da allowlist. Altos: policy `authenticated`+`true` em public, anon lê sem RLS, conta Auth sem cadastro (proxy de signup). Só alta/crítica abre incidente; o resto fica em `seg_monitor_desvios`. Desvio some (`resolvido`) quando a condição some; repetição não realerta.

## 7. Lacunas de fonte (também no painel)
Auth logs (`auth.audit_log_entries`/log drain não coletados: chamadas diretas ao Auth não geram evento); configuração do Auth (signup, provedores, JWT, MFA) não legível pelo banco — só o efeito é detectável; Storage sem log de acesso; PostgREST sem log; tentativa de signup bloqueada não deixa rastro; Portal/CRM/Engine não enviam eventos; o cron roda na mesma Vercel/Supabase (não é monitor independente).

## 8. Testes (resultados reais)
- `supabase/tests/run-m05.sh` (Postgres 17 descartável, base M03-A + M05 aplicada 2x): todas as verificações OK (cerca de 45), incluindo deny-all anon/authenticated em tabelas/views/funções, agrupamento, idempotência, sanitização, limiar, cardinalidade (50 + agregado com 10 suprimidos), teto de eventos, claim/finish/lease expirado (incerta vs pendente), recibos, snapshot detecta policy `{public}/true` criada no teste, bucket público, baseline recusa violação, conta Auth sem cadastro; concorrência com 6 sessões e mesma chave resulta em 1 incidente/6 eventos/1 intenção; 3 claims simultâneos entregam a intenção a um só dono. Saída final: `M05 TUDO OK`.
- `npm test`: 509 testes, 506 pass, 0 fail, 3 skipped (6 novos do M05). `npx tsc --noEmit`: limpo. ESLint nos arquivos novos: limpo. `next build` não rodado (RAM).

## 9. Riscos
- Tabela `seg_eventos` não tem retenção/purge nem teto de armazenamento por volume: inundação de eventos distintos cresce o banco (o teto limita só vínculos). Precisa de job de retenção (decisão pendente).
- Janela fixa: ataque contínuo cruzando a fronteira do bucket abre 2 incidentes (agrupa por 10 min, não deslizante).
- `seg_registrar_evento` executa como service_role em cada login: custo de um RPC por evento; falha é engolida (log), logo falha do banco = evento perdido (sem fila local).
- Primeira execução em produção sem baseline mostrará toda violação existente como incidente: revisar com `seg_monitor_snapshot()` manual e definir baseline com aceite explícito.
- Alteração em `permissions.ts`/`divisoes.ts`/`usuarios/page.tsx`/`gate-lacunas.txt` (arquivos compartilhados com M03/M04): conflito possível no merge, uma linha cada.
- O seed de permissão assume o e-mail do Bruno em `public.users`.

## 10. Rollback
Código: reverter os dois commits. Banco (só se aplicada): `DROP VIEW seg_v_*; DROP TABLE seg_* CASCADE; DROP FUNCTION seg_*; DROP SEQUENCE seg_incidente_numero_seq; DELETE FROM user_permissions WHERE resource_name='seguranca-incidentes'`. Nada fora de `seg_*` foi alterado. Remover a entrada de cron de `vercel.json`.

## 11. Pendências
Ligar os ganchos no M04/M03-B; M06 (dispatcher, orçamento atômico, resumo); retenção de `seg_eventos`; inventário remoto das policies antes da baseline; decisão de horário de expediente e feriados (hoje `user_schedules` sem exceções/feriados); coleta de `auth.audit_log_entries`; monitor independente.

## Correções pós-revisão (2026-11-01, REVISAO-M05.md)
Migration nova `20261101045000_security_m05_complemento.sql` (reaplica 4 funções; a 040000 não foi editada). Testes: `supabase/tests/security_m05_complemento.sql`, chamado por `run-m05.sh`.
- I-1: `seg_monitor_itens` agora lê `pg_proc` (public, SECURITY DEFINER, não-trigger, fora de extensão) com EXECUTE para PUBLIC/anon/authenticated => `funcao`/`alta`; grant a `authenticated` em tabela sem RLS => `alta` (leitura) ou `critica` (escrita).
- I-2: com baseline, desvio novo/alterado de policy/grant/bucket/funcao tem gravidade mínima `alta` (gera incidente e intenção).
- I-3: `identidade_informada` só é gravada se parecer e-mail ou CPF; senão `formato_invalido:<sha256 16 hex>` (TS `normalizar.ts` e SQL, mesmo hash).
- I-4: payload > 16 KB é cortado antes de sanitizar (`{truncado,bytes}`) em TS e em `seg_sanitizar` (nível 0); teste SQL: payload de ~1,6 MB em 0,1 s (antes 7 s para 20 MB).
- I-5: `prefixRouteRules` ganhou `/usuarios/seguranca/incidentes` (teste).
- Menores feitos: M-1 contexto iniciado por `__` é normalizado para `_` (não colide com o agregado); M-8 erro de `user_schedules` logado; M-9 painel avisa "sem baseline"; B-1 `%` no path cru rejeitado e UUID do agente validado antes da consulta.
- Menores só documentados (não feitos): M-2 (classificações do excedente de cardinalidade sem `incidente_id`: guardar contexto original antes da troca), M-3 (ordem dos locks por regra: ordenar classificações), M-4 (`preparada` morto), M-5 (teto de claims/`esgotada`, contrato do M06), M-6 (formato da allowlist de buckets), M-7 (pré-requisito verificar leitura de `storage.buckets`/`auth.users`), M-10 (`profile_permissions` sem uso), M-11 (`idOrigem` obrigatório em `login.*`).
- Resultados reais: `bash supabase/tests/run-m05.sh` => `M05 TUDO OK` (migrações 040000 e 045000 aplicadas 2x; complemento 10 OK); `npm test` 545 testes, 542 pass, 0 fail, 3 skipped; `npx tsc --noEmit` rc=0.

ENTREGUE PARA REVISAO
