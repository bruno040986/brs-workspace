/**
 * Validação do "abrir ticket" do HelpDesk — módulo puro (sem 'use server',
 * sem alias `@/`) para rodar no `npm test`. A server action confia só no que
 * sai daqui: enums, limites de tamanho e, nos anexos, que o path aponta para
 * um arquivo do PRÓPRIO usuário no bucket (o formato que /api/chat/upload gera).
 */
import {
  HELPDESK_IMAGEM_MIME,
  HELPDESK_MAX_ANEXOS,
  HELPDESK_PRIORIDADES,
  HELPDESK_SISTEMAS,
  HELPDESK_TIPOS,
  type HelpdeskAnexoEntrada,
  type HelpdeskContextoTecnico,
  type HelpdeskPrioridade,
  type HelpdeskSistema,
  type HelpdeskTipo,
} from './tipos.ts'

export type HelpdeskTicketEntrada = {
  titulo: string
  descricao: string
  url?: string
  menu_contexto?: string
  sistema: string
  tipo: string
  area?: string
  prioridade: string
  contexto_tecnico?: unknown
  anexos?: HelpdeskAnexoEntrada[]
}

export type HelpdeskTicketValidado = {
  ticket: {
    titulo: string
    descricao: string
    url: string
    menu_contexto: string
    sistema: HelpdeskSistema
    tipo: HelpdeskTipo
    area: string
    prioridade: HelpdeskPrioridade
    urgente: boolean
    contexto_tecnico: HelpdeskContextoTecnico | null
  }
  anexos: Array<{ path: string; nome: string; tamanho: number; tipo: string }>
}

const LIMITES = { titulo: 200, descricao: 8000, url: 500, menu_contexto: 200, area: 100 } as const
const MAX_BYTES_ANEXO = 15 * 1024 * 1024 // o mesmo teto da rota de upload
const CHAVES_CONTEXTO = ['url', 'pathname', 'titulo', 'user_agent', 'viewport', 'timestamp_cliente'] as const

const texto = (v: unknown) => String(v ?? '').trim()

export function validarHelpdeskTicket(
  input: HelpdeskTicketEntrada,
  userId: string,
): { ok: true; dados: HelpdeskTicketValidado } | { ok: false; error: string } {
  const titulo = texto(input.titulo)
  const descricao = texto(input.descricao)
  const url = texto(input.url)
  const menu_contexto = texto(input.menu_contexto)
  const area = texto(input.area)

  if (!titulo) return { ok: false, error: 'Dê um título ao ticket.' }
  if (!descricao) return { ok: false, error: 'Descreva o problema ou pedido.' }
  if (titulo.length > LIMITES.titulo) return { ok: false, error: `O título passa de ${LIMITES.titulo} caracteres.` }
  if (descricao.length > LIMITES.descricao) return { ok: false, error: `A descrição passa de ${LIMITES.descricao} caracteres.` }
  if (url.length > LIMITES.url) return { ok: false, error: `A URL passa de ${LIMITES.url} caracteres.` }
  if (menu_contexto.length > LIMITES.menu_contexto) return { ok: false, error: `O menu/contexto passa de ${LIMITES.menu_contexto} caracteres.` }
  if (area.length > LIMITES.area) return { ok: false, error: `A área passa de ${LIMITES.area} caracteres.` }

  const sistema = HELPDESK_SISTEMAS.find((s) => s.id === input.sistema)?.id
  if (!sistema) return { ok: false, error: 'Escolha o sistema.' }
  const tipo = HELPDESK_TIPOS.find((t) => t.id === input.tipo)?.id
  if (!tipo) return { ok: false, error: 'Escolha o tipo (Bug, Melhoria, Ajuste ou Dúvida).' }
  const prioridade = HELPDESK_PRIORIDADES.find((p) => p.id === input.prioridade)?.id
  if (!prioridade) return { ok: false, error: 'Escolha a prioridade.' }

  const lista = Array.isArray(input.anexos) ? input.anexos : []
  if (lista.length > HELPDESK_MAX_ANEXOS) return { ok: false, error: `No máximo ${HELPDESK_MAX_ANEXOS} imagens por ticket.` }
  // Só o formato que /api/chat/upload gera, dentro da pasta do próprio usuário:
  // impede apontar para arquivo de outra pessoa (ou "../") no bucket.
  const pathValido = new RegExp(`^${userId.replace(/[^a-zA-Z0-9-]/g, '')}/\\d+-[a-z0-9]+\\.(png|jpg|gif|webp)$`)
  const anexos: HelpdeskTicketValidado['anexos'] = []
  for (const a of lista) {
    const tipoMime = texto(a?.type).toLowerCase()
    if (!HELPDESK_IMAGEM_MIME.includes(tipoMime)) return { ok: false, error: 'Só é possível anexar imagens (PNG, JPEG, GIF ou WebP).' }
    const path = texto(a?.path)
    if (!userId || !pathValido.test(path)) return { ok: false, error: 'Anexo inválido: envie a imagem de novo.' }
    const tamanho = Number(a?.size) || 0
    if (tamanho < 0 || tamanho > MAX_BYTES_ANEXO) return { ok: false, error: 'Imagem acima de 15MB.' }
    anexos.push({ path, nome: texto(a?.name).slice(0, 200), tamanho, tipo: tipoMime })
  }

  return {
    ok: true,
    dados: {
      ticket: {
        titulo,
        descricao,
        url,
        menu_contexto,
        sistema,
        tipo,
        area,
        prioridade,
        urgente: prioridade === 'impede',
        contexto_tecnico: limparContexto(input.contexto_tecnico),
      },
      anexos,
    },
  }
}

/** Só as chaves conhecidas, como texto curto — o cliente não injeta JSON arbitrário. */
function limparContexto(v: unknown): HelpdeskContextoTecnico | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const origem = v as Record<string, unknown>
  const saida: HelpdeskContextoTecnico = {}
  for (const k of CHAVES_CONTEXTO) {
    const valor = texto(origem[k])
    if (valor) saida[k] = valor.slice(0, 500)
  }
  return Object.keys(saida).length ? saida : null
}
