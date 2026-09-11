# Recado para o Fable — revisão do que subiu sem revisão em 10/09/2026

Contexto: Astra sem créditos e a cota do Fable acabou no dia 10. O Bruno
autorizou publicar sem revisão e pediu que o Fable revise depois. Tudo
abaixo JÁ ESTÁ EM PRODUÇÃO (engine no Railway, projeto `brs-chat`),
exceto o que estiver marcado como pendente.

## 1. Conexão confiável — `91e364a` (EM PRODUÇÃO)

Sintoma: 2043 (04:59) e 6019 (07:11) caíram com 428, logaram
`reconectando com backoff (attempt 1)` e nunca mais logaram nada.
Ficaram presas em "Conectando" o dia todo.

Causa: `fetchLatestBaileysVersion` usa axios SEM timeout
(`Utils/generics.js:189-207`). Uma promise pendurada fica guardada em
`connecting`, que deduplica tentativas, e toda chamada seguinte (inclusive
o botão "Conectar") recebe a mesma promise morta.

Correção em três camadas (`services/engine/src/baileys.ts`,
`vigia-sessoes.ts`, `index.ts`):
1. `fetchLatestBaileysVersion({ timeout: 10_000 })`
2. `comTeto(conectarInterno(...), 60_000)` em `conectar()`
3. Vigia a cada 2 min: sessão salva + sem socket vivo → `conectar(id, { reiniciar: true })`

Em produção: as 8 instâncias reconectaram, e às 17:40 o vigia reconectou
a 4934 sozinho (primeira ação real dele).

**Pontos para revisar:**
- **Teto de 60s**: foi escolhido com folga, sem medição. Dentro dessa
  janela a chamada ainda é deduplicada. O teste
  `baileys-conexao-presa.test.ts` documenta isso sem esconder.
- **Vigia × backoff**: numa queda em massa, o vigia chama `conectar` com
  `reiniciar: true` enquanto o backoff pode estar agendado. O dedupe
  evita duas tentativas SIMULTÂNEAS, mas não evita uma do vigia seguida
  de uma do backoff. Pode haver uma reconexão redundante. Achei aceitável;
  vale confirmar.
- **Tentativa que estourou o teto continua rodando** em segundo plano. Se
  ela terminar depois de uma tentativa nova, pode abrir um segundo socket?
  `conectarInterno` com `reiniciar` fecha o existente, mas a corrida entre
  a tentativa velha e a nova não está coberta por teste.

## 2. "Aguardando" no celular — investigação FECHADA

Documentos: `ACHADO-CAUSA-ATRASO-LID-2026-09-10.md` e
`RESULTADO-TESTE-LID-2026-09-10.md`.

Resumo: experimento A/B (telefone × LID) em 5 condições. Só uma falhou:
o número comercial do Bruno (`556196863171`), de duas instâncias. O
pessoal dele, no MESMO iPhone, passou limpo com e sem WhatsApp Web.
Conclusão: a sessão Signal do engine para esse contato está
desatualizada. Não é defeito geral do envio por telefone. Nenhuma mudança
de endereçamento foi feita.

A rota temporária do experimento (`ec93a36`) já foi REMOVIDA (`4fe14ce`).

**Pontos para revisar:**
- A conclusão "caso isolado" se apoia em 5 amostras. Concorda que isso
  basta para NÃO mudar o endereçamento de todos os envios?
- Opção pontual NÃO executada: descartar a sessão PN armazenada para
  `556196863171` e deixar o protocolo renegociar. Mexe em estado de
  criptografia em produção. Vale a pena, e qual é o jeito seguro?

## 3. PENDENTE (não publicado): alias LID↔telefone

Worktree `brs-alvoconsig-alias-lid`, commit `eb510a8`. Implementa a
proposta `PROPOSTA-ALIAS-LID-TELEFONE-2026-09-10.md`
(`registrarAliasContato`, best-effort, tolera 42P01, conflito não
sobrescreve). A migration da tabela ficou com o Bruno + Fable.

Com a conclusão do item 2, deixou de ser urgente. Resolve as conversas
duplicadas PN×LID no Chatwoot se elas aparecerem em clientes. Decidir se
segue ou fica parado.

## 4. 500 apagava pareamento saudável — `76eafbc` (EM PRODUÇÃO)

Achado ao conferir o deploy de remoção da rota: a 7033 tinha sumido da
lista de sessões salvas. Log: 10/09 23:47:21, `stream:error` SEM `code`,
com filho `<ack class="message">`. `getErrorCodeFromStreamError`
(Baileys `Utils/generics.js:276`) usa `DisconnectReason.badSession`
(500) como PADRÃO quando falta código e o motivo não está no CODE_MAP. O
engine tratava 500 igual a logout → `salvarSessao(id, null)` → QR
obrigatório.

Histórico nos logs retidos: **a 7033 caiu duas vezes por isso** (10/09
00:09 e 23:47, ambas código 500). A queda de 09/09 15:37 foi 401
legítimo. A primeira ocorrência é a que deixou a 7033 pedindo QR
durante o dia 10, e ela tinha sido atribuída a "lado físico". Não era.

Correção: só 401 apaga credencial; 500 vai para o backoff. Grep no
Baileys: o default é o único emissor de 500. Teste com o payload real
falha no código antigo e passa no novo.

**Ponto para revisar:** se algum dia um 500 vier de sessão realmente
inválida, o engine vai reconectar em loop (com backoff) em vez de pedir
QR. Minha aposta é que o WhatsApp responde 401 nesse caso. Vale
confirmar, e talvez limitar: N quedas 500 seguidas → marcar a instância
para atenção, SEM apagar a credencial.

## 5. Deploy sobreposto gravava "Sessão substituída" em instância viva

Achado 11/09 00:19 (5009): a tela mostrava "Desconectada / Sessão
substituída", mas o socket estava vivo no engine novo (e o celular
mostrava o aparelho conectado). Em todo deploy o container novo conecta
antes de o antigo parar (~8 s; `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS` já é
0, a sobreposição é do ciclo de saúde do Railway). O WhatsApp derruba o
antigo com `conflict type="replaced"` (440), e o antigo gravava
"desconectada" sem condição. Quem gravou por último ganhou:

| instância | antigo gravou | novo gravou | resultado |
|---|---|---|---|
| 1641 | 37,058 s | 37,338 s | ok |
| 2043 | 38,657 s | 38,931 s | ok |
| 2537 | 41,621 s | 41,827 s | ok |
| 5009 | 40,620 s | 40,389 s | **errado (231 ms)** |

Correção: cada socket carimba `conectada_em` ao abrir, e o `close` só
grava (conflito e backoff) via `atualizarInstanciaSeDono`, isto é,
`UPDATE ... WHERE id = ? AND conectada_em = <carimbo dele>`. Processo
substituído não casa linha nenhuma. O teste novo falha no código antigo
exatamente nos 2 casos da corrida.

**Pontos para revisar:**
- A alternativa de raiz é ligar `CHAT_INSTANCE_LEASES`: o novo esperaria
  o antigo liberar e não haveria socket duplo. Não liguei porque muda o
  comportamento de todo deploy (o novo fica sem conectar até a lease
  vencer). Vale decidir.
- A igualdade em `conectada_em` depende do ISO com milissegundos
  sobreviver ao ida-e-volta do `timestamptz`. Deve sobreviver, mas vale
  confirmar.
- O ramo do 401 (logout) continua gravando sem condição, de propósito: a
  credencial morreu para todo mundo.

## 6. Deploy de `6a6c93b` (00:51): 5009 travou no handshake e o vigia recuperou

Resultado da corrida neste deploy (o container que saiu ainda rodava o
código antigo): 1641, 2043 e 2537 ficaram certas, porque o novo gravou
depois. A 5009 **não chegou a disputar**: o container novo abriu o
socket (é o que gerou o "replaced" no antigo às 48,7 s), mas esse socket
nunca emitiu `open` nem `close`. Nenhum log, nenhum erro.

Mecanismo provável (Baileys `Socket/socket.js:499-505`): o `open` só é
emitido DEPOIS de `await uploadPreKeysToServerIfRequired()` e
`await sendPassiveIq('active')`, dentro do handler de `CB:success`. Se um
deles fica pendurado, o servidor já aceitou o login mas o socket nunca
abre, e também não fecha. O teto de 60 s não pega esse caso, porque
`conectar()` resolve quando o socket é CRIADO, não quando ABRE. Não há
handler de `unhandledRejection` e o processo não caiu, então o `await`
ficou pendurado, não rejeitou.

Recuperação: `sessaoAtiva` exige `aberta === true`, então o vigia viu
"sem socket vivo". Passada 1 (00:53:44): travou de novo. Passada 2
(00:55:44): conectou às 00:55:46. Resultado: 8/8 sem intervenção,
em ~4 min.

**Hipótese NÃO provada — credencial gravada pelo container que sai:**
`persist` (`baileys.ts:249`, debounce 400 ms) e `flushAuth` no
encerramento (`:641`, no SIGTERM) gravam `sessao_cifrada` SEM condição
de dono. O container antigo pode sobrescrever as chaves do novo com um
retrato velho, e prekeys inconsistentes explicariam o travamento no
upload de prekeys. Contra a hipótese: a primeira tentativa travou ANTES
de o antigo parar. Não mexi: proteger a gravação de credencial por
"dono" pode perder atualização legítima de chave. A correção de raiz
para as duas corridas (status e credencial) parece ser a lease
(`CHAT_INSTANCE_LEASES`).

**Pontos para revisar:**
- Um prazo de `open` por socket (ex.: 45 s sem `open` → `reiniciar`)
  derrubaria a recuperação de ~4 min para ~1 min. Não implementei:
  o vigia já cobre, e não quis empilhar mais um timer sem revisão.
- Ligar `CHAT_INSTANCE_LEASES`: fecha as duas corridas de deploy, mas
  muda o comportamento de todo deploy. Decisão sua e do Bruno.

## 7. Achado lateral

`jsdom` está declarado no `apps/web/package.json`, mas não está
instalado na pasta principal do `brs-alvoconsig`. Por isso o teste de
rolagem (`useRolagemThread.test.ts`) falha lá por ambiente. Não é
regressão; resolve com `npm install`.
