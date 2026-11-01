# Relatório M06 — notificações determinísticas (Telegram, WhatsApp de contingência, e-mail)

Branch `security/incidente-2026-10-31`. Nada publicado: sem push, sem migration remota, sem chamada a Telegram/WhatsApp/engine/Resend/Supabase remotos, sem mensagem real. Todos os canais nascem **desabilitados**.

## 1. Desenho versus PLANO-MESTRE §8 e PT02 §5 (C)
| Requisito | Implementação |
|---|---|
| Template fixo sem IA (§7.1) | `dispatcher/template.ts`: INC-n, gravidade, frase do dicionário por regra, contagem suprimida, linha "Jarvis" (motivo só se informado), orientação ao painel/MCP, controles só se informados. Identidade, IP, user-agent e payload nunca entram; tokens higienizados; e-mail com HTML escapado; Telegram sem `parse_mode`. |
| Telegram primário (§8.2) | `adapters/telegram.ts`: 200+message_id aceita; 429 limitada com `retry_after`; 400/401/403/404 rejeitada permanente; 5xx rejeitada transitória (1 retry após 5 s); timeout/queda/corpo ilegível = incerta. Token só na URL da API, nunca em retorno ou log. |
| Só avança em falha certa ou prazo (§8.2) | `dispatcher.ts` `decidir()` (função pura): 429 aguarda até `retry_after`, crítico > 120 s / alto > 600 s vira UMA contingência; incerto crítico espera 90 s e faz UMA contingência "possível duplicata"; incerto alto não aciona WhatsApp; permanente vai direto. Média/baixa/resumo nunca vão a WhatsApp. |
| WhatsApp uma instância por vez | Lista ordenada; avança só com tentativa anterior `rejeitada_comprovada`; aceita/incerta encerram a lista. `adapters/whatsapp.ts` usa o cliente do engine do Workspace (`engine.enviar`: uma tentativa, `operationId` obrigatório, EngineErro = comprovada, EngineEnvioIncertoError/DELIVERY_UNCERTAIN = incerta). |
| Incerto não circula (§8.2) | Incerta no WhatsApp: crítico escala UMA vez ao e-mail (último canal, marcado duplicata); alto só registra `incerta`. |
| Persistência antes do efeito | `preparar` (RPC `seg_tentativa_preparar` com `operation_id` derivado) antes do adapter; `atualizarTentativa` depois, com 3 tentativas. Falha de gravação após resposta do provedor: sem reenvio e sem finish; lease vence e o claim do M05 marca `incerta` (reconciliação). |
| operationId estável | `sha256(intenção|canal|instância|versão)` formatado como UUID v5-like (`operationIdDerivado`); mesmo valor persistido na tentativa e enviado ao engine/Resend (Idempotency-Key). |
| Orçamento atômico | `seg_orcamento_consumir(canal, incidente, instancia, prioridade)`: advisory lock, verifica todos os escopos (global h/dia, canal h/dia, instância/dia, incidente/h) e incrementa todos ou nenhum. Slot crítico: não-crítico vê limite menos o slot nos limites horários; crítico nunca passa dos tetos diários. Negado vira intenção `suprimida_orcamento`. |
| Resumo único após recuperação | `seg_resumo_pendente()` (contagens desde a marca `resumo.ultimo_em`), `seg_resumo_criar()` (no máximo um resumo por marca, avança a marca na mesma transação, prioridade média), `seg_resumo_dados()`. Chamado só depois de aceite no Telegram. Só contagens; backlog fica no painel. |
| Sem recursão (§8.3) | `seg_dispatcher_falha(categoria)`: evento com `id_origem` fixo por categoria e hora (1/h), gravidade média, que no M05 não cria intenção. Falha dentro de `db.falha` é engolida. |
| Canal desabilitado | Registra tentativa `rejeitada_comprovada` com categoria `canal_desabilitado`, sem chamar adapter e sem consumir orçamento. |
| Todos falham (§12-10) | Intenção `falhou`, evento `todos_canais_falharam` (1/h), nenhuma entrega fictícia. |
| Disparo imediato | `registrar.ts` chama `after()` com `rodarDispatcher()` quando há incidente novo (best-effort, sem IA); cron de 1 min é a rede de segurança. |

## 2. Arquivos
- `supabase/migrations/20261101050000_security_m06_notificacoes.sql`: `seg_canais_config`, `seg_destinos_protegidos`, `seg_orcamento`, funções acima, `seg_tentativa_preparar` (sobrecarga com operation_id), valores em `seg_config` (L46-61), RLS deny-all e EXECUTE só service_role (fechamento no fim).
- `src/lib/seguranca/dispatcher/`: `tipos.ts` (interfaces), `template.ts`, `dispatcher.ts` (`decidir`, `processarIntencao`, `executarCiclo`, `operationIdDerivado`), `adapters/{telegram,whatsapp,email}.ts`, `producao.ts` (fiação real: banco, cofre, engine, `resend_config`; não é importado por testes).
- `src/app/api/cron/seguranca-dispatcher/route.ts` (CRON_SECRET em tempo constante), `vercel.json` (`* * * * *`), `gate-lacunas.txt` (uma linha).
- Ligações pendentes do M05: `src/lib/auth/sessao-interna.ts` (`registrarAcesso` é o sumidouro único de todas as etapas do M04; mapeia falha, pausa, bloqueio, login concluído (etapa e-mail liberada) e fator sem prova; bloqueio administrativo não vira evento) e `src/app/(dashboard)/usuarios/actions.ts` (`saveProfile` = `perfil.alterado`; `saveUserDirectly` = `permissao.alterada` e `perfil.alterado` quando o perfil muda). Em vez de editar cada ponto de `app/acesso/actions.ts`, a ligação ficou no ponto único para não duplicar eventos.
- Tela de configuração: `src/app/(dashboard)/usuarios/seguranca/canais/{page,actions}.ts(x)` (exige `sistema-usuarios-root` can_edit; mostra só "configurado sim/não"; não envia teste), rota em `permissions.ts`.
- Testes: `supabase/tests/{run-m06.sh,security_m06_notificacoes.sql}`, `src/lib/seguranca/dispatcher/__tests__/{dispatcher,adapters}.test.ts` e `fakes.ts`.

## 3. Segredos
Mecanismo reutilizado: cofre AES-256-GCM (`src/lib/central-conversas/cofre.ts`, chave `CRM_CREDENTIALS_KEY`), o mesmo de Z-API, Chatwoot e YCloud. Token do bot, chat_id e telefone de destino vão cifrados para `seg_destinos_protegidos` (nunca em migration, log ou view). Observação: o `resend_config` existente guarda `api_key` em texto puro; o M06 apenas lê (padrão do M04), sem corrigir.

## 4. O que o Bruno precisa preencher
1. Criar o bot e informar token e chat_id em `/usuarios/seguranca/canais` (cifra no cofre), depois marcar Telegram como habilitado.
2. WhatsApp: telefone de destino do alerta (não informado nas decisões); confirmar os ids das instâncias 2 (61 99603-6968) e 3 (61 99955-1641), hoje sem id em `seg_canais_config` (a 1 está mapeada para `5576d3fc-...`); só entram se existirem, forem da conta BRS e o número conferir (últimos 10 dígitos). Habilitar.
3. E-mail: destino semeado como `bruno.rodrigues@brspromotora.com.br`; confirmar `resend_config` ativo e remetente; habilitar.
4. Engine: `operationId` só tem efeito no modo durável da conta BRS (`ENGINE_DURABLE_ACCOUNT_IDS`/`ENGINE_OPERATION_ID_OBRIGATORIO`). Hoje o cliente já exige o UUID; sem modo durável não há dedupe no engine.
5. Confirmar que a barreira do engine (`INSTANCIA_INELEGIVEL`, "receptiva nunca inicia") não bloqueia o destino do Bruno; se bloquear, a decisão é dele (nenhuma exceção foi criada).

## 5. Valores propostos (todos em `seg_config`, "proposta, não decisão do Bruno")
Do PT02 §5.6: global 20/h e 60/dia, WhatsApp 6/h e 20/dia, 10/instância/dia, slot crítico 1/h, 429 crítico 120 s, incerto crítico 90 s, 5xx retry 5 s. Novos do executor, sem valor no PT02: 429 alto 600 s e teto por incidente 8 tentativas externas por hora.

## 6. Testes (resultados reais)
- `supabase/tests/run-m06.sh` (Postgres descartável, base M03-A+M05, migration M06 aplicada 2x): `M06 TUDO OK`. Cobre deny-all, canais desabilitados, nenhum segredo semeado, search_path fixo, limites global, slot crítico, por incidente, por instância e diário do WhatsApp, negado não incrementa, operation_id derivado, não-dono não prepara, falha do dispatcher 1/h sem intenção, resumo (contagens, um só, marca avança). Concorrência: 12 sessões disputando limite 5 = exatamente 5 permitidas, 7 negadas, contador 5; 8 sessões criando resumo = 1.
- Node, dispatcher: 26 testes, 0 falhas (matriz §12 itens 7, 8, 9, 10, 13, 14): Telegram 429/403/5xx/timeout, reserva, primária aceita, incerto, todas falham, desabilitado, orçamento negado, lease perdido, gravação pós-aceite, crash entre preparar e envio, dois workers, resumo, template/escape, adapters com fetch simulado.
- `npm test` completo: 539 testes, 534 pass, 2 fail, 3 skipped. As 2 falhas (`gate-estatico.test.ts`: lista de lacunas e "B1 getUser") vêm de alterações de outra frente (M03/gate) presentes na mesma worktree, não do M06. `npx tsc --noEmit`: limpo. ESLint nos arquivos M06: limpo. `next build` não rodado.

## 7. Lacunas e riscos
- Intenção `incerta` por crash/lease vencido é terminal (regra do M05): não há contingência automática para um alerta crítico perdido no meio do envio; fica visível no painel e entra no próximo resumo. Falta job de reconciliação.
- Falha comum: dispatcher, banco e painel são a mesma Vercel/Supabase; não há monitor independente (PT02 §5.7). Se o banco cair, nada é persistido nem enviado.
- Orçamento é debitado por tentativa externa, sem estorno: três instâncias recusadas consomem três unidades.
- Cron de 1 min mais `after()` pode rodar dispatchers concorrentes; o lease no banco evita duplicidade (testado em SQL e com fake).
- Envio WhatsApp para contato frio passa pela barreira de saúde do engine; instância em quarentena/banida recusa, e o dispatcher segue para a próxima (sem contornar restrição do provedor, apenas ordem autorizada).
- Resend: Idempotency-Key ajuda, mas 5xx/timeout continua `incerta` sem reenvio.
- Telegram sem idempotência: duplicata possível na contingência, declarada na mensagem.
- Não implementado: correções no engine propostas no PT02 §5.5 (token escopado, origem "seguranca"); tela não tem botão de teste (proibido); webhook de recibos WhatsApp/Telegram (recibos só via `seg_recibo_registrar`, sem produtor).
- A migration `20261101045000_security_m05_complemento.sql` (outra frente) precede a M06 na ordem; a M06 só depende do M05 original.

## 8. Rollback
Código: reverter os commits M06 e remover a entrada do cron. Banco (se aplicada): `DROP TABLE seg_canais_config, seg_destinos_protegidos, seg_orcamento; DROP FUNCTION seg_orcamento_consumir, seg_resumo_contar, seg_resumo_pendente, seg_resumo_dados, seg_resumo_criar, seg_dispatcher_falha, seg_tentativa_preparar(uuid,text,text,text,uuid); DELETE FROM seg_config WHERE chave IN ('contingencia.telegram_429_critico_s','contingencia.telegram_429_alto_s','contingencia.telegram_incerto_critico_s','contingencia.telegram_5xx_retry_s','orcamento.incidente_hora','resumo.ultimo_em')`. Desligar sem reverter: `UPDATE seg_canais_config SET habilitado=false`.

## 9. Pendências
Bot/chat_id; ids das instâncias 2 e 3 e destino WhatsApp; modo durável no engine; job de reconciliação de incertas; monitor independente; webhook de recibos; retenção de `seg_orcamento` (limpeza de 3 dias já embutida) e `seg_eventos`; teste real controlado só com autorização do Bruno.

## Correções pós-revisão (2) (2026-11-01, REVISAO-M06.md)
Migration nova `20261101055000_security_m06_complemento.sql` (a 050000 não foi editada); runner `run-m06.sh` aplica as duas, 2x cada.
- B1: `seg_orcamento_consumir` reserva slot crítico também em `global_dia` e `canal_dia` (`orcamento.slot_critico_dia`=5, limitado a 1/3 do teto para tetos pequenos) e ganhou o escopo `regra_dia` (`orcamento.regra_dia`=10/dia; a regra é lida do incidente, assinatura inalterada). `login_reincidencia` agora usa contexto `global` e janela de 10 min: um incidente/alerta por janela, as demais ocorrências entram em `eventos_total` (texto: "N ocorrência(s) nesta janela"). Teste SQL: 60 incidentes de login param em 10 e uma intenção crítica de `signup_tentativa` e um alerta de `permissao_alterada` ainda passam; reserva diária testada. Não precisou alterar `seg_registrar_evento`. Valores numéricos novos são PROPOSTA.
- I1: `producao.ts` lança em erro de leitura do incidente (não vira `cancelada`). I2: negação por limite `*_hora` volta a `pendente` com próxima tentativa na próxima hora cheia (até 6 h de idade; depois `suprimida_orcamento`); limite diário/instância/regra é terminal. A tentativa negada fica `rejeitada_comprovada/orcamento` e `decidir` a ignora.
- I3: `executarCiclo` limite padrão 2 e orçamento de tempo de 40 s (tempo real); caminho `after()` usa 1. `maxDuration` mantido em 60.
- I4: `OPERATION_CONTENT_CONFLICT` => `incerta/engine_conflito_chave` (não avança de instância) + `db.falha('whatsapp_conflito_chave')` para reconciliação.
- I5: e-mail 429 espera `retry_after` (prazo 10 min) e reenvia; só depois `falhou`.
- I6: com Telegram desabilitado/incompleto, alta/crítica NÃO vai ao WhatsApp: só e-mail (se habilitado); sem e-mail fica `pendente` (motivo `canal_primario_desabilitado`, nova checagem a cada 10 min, `falhou` após 24 h). Itens não urgentes mantêm o caminho antigo. Consequência: até o Telegram ser habilitado, o WhatsApp não é usado.
- I7: `EngineWhatsAppAdapter` recebe verificador de modo durável; sem verificação positiva retorna `rejeitada/engine_nao_duravel` e não chama o engine. O engine hoje NÃO expõe o flag (`/status` não traz `durable`), então em produção o WhatsApp fica fechado até o engine expor `durable: true`; é condição de habilitação.
- Menores: M1 `Object.hasOwn(FRASES)`; M3 UPDATE da tentativa só em `preparada/enviando/limitada` (não sobrescreve `incerta`); M4 orçamento depois de `preparar`; M5 eventos `login.falha/pausa/bloqueio` não disparam `after()` (cron cobre) e `after()` usa limite 1. M2 (validação de formato de bot_token/chat_id/destino na tela) e M6 (relatório desatualizado: os 2 fails citados no §6 não ocorrem mais) ficam apenas documentados; a tela de canais não foi alterada.
- Resultados reais: `run-m05.sh` => `M05 TUDO OK`; `run-m06.sh` => `M06 TUDO OK` (12 sessões 5/7/5; 1 resumo); `npm test` 561 testes, 558 pass, 0 fail, 3 skipped; `npx tsc --noEmit` rc=0.

ENTREGUE PARA REVISAO
