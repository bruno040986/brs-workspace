# Contenção temporária — procedimento para aprovação

Estado: preparado, NÃO executado. Não confundir trabalho local com proteção de produção.
Projeto: gazwohjfigvcycnukdwj. Interrupção afeta Workspace, Portal, CRM e integrações compartilhadas.

## Condições

Autorização específica de Bruno para a interrupção e acesso administrativo verificado. O navegador disponível redirecionou para login; não há sessão administrativa confirmada nesse painel. Preservar configuração atual e logs antes das mudanças, sem exportar segredos para estes documentos.

## Sequência de execução e evidência

1. Registrar horário UTC, configuração Auth/API/Storage, identificação dos serviços consumidores e período de logs preservado. Registrar cada alteração e responsável.
2. Fechar criação pública no Supabase Auth. Confirmar configuração e que criação administrativa interna continua distinta; não testar criando contas reais. Não inferir encerramento de JWTs a partir de ban ou revogação de refresh tokens.
3. Bloquear temporariamente entrada aos três frontends E às suas rotas de servidor, inclusive URLs alternativas dos deploys. Uma página de manutenção apenas visual não protege handlers.
4. Desativar Data API pelo controle oficial, abrangendo REST/RPC/GraphQL expostos; validar resposta direta sem frontend. Isso também interrompe consumidores legítimos via supabase-js. Não é bloqueio de Auth, Storage, Realtime, Edge Functions ou conexões diretas ao Postgres.
5. Tornar privados os buckets com documentos sensíveis, em especial partner-documents, e negar leituras não autorizadas nas políticas. Auditar rotas que usam service_role e links assinados. Validar URLs públicas conhecidas sem copiar o conteúdo de documentos, considerar caches/CDN e URLs assinadas já emitidas. Não marcar contido somente por alterar o campo public.
6. Tratar separadamente Realtime, Edge Functions, engine e outros backends que leem com service_role/conexões diretas. Inventariar entradas públicas e interromper temporariamente as que possam expor dados, preservando ingestão assinada apenas se isolada e segura. Não afirmar manutenção completa enquanto alguma superfície não tiver sido verificada.
7. Validar de fora: sem sessão, sessão comum preexistente e caminhos diretos conhecidos. Não usar somente ausência de linhas em tabelas vazias como prova de bloqueio. Não fazer escrita destrutiva de teste em produção.
8. Registrar resultado por superfície: bloqueada, preservada intencionalmente com justificativa ou ainda não verificada. Comunicar limitação residual explicitamente.

## Retorno

Não reabrir automaticamente em horário fixo nem por encerramento do agente. Reabertura apenas após revisão, testes de isolamento e autorização de Bruno. Restaurar disponibilidade preservando signup fechado e correções de autorização/documentos; nunca restaurar políticas públicas vulneráveis como rollback rotineiro.

## Alternativa pausa de projeto

Não assumir botão Pause disponível: documentação informa restrição a projetos gratuitos. Não transferir organização, mudar plano ou apagar projeto para obter pausa. Mesmo uma pausa precisa de validação externa das superfícies e caches.

## Referências oficiais consultadas

- https://supabase.com/docs/guides/api/securing-your-api
- https://supabase.com/docs/guides/storage/buckets/fundamentals
- https://supabase.com/kb/troubleshooting/storage-private-bucket-files-still-accessible-after-remove-access-or-logout
- https://supabase.com/docs/guides/platform/free-project-pausing
