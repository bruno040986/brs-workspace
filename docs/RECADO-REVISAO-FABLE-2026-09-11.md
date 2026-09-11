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

## 5. Achado lateral

`jsdom` está declarado no `apps/web/package.json`, mas não está
instalado na pasta principal do `brs-alvoconsig`. Por isso o teste de
rolagem (`useRolagemThread.test.ts`) falha lá por ambiente. Não é
regressão; resolve com `npm install`.
