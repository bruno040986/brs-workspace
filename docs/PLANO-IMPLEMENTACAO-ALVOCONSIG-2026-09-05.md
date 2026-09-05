# Plano de implementação — CRM AlvoConsig

Data: 05/09/2026. Proposta para aprovação do Bruno. Preparação local já autorizada; mudanças funcionais aguardam o OK deste plano. Validação com números e contatos reais fica expressamente para depois, quando Bruno estiver disponível.

## Resultado pretendido e ordem

Entregar atendimento WhatsApp rápido, com mensagens recuperáveis, histórico próprio por tenant e cliente, anexos preservados e continuidade ao trocar instância. A ordem é: ambiente e proteção; persistência e filas; experiência do atendimento; disparos; painéis operacionais; chat interno. Telefonia, discadora, IA de voz, URA e configuração de scripts ficam fora desta execução, salvo preservar compatibilidade das interfaces compartilhadas.

A aprovação deste plano autoriza implementar e testar essas etapas localmente, em branches de trabalho, atualizar documentação e preparar migrations e procedimento de implantação. Não autoriza publicar, aplicar SQL em produção, importar conversas reais, contratar infraestrutura ou enviar mensagens reais. Não há prazo prometido para concluir todo o escopo em uma noite.

## 1. Ambiente reproduzível e referência inicial

- Preservar alterações existentes e criar branches próprias nos repositórios afetados. CRM concentra frontend e engine; Workspace concentra migrations e contratos compartilhados; Portal só muda se um contrato comprovadamente exigir.
- Preparar configuração de homologação local com projeto, volumes e portas próprios. Não usar dados nem alterar a stack Docker `bem-varejo` que já está ativa.
- Usar dois tenants fictícios, master/operacional/dois atendentes, leads distintos e um telefone conflitante. Criar histórico com muitas páginas e anexos sintéticos.
- Resolver as tabelas base ausentes nas migrations antes de considerar o banco reproduzível. Priorizar definição de schema disponível no código/documentação; se for indispensável obter schema remoto, fazer somente leitura de estrutura, sem copiar registros, e registrar as lacunas.
- Configurações de teste falham ao encontrar destino de produção. Credenciais e números reais não entram em fixtures, logs, commits ou prompts de executores. Workers locais ficam limitados a provedores simulados.
- Preparar testes unitários/integração e navegador, medir a tela atual em condições reproduzíveis e registrar erros preexistentes. Ler os guias da versão instalada do Next antes das alterações.

**Aceite:** inicialização documentada; nenhum tráfego de teste para números/clientes reais; testes usam banco separado; baseline de tipos/build e carregamento registrado. Integração simulada deve estar identificada no relatório, sem ser apresentada como homologação do provedor.

## 2. Segurança e integridade antes de ampliar funcionalidades

- Centralizar autorização de conversa, mensagem, anexo e operação: tenant, perfil, permissões e atribuição. Aplicar na API/action e no banco onde houver acesso direto ou Realtime.
- Corrigir resolução de anexos pelo servidor, validação de origem e redirecionamento, limite de leitura e encaminhamento de credenciais. URLs arbitrárias fornecidas pelo navegador não recebem token técnico.
- Corrigir autenticação dos crons para negar execução se o segredo obrigatório não estiver configurado.
- Corrigir reprovação WeSales em uma atualização atômica e verificar erros antes de marcar evento processado.
- Não associar automaticamente dois CPFs pelo mesmo telefone. Conflito gera pendência de reconciliação, sem sobrescrever identidade ou dados de outro cliente.

**Arquivos principais:** `apps/web/src/lib/chat/actions.ts`, `chatwoot.ts`; `lib/crm/atendimento-actions.ts`, `atendimento-shared.ts`; `app/api/wesales/webhook/route.ts`; `app/api/cron/wesales-queue/route.ts`; policies nas migrations do Workspace.

**Aceite:** chamadas diretas de atendente sem atribuição/permissão, outro tenant e usuário revogado são negadas; anexos válidos continuam acessíveis; origem maliciosa não recebe credencial; conflito de telefone não funde pessoas; erro de persistência deixa evento recuperável.

## 3. Histórico próprio e continuidade de atendimento

### Contratos de dados propostos

Os nomes finais das tabelas serão ajustados às convenções existentes; as responsabilidades abaixo são o contrato da implementação.

| Entidade | Responsabilidade e invariantes |
|---|---|
| Pessoa estável | Identidade independente da cópia temporária de campanha; CPF normalizado e vínculo WeSales reconciliado; identificador global nunca concede acesso por si só |
| Relacionamento tenant–pessoa | Alocação, visibilidade, condição de cliente de carteira e referências comerciais; único por tenant/pessoa; carteira não depende de campanha ativa |
| Conversa | Timeline lógica pertencente ao tenant e à pessoa; conversa receptiva ainda não identificada pode existir provisoriamente e ser associada depois de validação |
| Episódio de atendimento | Abertura, responsável, transferências, encerramento, tabulação e horários; preserva o histórico de cada atendimento |
| Vínculo de canal | Instância/inbox, início/fim, motivo e responsável pela troca; vários vínculos sucessivos na mesma timeline |
| Mensagem | ID interno, IDs externos, direção, conteúdo, origem, episódio, canal e estados; identidade externa única no escopo do provedor/conta/instância |
| Anexo | Objeto privado de storage, tamanho/tipo, integridade e referência à mensagem/tenant; estado de preservação ou falha explícito |
| Evento durável / intenção de envio | Recebimento, processamento, tentativas e correlação; exclusividade e recuperação persistentes |

- O Chatwoot permanece como integração durante a transição; o CRM passa a guardar o histórico necessário para sobreviver à perda de uma instância. A tela terá uma fonte de leitura definida por configuração, evitando duas fontes conflitantes.
- Não reescrever a instância ou o atendente original das mensagens ao transferir. Registrar checkpoints visíveis na timeline.
- Troca de instância inicialmente manual, com verificação de disponibilidade e autorização. Automação de troca fica desativada até validar as regras em operação. Resposta tardia no número anterior deve chegar à timeline correta.
- Ao trocar o número, a continuidade é no CRM; a interface do cliente no WhatsApp recebe o contato do novo número. Resposta citada entre canais usa referência textual quando o provedor não consegue representar a citação nativa.
- Desalocação revoga visibilidade do tenant para o lead comum e preserva seu histórico reservado. Nova alocação ao mesmo tenant restaura apenas o histórico daquele tenant. Outro tenant nunca herda conversas anteriores.
- Concretização promove o relacionamento para carteira persistente do tenant. Desalocação da campanha não remove esse cliente nem seus anexos e ofertas. Exportação Excel respeita tenant/permissão e inclui os dados da carteira; histórico permanece consultável no CRM.
- Remover dependência destrutiva do histórico em relação a `crm_contatos` temporários. Revisar cascatas e expurgo antes de preparar a migração. A retenção deixa de ser comandada pela exclusão da cópia de campanha; exclusões explícitas futuras precisam de fluxo próprio.
- Preservar mídia recebida e enviada em storage próprio com acesso autorizado e URLs temporárias. Falha no download vira pendência recuperável, sem afirmar que o arquivo está seguro antes de confirmar a cópia.

### Transição e reversão

- Migrations inicialmente aditivas, índices e constraints por tenant; sem apagar colunas/tabelas antigas na primeira entrega.
- Preparar importador por tenant, paginado, retomável e idempotente, com modo de conferência, contagens e relatório de vínculos ambíguos. Executar somente com fixtures nesta etapa.
- Versionar transformação e conferência de IDs. Não agrupar automaticamente contatos apenas pelo telefone.
- Preparar ativação gradual por tenant e um único caminho ativo de envio. Reverter a UI não pode produzir envio duplicado nem tornar invisíveis mensagens já gravadas no caminho novo; o procedimento precisa incluir compatibilidade de leitura e conciliação.
- Preparar procedimento de backup e ensaiar restauração no ambiente local. Backup de produção e importação real ficam para implantação aprovada.

**Aceite:** trocar instância A→B→A mantém timeline e anexos; revogar/reconceder alocação oculta/restaura histórico correto; carteira persiste; expurgo de campanha não apaga histórico; importar fixtures duas vezes não duplica; restauração local recupera mensagens e referências de mídia.

## 4. Mensageria confiável e leitura rápida

- Persistir webhook autenticado e deduplicado antes de confirmar recebimento. Processar com worker, lease vencível, novas tentativas graduais e fila de erros consultável.
- Persistir intenção de envio e chave de idempotência; mapear IDs CRM/Chatwoot/provedor. Separar pendente, aceito, enviado, entregue, lido, falhou e resultado incerto, usando apenas estados que o provedor comprova.
- Timeout após possível envio exige reconciliação. Não prometer entrega exatamente uma vez quando o provedor não oferece esse contrato; bloquear repetição automática de resultado incerto até haver evidência suficiente.
- Corrigir reconexão Baileys, cancelamento de timers, encerramento com persistência de sessão e exclusividade por instância. Alinhar status e desconexão da Z-API à operação efetiva suportada.
- Sincronização WeSales por intenção persistente e recuperação; criação receptiva exige Nome, CPF, Telefone e Convênio. Mostrar cadastro pendente/erro até obter o vínculo remoto confirmado.
- Substituir leituras recorrentes por Server Actions por bootstrap agregado e GETs autenticados. Manter mutações autorizadas; cache sempre segregado por tenant, usuário e escopo.
- Paginação por cursor e índices para fila e histórico, filtros antes da paginação, busca por mensagem e por cliente. Carregar mensagens antigas progressivamente; virtualizar listas quando o volume medido justificar.
- Agrupar sinais Realtime, recuperar lacunas após reconexão, cancelar respostas de conversa abandonada e impedir sobreposição de polls. Medir Auth/Redis antes de alterar validação de sessão, preservando SSO e revogação.
- Upload direto autorizado ao storage, envio ao engine por referência, validação de tamanho e tipo no servidor. Progresso, cancelamento quando aplicável e erro claro.

**Arquivos principais:** `services/engine/src/server.ts`, `bridge.ts`, `baileys.ts`, `index.ts` e adaptadores; `apps/web/src/lib/chat/engine.ts`; rotas novas de leitura e upload; `ConversaCentro.tsx`, `FilaConversas.tsx`, `PainelLead.tsx`, `atendimento/ui.tsx`; `proxy.ts`, `lib/auth/session.ts` e `sessao-cache.ts` apenas conforme evidência; migrations e jobs do Workspace.

**Aceite:** reinício do worker não perde evento já aceito; webhook repetido não duplica registro; resultado incerto não dispara repetição cega; tenant pausado não bloqueia outro; mensagens antigas permanecem visíveis; troca rápida de conversa não mistura respostas; queda de Realtime recupera lacunas.

**Desempenho:** registrar p50/p95 e erros antes/depois com 1, 10 e 30 atendentes simulados e dados representativos, respeitando capacidade da máquina. Meta inicial: troca de conversa com sessão quente em p95 abaixo de 1 s no ambiente de teste definido. Medir separadamente renderização, confirmação local de envio, processamento e entrega externa; simulação não comprova latência real de WhatsApp. Não remover validações para atingir a meta.

## 5. Ferramentas completas de atendimento externo

- Texto com formatação suportada, assinatura opcional do nome em negrito, emojis, figurinhas, imagens, documentos e áudio enviado/gravado/recebido; foto de perfil com fallback.
- Criar conversa, responder mensagem citada, visualizar contexto da citação, pesquisar mensagens, carregar histórico e consultar galeria de arquivos/imagens/documentos.
- Tags por conversa; ordenação por antigas/recentes e maior/menor espera. Definir espera pelo primeiro recebimento do cliente ainda sem resposta humana no episódio; mensagens técnicas não alteram essa contagem.
- Respostas rápidas administráveis, rascunhos por conversa/usuário e agendamento individual persistente, com cancelar/reagendar. Revalidar acesso, alocação e disponibilidade da instância no horário de envio.
- Atendente padrão, assumir/transferir para atendente, operacional ou master conforme permissão. Tratar disputa por atribuição de forma atômica.
- Fechar atendimento exigindo tabulação e decisão de funil válida, registradas juntas; reabertura vira episódio identificável.
- Lead receptivo com associação segura ou criação obrigatória dos quatro campos; exibir pendências WeSales sem falsa confirmação.
- Sidebar recolhível na visão master e layout de atendimento que aproveita a largura disponível, com navegação por teclado e estados de vazio/carregamento/erro.

**Aceite:** fluxo ponta a ponta em navegador com provedores simulados, incluindo envio de mídia, falha e recuperação, pesquisa, agendamento, transferência concorrente e fechamento sem/com tabulação. A matriz de capacidades informa o que depende de validação Baileys/Z-API real; recurso sem suporte não exibe sucesso fictício.

## 6. Disparos e métricas por instância

- Pool global de templates por campanha/tenant: mínimo de 3 × N templates distintos para N números participantes. Todos os números elegíveis usam o pool completo; não criar propriedade exclusiva de três templates por número.
- Para o caso canônico de 10 números e 30 templates, implementar e testar a sequência pedida: rodadas T1–T10, T11–T20, T21–T30, depois T2–T11. Ordem dos números e cursor de templates persistidos; edição do pool gera versão nova aplicada em limite definido da rodada.
- Fórmula de referência no caso exato M=3N: índice do template = `(posição_do_número + N * (rodada % 3) + floor(rodada / 3)) % M`, com índices iniciando em zero. Para M maior ou alterações de elegibilidade, especificar/testar cobertura antes de generalizar; nenhum template cadastrado pode ficar permanentemente sem uso. Prévia das rodadas permite conferir a regra.
- Delays em segundos inteiros, mínimo e máximo inclusivos, escolhidos de um conjunto embaralhado sem reposição. Esgotar o conjunto antes de iniciar outro, evitando repetição imediata na fronteira quando houver mais de um valor. Exibir a quantidade exata de intervalos disponíveis; 60–300 inclusive fornece 241 valores.
- Persistir conjunto/cursor e próxima elegibilidade. Cron de minuto não serve para cadências de cinco segundos: mover despacho para worker com agenda persistente. Aplicar delay a partir do envio efetivo, sem rajada de compensação após parada.
- Justiça entre tenants, pausa/cancelamento, limites por instância e recuperação de leases. Registrar falhas e envios incertos sem retry cego.
- Implementar o fluxo técnico solicitado entre números controlados do mesmo tenant: após envio elegível para lead, até quatro destinatários distintos recebem mensagens e respondem em tempos sorteados. Exigir cinco números elegíveis para executar o cenário de quatro pares; com menos, suspender esse fluxo e mostrar o motivo, sem impedir que a campanha opere conforme suas demais regras.
- Fluxo técnico separado do atendimento, mas visível para auditoria operacional. Não produzir novos ciclos a partir de resposta técnica; impor limites, pausa imediata e exclusão de números que deixem de pertencer ao conjunto controlado. Permanecer desligado até teste real autorizado.
- Métricas separadas: envios para leads, destinatários únicos, leads que responderam, taxa de resposta comercial, totais enviados/recebidos, tráfego técnico, falhas, desconexões, atrasos e idade de fila. Não somar respostas técnicas ao indicador comercial nem apresentar probabilidade de banimento sem base validada.
- Contadores e valores agregados no banco, sem depender do limite de linhas de consultas. Definir valor em negociação com base na oferta, não confundir margem disponível com valor contratado.

**Arquivos principais:** `lib/crm/disparo.ts`, `disparo-actions.ts`, `disparo-shared.ts`, `app/api/cron/disparo-whatsapp/route.ts`, worker do engine, agregações e migrations.

**Aceite:** testar matriz canônica e participação de todo o pool; testar conjuntos completos de delays, reinício, fronteira de ciclos, números desconectados, campanhas pausadas e workers concorrentes. Tráfego técnico não cria conversas de atendimento, não inflaciona respostas comerciais e não gera laço de mensagens. Tudo validado primeiro com relógio controlado e provedores simulados.

## 7. Painéis de simulação/digitação e chat interno

Esta etapa começa depois de estabilizar o atendimento externo e seus contratos. Faz parte do plano, sem deslocar a prioridade do WhatsApp.

- Criar solicitação operacional como registro próprio, ligado a tenant, pessoa/lead, atendente e oferta; simulação pode começar sem oferta e produzir uma ou mais ofertas como resposta.
- No atendimento, botão de solicitar simulação com dados do cliente e IDWS, acompanhado de área de ofertas simuladas online e envio de imagem/texto da oferta ao cliente.
- Pedido de digitação vinculado à oferta escolhida e snapshot das condições aceitas; registrar mudança de etapa e pedido atomicamente. Sincronização remota recuperável se WeSales estiver indisponível.
- Painel compartilhado por escopo: atendente acompanha suas solicitações sem abrir cada conversa; operacional assume, responde, devolve pendência e conclui; master acompanha toda a operação do tenant.
- Estados e histórico: solicitado, em atendimento, aguardando informações, respondido/concluído e cancelado, com autoria e timestamps. Definir tempos de primeira resposta, conclusão e períodos aguardando informações; não apagar atrasos ao reatribuir.
- Resposta da simulação fica no registro e na área de ofertas do cliente; aviso no chat apenas notifica. Não depender de encontrar uma mensagem para recuperar o trabalho operacional.
- Evoluir chat interno com leitura por usuário, digitando com expiração, foto, formatação, emojis, figurinhas, áudios, imagens e documentos. Reutilizar componentes de mídia quando adequado, mantendo autorização própria por canal.
- Corrigir cursor por canal, recuperação de lacunas, paginação antiga, respostas concorrentes e consultas repetidas por canal; revogação de acesso alcança banco/Realtime.

**Aceite:** solicitação e resposta aparecem nas três visões autorizadas; oferta enviada corresponde à versão escolhida; dupla atribuição não cria dois responsáveis; métricas são reproduzíveis pelos eventos. Chat interno recupera mensagens após desconexão e não permite leitura por membro revogado.

## Execução autônoma e relatório

- Coordenador define contratos, migrations, isolamento, concorrência e revisão. Até dois executores podem trabalhar em tarefas independentes: Luna em tarefas pequenas e Terra em implementação delimitada. Disponibilidade pode exigir execução pelo próprio coordenador.
- Dividir propriedade dos arquivos para evitar edições concorrentes. Não delegar uma implementação que dependa de contrato ainda indefinido. Revisar cada entrega antes de avançar.
- Seguir as etapas sem solicitar nova aprovação para decisões locais reversíveis cobertas por este plano. Se faltar uma integração, continuar frentes independentes e registrar exatamente o teste que ficou pendente.
- Rodar testes de regressão pertinentes, tipos, build e navegador conforme cada entrega. Distinguir falha preexistente, teste simulado e teste real; não afirmar conclusão se critérios essenciais não passaram.
- Registrar andamento e decisões nos documentos do projeto, com resumo no GRUPO.md e links para detalhes, preservando o conteúdo existente.
- Entregar lista de mudanças, evidências, comandos de reprodução, limitações, migrations preparadas, procedimento de ativação/reversão e roteiro curto da homologação real.
- Número real, pareamento, envio a destinatário, importação de dados e publicação aguardam uma sessão posterior. Nenhuma etapa local precisa do celular do Bruno nesta execução.

## Homologação posterior, com Bruno disponível

1. Parear instâncias e autorizar destinatários de teste; validar identidade e isolamento do tenant de homologação.
2. Enviar/receber texto e cada tipo de mídia; testar citação, perfil, confirmação de entrega/leitura quando suportada, reinício e reconexão.
3. Trocar instância e voltar, conferir checkpoints, histórico, anexos e resposta no número anterior.
4. Validar agendamento/campanha com volume controlado e, se habilitado, fluxo técnico entre números controlados; conferir métricas separadas.
5. Revisar resultados e preparar implantação gradual com backup, conciliação de histórico e monitoramento. Só então aprovar e executar alterações no ambiente publicado.
