/**
 * ESPELHO da lista de permissões do CRM AlvoConsig.
 * Fonte da verdade: `brs-alvoconsig/apps/web/src/lib/crm/permissoes.ts`.
 * MANTER AS DUAS IGUAIS (mesmas chaves, grupos e rótulos) — o Workspace só
 * edita a matriz perfil → chaves (`crm_perfis`/`crm_perfis_permissoes`);
 * quem protege cada ação com a chave é o código do CRM.
 */

export const PERMISSOES_CRM = [
  // Leads e ofertas
  { chave: 'leads.ver_todos', grupo: 'Leads e Ofertas', rotulo: 'Ver todos os leads e ofertas do parceiro' },
  { chave: 'leads.ver_meus', grupo: 'Leads e Ofertas', rotulo: 'Ver os leads e ofertas atribuídos a mim' },
  { chave: 'leads.mover_etapa', grupo: 'Leads e Ofertas', rotulo: 'Mover etapa (prospecção e oferta) e tabular' },
  { chave: 'leads.criar', grupo: 'Leads e Ofertas', rotulo: 'Criar lead na base' },
  { chave: 'leads.importar_exportar', grupo: 'Leads e Ofertas', rotulo: 'Importar e exportar' },
  // Campanhas
  { chave: 'campanhas.ver', grupo: 'Campanhas', rotulo: 'Ver campanhas' },
  { chave: 'campanhas.criar_editar', grupo: 'Campanhas', rotulo: 'Criar e editar campanhas' },
  { chave: 'campanhas.pausar_encerrar', grupo: 'Campanhas', rotulo: 'Pausar e encerrar campanhas' },
  { chave: 'campanhas.participar_discadora', grupo: 'Campanhas', rotulo: 'Ser incluído como atendente em campanhas de discadora, IA de voz e URA reversa' },
  // Atendimento
  { chave: 'atendimento.ver_todas', grupo: 'Atendimento', rotulo: 'Ver todas as conversas' },
  { chave: 'atendimento.ver_meus_fila', grupo: 'Atendimento', rotulo: 'Ver as abas Meus e Fila' },
  { chave: 'atendimento.responder_atribuida', grupo: 'Atendimento', rotulo: 'Responder conversas atribuídas a mim' },
  { chave: 'atendimento.responder_qualquer', grupo: 'Atendimento', rotulo: 'Responder qualquer conversa' },
  { chave: 'atendimento.comentario_interno', grupo: 'Atendimento', rotulo: 'Fazer comentário interno em qualquer conversa' },
  { chave: 'atendimento.atribuir', grupo: 'Atendimento', rotulo: 'Atribuir conversas' },
  { chave: 'atendimento.transferir_qualquer', grupo: 'Atendimento', rotulo: 'Transferir conversa para qualquer usuário' },
  { chave: 'atendimento.transferir_operacional_master', grupo: 'Atendimento', rotulo: 'Transferir conversa só para Operacional e Master' },
  { chave: 'atendimento.ver_sem_lead', grupo: 'Atendimento', rotulo: 'Ver conversas sem lead' },
  { chave: 'atendimento.enviar_oferta', grupo: 'Atendimento', rotulo: 'Enviar oferta e simulação ao lead' },
  { chave: 'atendimento.salvar_arquivos', grupo: 'Atendimento', rotulo: 'Salvar arquivos do lead' },
  // Chat interno
  { chave: 'chat_interno.usar', grupo: 'Chat interno', rotulo: 'Usar o chat interno' },
  { chave: 'chat_interno.receber_simulacao', grupo: 'Chat interno', rotulo: 'Aparecer como opção para receber solicitações de simulação' },
  { chave: 'chat_interno.responder_simulacao', grupo: 'Chat interno', rotulo: 'Responder solicitação com oferta simulada' },
  // Configurações
  { chave: 'config.ver', grupo: 'Configurações', rotulo: 'Ver configurações' },
  { chave: 'config.editar_canais', grupo: 'Configurações', rotulo: 'Editar canais, discadoras e credenciais' },
  { chave: 'config.usuarios_criar_editar', grupo: 'Configurações', rotulo: 'Criar e editar usuários' },
  { chave: 'config.usuarios_criar_master', grupo: 'Configurações', rotulo: 'Criar usuários com perfil Master' },
  { chave: 'config.scripts', grupo: 'Configurações', rotulo: 'Editar scripts de ligação' },
  // Personalização
  { chave: 'personalizacao.tema', grupo: 'Personalização', rotulo: 'Escolher tema' },
  { chave: 'personalizacao.logo_parceiro', grupo: 'Personalização', rotulo: 'Alterar o logotipo do parceiro' },
  { chave: 'personalizacao.propria_foto', grupo: 'Personalização', rotulo: 'Alterar a própria foto (se liberado no cadastro)' },
] as const

export type PermissaoCrm = (typeof PERMISSOES_CRM)[number]['chave']
export type PerfilCrm = 'master' | 'operacional' | 'atendente'

export const PERFIS_CRM: Array<{ chave: PerfilCrm; nome: string }> = [
  { chave: 'master', nome: 'Master' },
  { chave: 'operacional', nome: 'Operacional' },
  { chave: 'atendente', nome: 'Atendente' },
]

export function temPermissao(permissoes: ReadonlySet<string> | readonly string[] | undefined, chave: PermissaoCrm): boolean {
  if (!permissoes) return false
  return permissoes instanceof Set ? permissoes.has(chave) : (permissoes as readonly string[]).includes(chave)
}
