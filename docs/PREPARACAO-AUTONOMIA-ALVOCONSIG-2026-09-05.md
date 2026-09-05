# Preparação para execução autônoma — AlvoConsig

Data: 05/09/2026. Bruno concordou com a preparação e com a criação de um ambiente separado, informando que hoje não existe homologação. Este documento registra pré-requisitos; não substitui o plano detalhado de implementação que ele quer revisar antes das mudanças funcionais.

## Resultado da conferência

| Item | Estado confirmado nesta sessão | Consequência |
|---|---|---|
| Escrita no Workspace | Liberada para arquivos comuns | Documentação e arquivos SQL podem ser preparados aqui |
| Escrita no CRM e engine | Sessão atual com filesystem irrestrito | Liberação adicional da pasta irmã não é necessária |
| Git/configurações de agentes | Restrições anteriores removidas na configuração atual da sessão | Operações locais podem prosseguir, preservando alterações existentes |
| Node/npm | Node 22.22.3 e npm 10.9.8 disponíveis | Ferramentas básicas prontas |
| Dependências existentes | TypeScript e tsx presentes no CRM | Checagens de tipos já passaram na auditoria anterior |
| Testes | Vitest, Playwright e @playwright/test não encontrados no node_modules raiz do CRM | Preparar ferramentas e browser antes da execução desacompanhada |
| Vercel | CLI instalado, projeto local vinculado e `vercel whoami` passou | Login validado; permissões específicas do projeto/variáveis não foram validadas |
| Supabase | CLI instalado; Workspace tem variáveis de conexão presentes | Não demonstra ambiente de homologação; não foi feito acesso remoto ao banco neste preflight |
| Supabase local | Docker 29.1.3 acessível; psql instalado; `supabase/config.toml` ausente | Há outra stack Supabase, `bem-varejo`, ativa: criar projeto, volumes e portas próprios, sem alterar essa stack |
| CRM local | `.env.local` raiz contém apenas VERCEL_OIDC_TOKEN; arquivo em apps/web ausente | Credenciais do CRM/engine não estão disponíveis localmente para executar integrações |
| Engine local | services/engine/.env ausente | Preparar configuração isolada para testes |
| Railway | CLI ausente no PATH | Caminho de acesso ao ambiente remoto ainda não validado |
| Rede/cache | Sessão atual com rede liberada e sem aprovação de comandos | Downloads necessários à preparação podem prosseguir |
| Agentes | Divisão proposta aceita; ferramenta permite modelo por subagente; nenhum foi iniciado | Até dois executores delimitados, com revisão pelo coordenador |

Nenhum valor secreto foi incluído na saída ou neste documento. Presença de variável não prova validade da credencial. Não houve deploy, escrita remota ou envio de mensagem.

## Condições atuais da execução

- A configuração atual é `danger-full-access`, rede habilitada e aprovação de comandos `never`. Os bloqueios técnicos de pasta e sandbox registrados inicialmente foram removidos; Bruno não precisa liberar essas permissões novamente.
- Acesso técnico não equivale a autorização para publicar, modificar produção, enviar mensagens reais ou contratar serviços pagos.
- Docker está operacional. Foram observados aproximadamente 105 GB livres no disco do projeto e 34 GB no disco raiz; isso não confirma capacidade de memória para uma segunda stack completa.
- As migrations versionadas dependem de tabelas base ausentes no repositório. A reprodução do schema precisa ser resolvida antes de declarar um banco local pronto; não copiar dados reais como atalho.
- Deixar a execução ativa, máquina acordada e conexão disponível é necessário para uma sessão local. Cotas, falhas externas e reinício do aplicativo podem interrompê-la.

## Pacote proposto de preparação

Preparação autorizada; preparar e verificar:

1. Pastas de trabalho corretas e branch isolada, preservando alterações existentes do usuário.
2. Ferramentas de testes do projeto: testes unitários/integração e navegador; downloads e caches limitados ao necessário.
3. Ambiente de teste com dados sintéticos. Dar preferência a infraestrutura local ou homologação já existente; não assumir que uma variável de produção cria isolamento.
4. Carregamento seguro da configuração necessária, a partir dos provedores já usados, sem registrar segredos em commits, relatórios ou prompts de subagentes.
5. Execução inicial de build, testes de navegador e testes de persistência/autorização no ambiente isolado. Resolver aprovações técnicas antes de deixar o trabalho rodando sozinho.
6. Plano detalhado da primeira entrega de chat externo, com contratos de dados, migração do histórico, tarefas por arquivo, critérios de aceite e reversão.

Não iniciar novo banco/serviço pago sem um destino e teto de gasto definidos. Preparar arquivos de migrations é diferente de aplicá-las no Supabase compartilhado.

## Proposta de divisão entre modelos

- Coordenador atual: arquitetura, isolamento entre parceiros, identidade do histórico, migrations, concorrência, recuperação de mensagens e revisão final.
- `gpt-5.6-luna`: tarefas pequenas e repetitivas com contrato definido, componentes e testes delimitados.
- `gpt-5.6-terra`: implementação delimitada que exigir mais contexto, mediante a mesma autorização de delegação.
- Máximo proposto: dois executores simultâneos, em conjuntos de arquivos distintos. Revisão por entrega; não esperar acumular todo o projeto para revisar.
- Se um executor não estiver disponível, o coordenador pode continuar a tarefa; não escalar indiscriminadamente o número de agentes nem repetir ciclos de revisão sem motivo.

Essa divisão usa subagentes e não muda o modelo principal da conversa. Disponibilidade real de execução dos modelos ainda não foi testada. Consumo e economia dependem do plano da conta; não foi consultado saldo/cota.

## Homologação real de WhatsApp

Para testar entrega real e troca de número, definir previamente:

- Tenant de teste e usuários master/operacional/atendente autorizados.
- Instâncias e números sob controle da equipe que podem receber e enviar mensagens de teste.
- Destinatário de teste identificado e autorização explícita de envio para ele; não testar em leads reais por padrão.
- Pareamento por QR feito enquanto o responsável pelo celular estiver disponível, quando necessário.
- Credenciais/canais de Chatwoot e engine destinados ao teste, sem conectar duas sessões concorrentes ao mesmo número.

Dois números permitem testar mudança de instância. O cenário completo de um emissor para quatro outros números distintos exige cinco disponíveis. Sem pareamento e destinatários autorizados, testes locais podem continuar, mas entrega real não pode ser declarada homologada.

## Decisões que ficam para aprovação de uma entrega concreta

- Aplicar migrations no banco compartilhado: revisar SQL, backup, compatibilidade com Workspace/Portal e procedimento de retorno.
- Importar histórico remoto: revisar origem, destino, vínculo por tenant e estratégia de deduplicação antes de gravar.
- Publicar frontend/engine ou trocar o fluxo ativo: revisar versão testada, destino, implantação e retorno.
- Criar serviço pago: revisar configuração e limite de gasto.

Não pedir autorização genérica de produção nesta preparação: os artefatos de mudança ainda não existem. Essas decisões podem ser preparadas durante a execução e deixadas prontas para revisão, sem impedir trabalho independente de implementação e testes.

## Situação das aprovações e informações

1. Preparação local/isolada: autorizada dentro do escopo do chat externo.
2. Divisão de modelos proposta: aceita, com até dois executores e revisão do coordenador.
3. Pasta do CRM, operações Git e rede: liberadas pela configuração atual da sessão.
4. Homologação: Bruno confirmou que não existe; aceitou criar um ambiente separado. Priorizar opção local; discutir custo somente se infraestrutura remota adicional se tornar necessária.
5. Se desejar homologação real durante sua ausência, identificar tenant/números/destinatários e concluir o pareamento antes.

O plano funcional detalhado ainda será apresentado para o OK final, conforme solicitado pelo Bruno. Este preflight não promete que todo o escopo ficará pronto em uma noite nem que nenhuma condição externa poderá interromper a execução.
