# Retorno da revisão (Fable) — rodada de conexão do engine, 10-11/09/2026

Revisado: `91e364a` (teto + vigia), `76eafbc` (500 não apaga
pareamento), `6a6c93b` (escrita condicional por carimbo), `4fe14ce`
(remoção da rota de teste), a investigação do "aguardando"
(`RESULTADO-TESTE-LID-2026-09-10.md`) e o alias LID pendente
(`eb510a8`). Lido o código em produção, não só o recado.

## Veredito

O desenho está certo e os quatro commits ficam. Encontrei quatro furos
reais — nenhum era hipotético, cada um tem um teste que fica vermelho
em `main` — e corrigi em `868b8cd`, publicado. Dois fatos do recado
estavam errados e estão corrigidos abaixo.

## O que estava errado e foi corrigido (`868b8cd`)

### 1. O vigia ignorava "reconexão automática desativada"

`listarInstanciasAtivas` devolve toda instância não-apagada — inclusive
as `desconectada` por conflito (device_removed, sessão substituída), que
preservam `sessao_cifrada` de propósito. O vigia reconectava essas a
cada 2 min. Consequências: num `device_removed`, laço infinito de
tentativas com a tela piscando "Conectando… → Dispositivo desvinculado";
num deploy, o container **antigo** (que também roda o vigia) podia dar
um tick dentro da janela de sobreposição, reconectar e derrubar o novo.

Correção: o ramo de conflito marca a instância em processo
(`reconexaoDesativada`); o vigia pula quem está marcado; `conectar`
explícito (botão "Conectar") limpa a marca. Marca em processo e não no
banco porque é o processo que recebeu o conflito que não deve insistir;
um processo novo tenta uma vez na subida, como sempre fez.

### 2. A posse da linha começava tarde demais

`6a6c93b` fechou a corrida "antigo grava DEPOIS do novo" — 1 dos 4 casos
reais. Nos outros 3, o antigo gravou "Sessão substituída" **antes** do
open do novo, e o carimbo ainda era o dele, então a escrita passava; só
"funcionou" porque o open do novo sobrescrevia em seguida. Se o novo
trava antes de abrir (o caso da 5009 às 00:51), a tela ficava em "Sessão
substituída" gravado por um container já morto.

Correção: `conectarInterno` grava `conectada_em: null` junto com
"conectando". A partir daí, qualquer close de socket anterior carrega
carimbo que não casa e é descartado — mesmo chegando antes do open.
A UI não lê `conectada_em`, e a coluna é `timestamptz`, então a
comparação com ISO de milissegundos fecha (conferido na migration
`20260829180000`).

### 3. Credencial gravada sem dono (a hipótese do item 6 do recado)

Confirmada, e é a mais séria. `persist` (debounce de 400 ms) e um
`creds.update` tardio de um socket já substituído, deslogado ou
reiniciado gravavam `sessao_cifrada` sem condição nenhuma. No deploy, o
container que sai podia escrever as chaves velhas por cima das do novo.
Um retrato velho de sessão Signal é exatamente o mecanismo de "contato
que não decifra mais" — plausível que tenha contribuído para o caso do
número comercial do Bruno ao longo de dezenas de deploys.

Correção: trava de persistência por socket. Depois de conflito, logout
(a trava entra **antes** do `salvarSessao(null)`, senão a debounced
pendente ressuscita a credencial morta) ou `desconectar` (depois do
flush final), nada mais daquele socket vai pro banco.

### 4. Tentativa atrasada virava socket zumbi

O teto de 60 s rejeita a promise mas não cancela `conectarInterno`. Se
a rede responde tarde, ele acorda depois de outra tentativa (vigia) já
ter conectado e fazia `sessoes.set` por cima do socket vivo sem
fechá-lo: um socket logado no WhatsApp sem dono, até o protocolo
derrubá-lo com "replaced". Correção: checagem `sessoes.has` sem `await`
antes do `set`, e `lifecycle.begin` movido para depois do último await.

Extra: passadas do vigia não se sobrepõem mais (cada `conectar` tem
teto de 60 s; 8 instâncias fora ultrapassam o intervalo de 2 min).

## Fatos do recado corrigidos

- "O default de `getErrorCodeFromStreamError` é o único emissor de 500":
  não é. `CB:failure` sem `reason` também vira 500 (`socket.js:514`). A
  conclusão de `76eafbc` continua válida — sessão inválida de verdade
  chega como `<failure reason="401">` — mas por essa razão, não por
  unicidade.
- Item 6 (credencial gravada pelo container que sai) foi apresentado
  como hipótese não provada. Está provado pelo código: não havia
  condição nenhuma nas gravações de credencial. Corrigido.

## O que está certo e fica

- Teto de 60 s: não medi alternativa, mas o número não é o que importa —
  o que importa é que a promise termina e o vigia fecha a janela. Fica.
- Vigia × backoff: a reconexão redundante existe, mas o dedupe de
  `connecting` garante que nunca há dois sockets simultâneos. Aceito.
- 500 → backoff: se um 500 vier de sessão realmente inválida, o WhatsApp
  responde 401 na tentativa seguinte e cai no ramo certo. Um laço só
  aconteceria com o servidor respondendo 500 para sempre — não vi isso
  nos logs de dois dias. Não vale código agora; se aparecer, o sintoma
  é "Reconectando (tentativa N)" crescendo sem parar.
- "Aguardando" = caso isolado do número comercial: concordo com a
  conclusão e com a decisão de **não** mudar o endereçamento global.
  Cinco condições, uma falha, sempre o mesmo contato, de duas
  instâncias, com o pessoal do Bruno passando limpo no mesmo aparelho —
  é evidência suficiente para não mexer no envio de todo mundo. O item
  3 acima é a explicação mais provável de COMO aquela sessão ficou
  velha.

## Decisões que ficam com o Bruno

1. **Lease (`CHAT_INSTANCE_LEASES=true`)**: é a solução de raiz para a
   sobreposição de deploy — o novo esperaria o antigo soltar. Hoje
   custaria até 2 min fora do ar por deploy (o novo falha a claim e só o
   vigia tenta de novo). Só vale ligar com uma espera curta pela lease
   na subida (tentar a cada ~5 s por 1 min). Com as correções 1-3, a
   sobreposição ficou inofensiva na prática; recomendo **não** ligar
   agora e revisitar se surgir um caso que essas três não cubram.
2. **Sessão Signal do número comercial**: com a trava do item 3, a
   causa provável de rolagem parou. Não apaguei a sessão desse contato:
   é possível que o próximo pareamento de qualquer instância já
   normalize, e apagar estado Signal em produção sem necessidade é
   risco à toa. Se o "aguardando" persistir depois de uma semana de
   deploys com a trava, aí vale o reset pontual — e eu faço.
3. **Alias LID↔telefone (`eb510a8`)**: parado. Só resolve conversas
   duplicadas PN×LID, e não há evidência de que isso atinge clientes,
   só o contato do Bruno. Sem migration por enquanto.

## Ambiente

`jsdom` está declarado no `apps/web/package.json` e não instalado na
pasta principal do `brs-alvoconsig`: o teste de rolagem não roda ali.
Um `npm install` na principal resolve; não fiz porque mexe na pasta
compartilhada por todas as worktrees enquanto outras sessões podem
estar rodando.
