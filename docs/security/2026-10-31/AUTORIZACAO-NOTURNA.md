# Autorização noturna — segurança BRS

Bruno autorizou programação local em branches/worktrees, revisão pelo Codex e publicação somente após sua confirmação pela manhã. Esta autorização substitui o bloqueio de implementação local do plano mestre; não autoriza push, merge, deploy, migrations remotas, alteração de produção ou mensagens reais. A autorização de contenção de emergência em produção foi solicitada separadamente e ainda não foi recebida.

## Isolamento

Branch nos três repositórios: security/incidente-2026-10-31.
Worktrees: brs-workspace-seguranca-20261031, brs-portal-parceiro-seguranca-20261031, brs-alvoconsig-seguranca-20261031.
Bases locais: Workspace 83f96c7d, Portal 6a3e752, CRM ed1b839. Não presumir que representam exatamente produção; mudanças não commitadas dos checkouts originais ficaram intactas e não foram copiadas.

## Coordenação

Codex libera missões limitadas, revisa os diffs e testes e registra pendências. Claude executor separado via CLI lê os documentos; a sessão anterior do VS Code não está sendo retomada nem alterada. Documentos por si só não acordam agentes. O processo depende de sessão ativa, máquina ligada, rede e cota; nenhuma garantia de conclusão automática até a manhã.

## Ordem

1. Correções locais de autorização/RLS e plano de contenção reversível.
2. Provisionamento e proteção de documentos, validando consumidores.
3. Autenticação completa em cinco etapas e proteção de APIs diretas.
4. Registro de incidentes, notificações determinísticas e contingências.
5. MCP autenticado e separado; Jarvis de consulta sem poderes operacionais.
6. Testes integrados e relatório para aprovação humana de publicação.

Uma entrega incompleta ou não testada não será marcada pronta para produção. Pendências de destinatários, credenciais, horários e orçamento ficam configuráveis e desativadas até definição, sem valores fictícios.
