import type { EngineJob } from '@/lib/scp-engine/decisions'
import { createAdminClient } from '@/lib/supabase/server'
import type { Campanha } from './http'
import type { ResultadoEnvio } from './whatsapp'

// Imports pesados (engine, next/og, WeSales) ficam dinâmicos: handlers.ts carrega este módulo sempre.

const SEM_WHATSAPP = /sem_whatsapp|not.?on.?whatsapp/i

/**
 * Traduz o resultado do envio para o contrato do motor: confirmado = conclui;
 * rejeição definitiva (número sem WhatsApp) = conclui sem retentar; o resto lança
 * (o motor reagenda e a MESMA chave reaproveita o operation_id).
 */
function concluirOuLancar(r: ResultadoEnvio): 'enviado' | 'descartado' {
  if (r.resultado === 'confirmado') return 'enviado'
  if (r.resultado === 'rejeitado' && SEM_WHATSAPP.test(r.mensagem)) return 'descartado'
  throw new Error(`envio ${r.resultado}: ${r.mensagem}`.slice(0, 200))
}

async function campanhaDe(admin: any, id: string): Promise<Campanha> {
  const { data } = await admin.from('promocao_campanhas').select('*').eq('id', id).maybeSingle()
  if (!data) throw new Error('campanha não encontrada')
  return data as Campanha
}

function prazoBr(iso: string): string {
  const d = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(iso))
  const p = (t: string) => d.find((x) => x.type === t)?.value || ''
  return `${p('day')}/${p('month')}/${p('year')} às ${p('hour')}:${p('minute')}`
}

function nomeCurto(nome: string): string {
  const [primeiro, ...resto] = nome.trim().split(/\s+/)
  return resto.length ? `${primeiro} ${resto[resto.length - 1][0].toUpperCase()}.` : primeiro
}

async function handleWesalesSync(job: EngineJob): Promise<void> {
  const inscricaoId = String(job.payload?.inscricaoId || '')
  if (!inscricaoId) throw new Error('promocoes.wesales_sync sem inscricaoId')
  const { sincronizarInscricaoWesales } = await import('./wesales-sync')
  const r = await sincronizarInscricaoWesales(inscricaoId)
  if (r.status === 'erro') throw new Error(r.erro || 'falha no sync WeSales')
}

async function handleEnviarLinkNumeros(job: EngineJob): Promise<void> {
  const geracaoId = String(job.payload?.geracaoId || '')
  const token = String(job.payload?.token || '')
  if (!geracaoId) throw new Error('promocoes.enviar_link_numeros sem geracaoId')
  const [{ formatarTelefoneContato, telefoneContatoDigitos }, { enviarWhatsappPromocao }, { textoLinkIndicador, textoLinkServidor }] = await Promise.all([
    import('./http'),
    import('./whatsapp'),
    import('./mensagens'),
  ])
  const admin: any = await createAdminClient()
  const limparToken = () => admin.from('process_jobs').update({ payload: { geracaoId } }).eq('id', job.id)

  const { data: g } = await admin.from('promocao_geracoes').select('*').eq('id', geracaoId).maybeSingle()
  if (!g) throw new Error('geração não encontrada')
  if (!['pendente', 'enviado'].includes(g.status) || !token) {
    await limparToken()
    return
  }
  const camp = await campanhaDe(admin, g.campanha_id)
  const contato = formatarTelefoneContato(await telefoneContatoDigitos(admin, camp))
  const url = `${camp.site_base_url}/valparaiso-go/promocao/numeros?t=${token}`
  const prazo = prazoBr(g.expira_em)

  let texto: string
  let tipo: 'link_numeros_servidor' | 'link_numeros_indicador'
  if (g.titular_tipo === 'indicador') {
    const [{ data: indicador }, { data: direito }] = await Promise.all([
      admin.from('promocao_indicadores').select('nome').eq('id', g.titular_id).maybeSingle(),
      admin.from('promocao_direitos').select('inscricao_id').eq('id', g.direito_id).maybeSingle(),
    ])
    const { data: indicado } = await admin.from('promocao_inscricoes').select('nome').eq('id', direito?.inscricao_id).maybeSingle()
    texto = textoLinkIndicador({ nome: indicador?.nome || '', indicado: nomeCurto(indicado?.nome || ''), url, prazo, contato })
    tipo = 'link_numeros_indicador'
  } else {
    const { data: insc } = await admin.from('promocao_inscricoes').select('nome').eq('id', g.titular_id).maybeSingle()
    texto = textoLinkServidor({ nome: insc?.nome || '', qtd: g.qtd, url, prazo, contato })
    tipo = 'link_numeros_servidor'
  }

  const r = await enviarWhatsappPromocao({ campanhaId: g.campanha_id, chave: `link:${geracaoId}`, tipo, telefone: g.telefone, texto })
  if (concluirOuLancar(r) === 'enviado' && g.status === 'pendente') {
    await admin.from('promocao_geracoes').update({ status: 'enviado', enviado_em: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', geracaoId).eq('status', 'pendente')
  }
  await limparToken()
}

async function handleEnviarComprovante(job: EngineJob): Promise<void> {
  const tipo = String(job.payload?.tipo || '')
  const id = String(job.payload?.id || '')
  const n = Number(job.payload?.n || 1)
  if (!id) throw new Error('promocoes.enviar_comprovante sem id')

  if (tipo === 'indicacao') {
    const { enviarComprovanteIndicacao } = await import('./comprovante-envio')
    concluirOuLancar(await enviarComprovanteIndicacao(id, n))
    return
  }
  if (tipo !== 'numeros') throw new Error(`tipo de comprovante desconhecido: ${tipo}`)

  const [{ formatarTelefoneContato, telefoneContatoDigitos }, { enviarWhatsappPromocao }, { textoComprovanteNumeros }] = await Promise.all([
    import('./http'),
    import('./whatsapp'),
    import('./mensagens'),
  ])
  const admin: any = await createAdminClient()
  const { data: g } = await admin.from('promocao_geracoes').select('id, campanha_id, titular_tipo, titular_id, telefone').eq('id', id).maybeSingle()
  if (!g) throw new Error('geração não encontrada')
  const camp = await campanhaDe(admin, g.campanha_id)
  const [{ data: titular }, { data: numeros }] = await Promise.all([
    admin.from(g.titular_tipo === 'indicador' ? 'promocao_indicadores' : 'promocao_inscricoes').select('nome').eq('id', g.titular_id).maybeSingle(),
    admin.from('promocao_numeros').select('numero, geracao_id').eq('titular_tipo', g.titular_tipo).eq('titular_id', g.titular_id).eq('status', 'valido').order('numero'),
  ])
  const { formatarNumeroSorte } = await import('./codigos')
  const { gerarImagemComprovanteNumeros } = await import('./comprovante-numeros-imagem')
  const deste: number[] = (numeros || []).filter((x: any) => x.geracao_id === id).map((x: any) => x.numero)
  const contato = formatarTelefoneContato(await telefoneContatoDigitos(admin, camp))
  const imagem = await gerarImagemComprovanteNumeros({ nome: titular?.nome || '', numeros: deste.map(formatarNumeroSorte), total: (numeros || []).length, contato: contato || null })
  const r = await enviarWhatsappPromocao({
    campanhaId: g.campanha_id,
    chave: `comprovante-num:${id}:${n}`,
    tipo: 'comprovante_numeros',
    telefone: g.telefone,
    texto: textoComprovanteNumeros({ nome: titular?.nome || '', numeros: deste, total: (numeros || []).length, regulamentoUrl: camp.regulamento_url }),
    imagemBase64: imagem.toString('base64'),
  })
  concluirOuLancar(r)
}

async function handleRecalcularDireitos(job: EngineJob): Promise<void> {
  const inscricaoId = String(job.payload?.inscricaoId || '')
  if (!inscricaoId) throw new Error('promocoes.recalcular_direitos sem inscricaoId')
  const { recalcularDireitos } = await import('./direitos-service')
  await recalcularDireitos(inscricaoId)
}

async function handleAvisoPagamento(job: EngineJob): Promise<void> {
  const { handleAvisoPagamento: h } = await import('./jobs-remessa')
  await h(job)
}

export function registrarHandlersPromocao(deps: { registerHandler: (kind: string, fn: (job: EngineJob) => Promise<void>) => void }): void {
  deps.registerHandler('promocoes.wesales_sync', handleWesalesSync)
  deps.registerHandler('promocoes.enviar_link_numeros', handleEnviarLinkNumeros)
  deps.registerHandler('promocoes.enviar_comprovante', handleEnviarComprovante)
  deps.registerHandler('promocoes.aviso_pagamento', handleAvisoPagamento)
  deps.registerHandler('promocoes.recalcular_direitos', handleRecalcularDireitos)
}
