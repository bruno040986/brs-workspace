# Revisão independente — M06 (notificações determinísticas: Telegram → WhatsApp → e-mail)

Revisor: Codex (papel). Somente leitura; nenhum push, deploy, commit ou chamada remota. Commits revisados: `d9ed5123..94ec0df0` (lidos via `git show 94ec0df0:<arquivo>`, ignorando mudanças não commitadas das frentes M04/M05 na mesma worktree). Base: PLANO-MESTRE §7, §8, §8.3, §12 (7–10, 13, 14); DECISÕES 5, 6, 9; PT02 §5; `brs-alvoconsig…/services/engine` e RELATORIO-M03C.

## Veredito

**APROVADO PARA MERGE COM TODOS OS CANAIS DESLIGADOS (estado atual). BLOQUEADO PARA HABILITAR QUALQUER CANAL** até corrigir B1 e, no mínimo, I1 e I2. O desenho central (persistência antes do efeito, lease, operationId derivado, uma instância por vez, incerto não circula, resumo único, anti-recursão) está correto e testado; os problemas são de orçamento (negação de alerta por atacante), de robustez do caminho de produção e de alguns casos de borda da política.

## Resultados reais dos testes (2026-11-01)

| Comando | Resultado |
|---|---|
| `bash supabase/tests/run-m06.sh` | `M06 TUDO OK` (migration aplicada 2x; 31 asserts SQL; concorrência 12 sessões → 5/7/5; 8 sessões → 1 resumo) |
| `npm test` | 546 testes, **543 pass, 0 fail, 3 skipped** (os 2 fails do gate citados no RELATORIO-M06 §6 não ocorrem mais com o estado atual da worktree) |
| `npx tsc --noEmit` | limpo (rc=0) |
| RAM durante a revisão | ≥ 7 GB disponíveis |

Sondas adicionais (script descartável, fora do repositório) confirmaram I5, I6, I8 e M1 abaixo.

## Achados

### BLOQUEANTE

**B1. Orçamento diário sem reserva e compartilhado entre regras: atacante não autenticado cala alertas críticos.**
`supabase/migrations/20261101050000_security_m06_notificacoes.sql:96-101` — o slot crítico (`orcamento.slot_critico_hora`) só é subtraído em `global_hora` e `canal_hora`; `global_dia` (60) e `canal_dia` não têm reserva nem separação por gravidade/regra. Cadeia confirmada no código:
- `src/app/acesso/actions.ts:70-78` (94ec0df0): 3 falhas por **qualquer** identificador (inclusive domínio inválido, `falhaCredencial('dominio_invalido')`) → `auth_registrar_falha` → pausa → `registrarAcesso(resultado:'pausa')`; Turnstile está desligado (decisão 7).
- `src/lib/auth/sessao-interna.ts:82` → `login.pausa`; `src/lib/seguranca/regras.ts:63-66` → `login_reincidencia`, contexto `ident:<hash>`, gravidade **alta**, limiar 1.
- M05 `seg_registrar_evento`: até 50 chaves distintas por regra/hora antes do agregado → até 50 intenções alta/hora; cada uma consome orçamento em `dispatcher.ts:141`.
- Resultado: `global_hora=20` esgota em minutos; `global_dia=60` em ~1 h; a partir daí `signup_tentativa` (crítica) e qualquer alerta de privilégio/MFA ficam `suprimida_orcamento` (terminal, `dispatcher.ts:142`) até a meia-noite. O resumo (§12-14) também não sai, porque `resumoCriar` só roda após aceite no Telegram (`dispatcher.ts:132`), que está igualmente suprimido.
Confirmo o achado da revisão automática. **Correção (mínima e suficiente):**
1. Reservar slot também nos escopos diários: `global_dia − slot_critico_dia` e `canal_dia − slot_critico_dia` para não crítico (nova chave `orcamento.slot_critico_dia`, proposta 5).
2. Novo escopo `regra_dia` (chave = regra do incidente, passar `p_regra` ao RPC) com teto proposto 10/dia, para que uma regra não consuma o orçamento global; alternativamente `gravidade_dia`.
3. Em `regras.ts`, `login_reincidencia` passa a contexto `global` (ou `ip:<hash>`) com janela de 10 min e gravidade `alta` só na primeira ocorrência da janela: 1 notificação por janela, em vez de 1 por identificador. Isso é mudança no M05, mas o M06 não pode ser homologado sem ela.
4. Teste SQL: regra A esgota seu teto e regra B crítica ainda envia; slot diário respeitado.

### IMPORTANTE

**I1. Erro transitório de leitura cancela a intenção permanentemente.** `src/lib/seguranca/dispatcher/producao.ts:23-26` ignora `error` de `seg_v_incidentes` e devolve `null`; `dispatcher.ts:121` então faz `finish('cancelada')`. Uma queda momentânea do PostgREST cancela um alerta crítico sem envio e sem registro de falha. Correção: `if (error) throw new Error('incidente')` (o catch externo registra `falha('processamento')`, o lease vence e a varredura devolve a `pendente`).

**I2. `suprimida_orcamento` é terminal mesmo quando o motivo é um limite horário.** `dispatcher.ts:142`. Um crítico negado por `global_hora`/`incidente_hora` às 10:59 nunca sai às 11:00. Correção: para motivo `*_hora`, `finish('pendente', inicioDaProximaHora)`; terminal só para limites diários/instância. Ajustar `seg_resumo_contar` para não contar duas vezes.

**I3. Ciclo pode exceder `maxDuration`.** `src/app/api/cron/seguranca-dispatcher/route.ts:10` (60 s) com `executarCiclo(limite=5)` sequencial (`dispatcher.ts:181-186`) e timeouts de 8 s (Telegram) + 25 s (engine, `central-conversas/engine.ts:246`) + 10 s (Resend) por intenção: pior caso > 60 s. Corte da função entre `preparar` e `atualizarTentativa` → tentativa `enviando` vira `incerta` (terminal) sem duplicata, mas o alerta se perde e o próximo da fila não é processado. Correção: `limite` 1–2 por ciclo ou orçamento de tempo (parar de reivindicar quando restarem < 40 s), e `maxDuration = 300` se o plano Vercel permitir.

**I4. `OPERATION_CONTENT_CONFLICT` tratado como rejeição comprovada.** `src/lib/central-conversas/engine.ts:193` coloca o código em `REJEICOES_PRE_ENVIO`; `adapters/whatsapp.ts:26` mapeia `EngineErro` → `rejeitada`; `decidir` (`dispatcher.ts:84`) então avança para a instância seguinte com **outro** operationId. O código significa que o ledger já tem essa chave com conteúdo diferente, isto é, houve envio anterior: PM §8.2 manda tratar como incerteza e não gerar ID novo. Hoje é quase inalcançável (a mesma instância nunca é retentada), mas o contrato está invertido. Correção: em `whatsapp.ts`, `codigo === 'OPERATION_CONTENT_CONFLICT'` → `{ tipo: 'incerta', categoria: 'engine_conflito_chave' }`.

**I5. E-mail 429 desiste do último canal.** `adapters/email.ts:26` devolve `limitada`; `decidir` (`dispatcher.ts:96-98`) só reenvia e-mail se `em.length === 0`, então `limitada` cai em `sobra()` → `falhou` + evento `todos_canais_falharam` falso (confirmado por sonda: estado `falhou`, 1 chamada). Correção: para e-mail `limitada`, `aguardar` até `retry_after_ate` com prazo máximo (ex.: 10 min) e uma retentativa; só então `falhou`.

**I6. Telegram desabilitado + WhatsApp habilitado faz do WhatsApp o canal primário.** `dispatcher.ts:147-148` grava `canal_desabilitado` como `rejeitada_comprovada`, e `dispatcher.ts:60` conta isso como contingência: toda intenção alta/crítica sai pelo WhatsApp (confirmado por sonda: `aceita`, 1 chamada WhatsApp, orçamento consumido). Decisão 9: WhatsApp "só após falha do Telegram". Risco operacional na ordem de ligar os canais e consumo de reputação dos números. Correção: se o Telegram estiver **desabilitado** (não configurado), não escalar: `finalizar falhou` com categoria `primario_desabilitado`; escalar apenas em falha de canal habilitado. Ou exigir na tela que WhatsApp só possa ser habilitado com Telegram habilitado.

**I7. Modo durável do engine não verificado (pendência de homologação).** `operationId` só tem efeito se a conta BRS estiver em `ENGINE_DURABLE_ACCOUNT_IDS` (`services/engine/src/durable-policy.ts`, RELATORIO-M03C §8). Fora dele não há ledger: `incerta` não é conciliável e `DELIVERY_UNCERTAIN` nunca é devolvido. O relatório M06 §4.4 registra, mas isso deve ser **condição de habilitação** do canal WhatsApp, não só pendência. Correção: incluir na checklist de ligar o canal; opcionalmente o adapter chamar `GET /instancias/:id/status` e recusar instância cuja conta não é durável (se o engine expuser).

### MENOR

**M1. Dicionário de frases sem `hasOwn`.** `template.ts:38` `FRASES[i.regra]`: regra `constructor`/`toString` (passam no regex SQL `^[a-z0-9_]{1,60}$`) produz "3" / "[object Undefined]" (confirmado). Regra vem só do código, mas a correção é `Object.hasOwn(FRASES, i.regra)`.

**M2. Segredos sem validação de formato na tela.** `usuarios/seguranca/canais/actions.ts:20-27`: `bot_token` (`^\d+:[A-Za-z0-9_-]{30,}$`), `chat_id` (`^-?\d{1,20}$`) e `destino` (`^\d{10,15}$`) aceitam qualquer string ≤ 200; erro só aparece como 400 do provedor → contingência WhatsApp por configuração errada. Cofre, root-only, nunca em claro na tela: **conforme**.

**M3. Estado inconsistente após lease vencido.** `dispatcher.ts:131` ignora o `false` de `finish`; `producao.ts:33-36` faz UPDATE incondicional e pode sobrescrever `incerta` (gravada pela varredura) com `aceita`. Sem duplicata, mas intenção `incerta` com tentativa `aceita`. Correção: `.eq('estado', 'enviando')` no UPDATE; `log` quando `finish` devolver `false`.

**M4. Orçamento consumido antes de `preparar`.** `dispatcher.ts:141-145`: lease perdido entre `consumirOrcamento` e `preparar` gasta cota sem envio (confirmado). Correção: preparar primeiro; se o orçamento negar, atualizar a tentativa para `rejeitada_comprovada/orcamento` (ou consumir dentro de `seg_tentativa_preparar`).

**M5. `after()` disparado por requisição não autenticada.** `registrar.ts:27,39-45`: cada pausa de login (gerada por atacante) roda `rodarDispatcher()` com claim de até 5 intenções. O lease impede duplicidade; o custo é CPU/DB no request. Correção: `limite = 1` no caminho `after()`.

**M6. Relatório desatualizado.** RELATORIO-M06 §6 cita 2 falhas de outra frente; hoje `npm test` está 0 fail.

## Itens verificados sem achado

1. **`decidir`** (`dispatcher.ts:34-99`): 429 respeita `retry_after` e só escala após prazo (120 s crítico / 600 s alto); 403/400/401 → WhatsApp imediato; 5xx 1 retry em 5 s; incerto crítico 90 s → **uma** contingência marcada duplicata, alto não escala; WhatsApp avança só com `rejeitada_comprovada`, aceito/incerto encerram a lista; incerto no WhatsApp escala uma vez ao e-mail só para crítico; todas falham → `falhou` + `todos_canais_falharam` (1/h); resumo só após aceite Telegram. Crash entre aceite externo e gravação: sem reenvio, sem finish, varredura M05 → `incerta` (`seg_intencao_claim` L409-422); teste `§12-13` cobre. Cron concorrente com `after()`: owners distintos, `FOR UPDATE SKIP LOCKED`. Não encontrei caminho que gere 2 envios pelo mesmo canal para a mesma intenção.
2. **operationId** (`dispatcher.ts:18-24`): sha256(intenção|canal|instância|versão) formatado v5; persistido em `seg_tentativa_preparar(…, p_operation_id)` antes do efeito; mesmo valor vai ao engine e como `Idempotency-Key` do Resend; nunca regenerado (a coluna não é UNIQUE, então retentativa na mesma instância reutiliza sem conflito). `DELIVERY_UNCERTAIN`/409 sem código → `EngineEnvioIncertoError` → `incerta` (conforme). Exceção: I4.
3. **Orçamento**: atômico (advisory lock), todos-ou-nenhum, mesma cota global/canal para todas as instâncias (chave `''`), teto por instância/dia, teto WhatsApp/dia vale até para crítico; negado não incrementa (teste SQL e 12 sessões concorrentes). Sem estorno é aceitável. Exceção: B1, I2, M4.
4. **Segredos**: cifrados com `cifrarTexto` (AES-256-GCM, `CRM_CREDENTIALS_KEY`) em `seg_destinos_protegidos` (RLS deny-all, só service_role); tela só root (`permissions.ts`, `requirePermission('sistema-usuarios-root','can_edit')`), mostra só "configurado/falta"; token só na URL da API, nunca em retorno/log (`telegram.ts:25-27`, teste cobre); template sem parse_mode, texto ≤ 4000, HTML escapado no e-mail; só código/gravidade/regra/contagens entram, nenhum IP/UA/identidade/URL de evento; destinos fixos vindos do cofre/config.
5. **Recursão/avalanche**: `seg_dispatcher_falha` → `id_origem` fixo por categoria+hora, gravidade `media` (sem intenção), teste SQL confirma; falha dentro de `falha()` engolida; loop ≤ 10 passos; retries limitados por prazo.
6. **Canais nascem desabilitados** (migration L31-39, teste SQL); desabilitado → `canal_desabilitado`, adapter não chamado, orçamento não consumido (teste Node); Resend com `AbortSignal.timeout(10 s)`; `producao.ts` não é importado por teste; nenhum `fetch` sem `fetchImpl` nos adapters; `npm test` não toca rede.
7. **Ganchos**: `registrarAcesso` (`sessao-interna.ts:101-109`) e `saveProfile`/`saveUserDirectly` (`usuarios/actions.ts:128,451-452`) chamam `registrarEventoSeguranca`, que nunca lança (`registrar.ts:14-33`); payload só `etapa/resultado/motivo` ou ids; `identidade_informada` é campo previsto no M05; `app/acesso/actions.ts` não chama `registrarEventoSeguranca` diretamente → sem duplicação (ponto único).

## Ordem sugerida de correção
B1 (SQL + regras.ts + teste) → I1, I2 (poucas linhas) → I5, I6 → I3 → I4, M1–M5. Nenhum item exige mudar o desenho; todos cabem em um commit de correção com testes nos fakes existentes.
