/* eslint-disable @typescript-eslint/no-explicit-any */
import type { EngineJob } from '@/lib/scp-engine/decisions'
import { createAdminClient } from '@/lib/supabase/server'
import { enviarWhatsappPromocao, type ResultadoEnvio } from './whatsapp'
import { gerarImagemComprovanteNumeros } from './comprovante-numeros-imagem'
import { carregarTitular, numerosValidosDoTitular, numerosDaGeracao } from './geracao-publico'
import { formatarNumeroSorte } from './codigos'
import { formatarTelefone } from './mascara'
import { telefoneContatoDigitos } from './http'
import { textoComprovanteNumeros, textoLinkIndicador, textoLinkServidor } from './mensagens'

const fmtData = (iso: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short' }).format(new Date(iso))

/** Rejeição definitiva (número sem WhatsApp) não se retenta; o resto volta ao motor. */
function concluirOuRetentar(r: ResultadoEnvio): void {
  if (r.resultado === 'confirmado') return
  if (r.resultado === 'rejeitado' && /sem_whatsapp/i.test(r.mensagem)) return
  throw new Error(r.mensagem)
}

/** promocoes.enviar_link_numeros — payload { geracaoId, token } (token só vive no payload do job). */
export async function handleEnviarLinkNumeros(job: EngineJob): Promise<void> {
  const geracaoId = String(job.payload?.geracaoId || '')
  const token = String(job.payload?.token || '')
  if (!geracaoId || !token) throw new Error('Payload do link de números incompleto.')

  const sb: any = await createAdminClient()
  const { data: g } = await sb.from('promocao_geracoes').select('*').eq('id', geracaoId).maybeSingle()
  if (!g || !['pendente', 'enviado'].includes(g.status)) return
  const { data: c } = await sb.from('promocao_campanhas').select('*').eq('id', g.campanha_id).maybeSingle()
  const titular = await carregarTitular(sb, g)
  if (!c || !titular) throw new Error('Campanha ou titular não encontrados.')

  const url = `${String(c.site_base_url).replace(/\/$/, '')}/${c.slug}/promocao/numeros?t=${encodeURIComponent(token)}`
  const prazo = fmtData(c.prazo_geracao_ate)
  const contato = (await telefoneContatoDigitos(sb, c)) || ''
  const nome = String(titular.nome).split(' ')[0]

  let texto: string
  if (g.titular_tipo === 'indicador') {
    const { data: d } = await sb.from('promocao_direitos').select('inscricao_id').eq('id', g.direito_id).maybeSingle()
    const { data: ind } = d ? await sb.from('promocao_inscricoes').select('nome').eq('id', d.inscricao_id).maybeSingle() : { data: null }
    const partes = String(ind?.nome || '').trim().split(/\s+/)
    const indicado = partes.length > 1 ? `${partes[0]} ${partes[partes.length - 1][0]}.` : partes[0] || 'servidor'
    texto = textoLinkIndicador({ nome, indicado, url, prazo, contato })
  } else {
    texto = textoLinkServidor({ nome, qtd: g.qtd, url, prazo, contato })
  }

  const r = await enviarWhatsappPromocao({
    campanhaId: g.campanha_id,
    chave: `link:${g.id}`,
    tipo: g.titular_tipo === 'indicador' ? 'link_numeros_indicador' : 'link_numeros_servidor',
    telefone: g.telefone,
    texto,
  })
  concluirOuRetentar(r)

  const agora = new Date().toISOString()
  await sb.from('promocao_geracoes').update({ status: 'enviado', enviado_em: agora, updated_at: agora }).eq('id', g.id).eq('status', 'pendente')
  await sb.from('process_jobs').update({ payload: { geracaoId } }).eq('id', job.id)
}

/** Envia o comprovante (imagem + texto M5) ao telefone cadastrado da geração. Idempotente por (geração, n). */
export async function enviarComprovanteNumeros(geracaoId: string, n: number): Promise<ResultadoEnvio> {
  const sb: any = await createAdminClient()
  const { data: g } = await sb.from('promocao_geracoes').select('*').eq('id', geracaoId).maybeSingle()
  if (!g || g.status !== 'usado') return { resultado: 'rejeitado', mensagem: 'geracao_nao_usada' }
  const { data: c } = await sb.from('promocao_campanhas').select('*').eq('id', g.campanha_id).maybeSingle()
  const titular = await carregarTitular(sb, g)
  if (!c || !titular) return { resultado: 'rejeitado', mensagem: 'dados_nao_encontrados' }

  const [daGeracao, todos] = await Promise.all([numerosDaGeracao(sb, g.id), numerosValidosDoTitular(sb, g)])
  const nome = String(g.dados_confirmados?.nome || titular.nome)
  const contato = formatarTelefone((await telefoneContatoDigitos(sb, c)) || '')
  const texto = textoComprovanteNumeros({ nome, numeros: daGeracao, total: todos.length, regulamentoUrl: c.regulamento_url })

  let imagemBase64: string | undefined
  try {
    const png = await gerarImagemComprovanteNumeros({ nome, numeros: daGeracao.map(formatarNumeroSorte), total: todos.length, contato: contato || null })
    imagemBase64 = `data:image/png;base64,${png.toString('base64')}`
  } catch (e: any) {
    console.error('imagem do comprovante de números falhou', g.id, e?.message)
  }

  return enviarWhatsappPromocao({
    campanhaId: g.campanha_id,
    chave: `comprovante-num:${g.id}:${n}`,
    tipo: 'comprovante_numeros',
    telefone: g.telefone,
    texto,
    imagemBase64,
  })
}

/** promocoes.enviar_comprovante com tipo 'numeros' (o handler de B despacha para cá). */
export async function handleEnviarComprovanteNumeros(job: EngineJob): Promise<void> {
  const id = String(job.payload?.id || '')
  const n = Number(job.payload?.n || 1)
  if (!id) throw new Error('Payload do comprovante incompleto.')
  concluirOuRetentar(await enviarComprovanteNumeros(id, n))
}
