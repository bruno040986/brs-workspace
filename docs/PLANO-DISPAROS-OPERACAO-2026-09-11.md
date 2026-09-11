# Disparos WhatsApp (Baileys) — estado real e plano de operação (Fable, 11/09/2026)

Pedido do Bruno: "criar campanha, fazer vínculos e associações, confirmar
e começar a disparar seguindo as regras do Astra: rotação de templates,
de números, delay aleatório e disparos entre os números para camuflagem".

## 1. O que JÁ EXISTE e está ligado em produção (conferido no código)

| Etapa | Onde | Estado |
|---|---|---|
| Criar campanha (wizard: filtros → atendentes → disparo → visão de oferta → revisar, com prévia das rodadas) | `apps/web/src/components/crm/campanhas/NovaCampanhaWizard.tsx` | pronto |
| Vincular números e templates, validar 3+3 e composição, 1 campanha ativa por parceiro | `lib/crm/campanhas-actions.ts` (`criarCampanhaParceiro`), `disparo-shared.ts` | pronto |
| Confirmar = criar: a campanha **nasce `ativa`** e a fila inteira (número + template + delay + horário de cada item) é **materializada na criação** | `campanhas-actions.ts:318,368`, `persistirComposicaoDisparo` | pronto |
| Rotação em quadrado latino (`pool[(i + N·(volta%3) + ⌊volta/3⌋) % M]`) e delay por saco sem reposição (60–300 s, nunca repete o anterior) | `lib/crm/disparo.ts` + `disparo.test.ts` (caso canônico 10×30) | pronto e testado |
| Processar a fila: claim com lease (RPC `crm_disparo_claim`, advisory lock por parceiro), envio pela rota do engine com `origem:'disparo'`, conversa fora da Fila até o cliente responder | `apps/web/src/app/api/cron/disparo-whatsapp/route.ts`, **agendado `* * * * *` em `vercel.json`** | ligado |
| Pausar / retomar / encerrar, progresso por status | `campanhas-actions.ts`, `disparo-actions.ts` | pronto |

Conclusão: o fluxo "criar → vincular → confirmar → disparar com rotação e
delay" **existe de ponta a ponta**. O que não consta em lugar nenhum é
uma homologação real com números pareados (pendência desde 05/09).

Nota: o worker do engine (`services/engine/src/disparo-worker.ts`) é uma
segunda implementação da mesma coisa, atrás de `ENGINE_DISPARO_WORKER`
(desligada). Não ligar: com delay mínimo de 60 s o cron por minuto
atende, e duas implementações do mesmo processador é um passivo.

## 2. O que NÃO existe (lacunas objetivas)

1. **"Disparos entre os números" (tráfego técnico)** — pedido explícito.
   O Astra desenhou (`PLANO-IMPLEMENTACAO-ALVOCONSIG-2026-09-05.md` §6,
   `PROPOSTA-SCHEMA-ATENDIMENTO-2026-09-05.md` etapa 6): depois de um
   envio real a um lead, até N números do mesmo parceiro trocam mensagens
   entre si; métrica sempre separada da comercial; exige ≥5 números
   elegíveis; nunca encadeia a partir de resposta técnica; desligado até
   teste real autorizado. A migration existe
   (`crm_disparo_trafego_tecnico`, `trafego_tecnico_habilitado=false`).
   **Zero código** em `apps/web` e `services/engine`. É o maior bloco novo.
2. **Número cai no meio da campanha → lead perdido.** O processador lança
   "Instância de disparo desconectada", o item volta a `pendente` gastando
   uma tentativa; 3 minutos de queda = 3 tentativas = `falhou`. A
   campanha não pausa. (`route.ts:139,175`.)
3. **Itens `incerto` não têm saída.** Falha de rede na chamada ao engine
   marca `incerto` (certo: não reenviar às cegas), mas não há ação de
   conciliação — só a contagem na tela.
4. **Sem janela de horário** (dias/horas permitidos) e **sem opt-out**
   (cliente responde "SAIR"). Não existem no schema nem no código deste
   módulo. Ambos importam para risco de bloqueio do WhatsApp.
5. **Composição travada depois de criada**: não dá para trocar números ou
   templates de campanha ativa (decisão "versionar pool" pendente desde
   05/09). Consequência prática: se um número for desvinculado, a
   campanha precisa ser encerrada e recriada.

## 3. Ordem proposta

### Passo 0 — homologação real (antes de qualquer código novo)
Campanha pequena, leads = números internos (7033, 5009…), 5 números,
15 templates, delay padrão. Observar: fila materializada com a rotação
esperada, envios saindo no horário, conversas nascendo fora da Fila e
entrando quando o "lead" responde, pausar/retomar. Custo: zero código.
É o que separa "existe" de "funciona".

### Passo 1 — proteções operacionais (execução: Sonnet; sem decisão nova)
- **Fail-closed por estado do número**: `status='conectando'` (queda
  transitória, o vigia resolve em ≤3 min) → item volta a `pendente` SEM
  gastar tentativa e com horário +2 min; `status='desconectada'` (precisa
  de humano: QR, conflito) → campanha pausa sozinha com `pausa_motivo`
  ("número X desconectado") e a tela avisa; retomar revalida a
  composição. Mesma filosofia da campanha de voz.
- **Conciliação de `incerto`**: ação na tela do item ("verificar"): se
  existe mensagem espelhada para aquele contato/instância na janela do
  envio → `enviado`; senão → `pendente`. Sem reenvio cego nunca.
- **Banner da tela de instâncias**: o texto mostra "mínimo 2 números e 6
  templates" enquanto o contador mostra 5/5 e 12/15 — duas fontes para o
  mesmo requisito. Unificar em `requisitosDoParceiro`.

### Passo 2 — decisões de produto (Bruno), depois execução Sonnet
- **Janela de envio**: proposta padrão seg–sáb, 08:00–20:00, fuso do
  parceiro; fora da janela o item espera. Configurável em
  `crm_parceiro_config` (migration pequena).
- **Opt-out**: proposta: inbound do lead contendo só "SAIR"/"PARAR"/
  "CANCELAR" (normalizado) → marca o contato, cancela itens pendentes
  desse telefone em qualquer campanha do parceiro, e nunca mais entra em
  materialização. Migration pequena (flag no contato + log).

### Passo 3 — tráfego técnico (arquitetura: Fable; execução: Sonnet)
Desenho em documento próprio quando o Bruno confirmar que quer ligar
agora. Pontos que o desenho precisa fechar: onde roda (proposta: no
mesmo processador da fila, como itens de tipo `tecnico` materializados
junto — assim herda lease, cadência e pausa); como fica fora do
Atendimento (as conversas técnicas não podem virar tickets — precisa de
`origem` própria ou `espelhar:false` + mapa próprio); textos do tráfego
(pool separado, nunca os templates comerciais); métrica separada por
desenho (já no schema); teste real autorizado antes de ligar.

## 4. O que NÃO fazer
- Não ligar `ENGINE_DISPARO_WORKER` (duas implementações concorrentes).
- Não "camuflar" respondendo leads com números próprios para inflar
  métrica comercial — recusado em 03/09 e continua recusado; tráfego
  técnico é outra coisa e tem métrica própria por isso.
- Não mexer no endereçamento de envio (LID) por causa do disparo.
