/**
 * Convênio — Base de Conhecimento, Fase 3 (Jarvis pesquisador). Motor do
 * pipeline: uma chamada = uma etapa (spec §6.2), sob lease
 * (`convenio_pesquisas_claim`). Chamado pela rota `pesquisa/avancar` (uma
 * pesquisa específica) e pelo cron `convenio-pesquisas` (retoma o que ficou
 * parado por lease vencido).
 *
 * Nada aqui grava na Base de Conhecimento — isso só acontece em
 * `aplicar-sugestao.ts`, depois do aceite humano.
 */
import { createHash } from 'node:crypto'
import { admin } from '@/app/(dashboard)/convenios/supabase-admin'
import { lerModelosPesquisa } from '@/lib/ia/config'
import { chamarIaJson, extrairJson } from '@/lib/ia/openrouter'
import { baixarSeguro } from './download-seguro'
import { extrairTexto, textoUtilSuficiente } from './extrair-texto'
import { verificarEnte } from './verificar-ente'
import { montarPromptBusca, montarPromptExtracao, type CatalogoExtracao, type ConvenioContexto } from './prompts'

const BUCKET = 'convenio-documentos'
const TIPOS_NORMA = new Set(['decreto', 'lei', 'lei_complementar', 'portaria', 'instrucao_normativa', 'resolucao', 'outro'])
const MAX_TENTATIVAS = 3

type PesquisaRow = {
  id: string
  convenio_id: string
  origem: 'web' | 'documento'
  documento_id: string | null
  status: string
  tentativas: number
  lease_token: string
}

function sha256(texto: string): string {
  return createHash('sha256').update(texto, 'utf-8').digest('hex')
}

function normalizarParaCitacao(s: string): string {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

// Atualiza a pesquisa SEM soltar o lease — usado antes de uma chamada de IA
// (lenta) só para dar feedback de progresso na tela; quem faz a chamada
// continua sendo o dono do lease.
async function marcarEmAndamento(pesquisaId: string, leaseToken: string, patch: Record<string, any>) {
  await admin.from('convenio_pesquisas').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', pesquisaId).eq('lease_token', leaseToken)
}

// Fecha a etapa: solta o lease (lease_until null = disponível pro próximo
// claim, seja outra chamada de "avançar" ou o cron).
async function finalizarEtapa(pesquisaId: string, leaseToken: string, patch: Record<string, any>) {
  const { error } = await admin
    .from('convenio_pesquisas')
    .update({ ...patch, lease_token: null, lease_until: null, updated_at: new Date().toISOString() })
    .eq('id', pesquisaId)
    .eq('lease_token', leaseToken)
  if (error) throw error
}

async function carregarContextoConvenio(convenioId: string): Promise<ConvenioContexto> {
  const { data, error } = await admin
    .from('convenios')
    .select('nome, razao_social, cnpj, cidade, uf, abrangencia, tipo:tipo_convenio_id(nome, esfera:esfera_id(nome))')
    .eq('id', convenioId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Convênio não encontrado.')
  const r = data as any
  return {
    nome: r.nome,
    razao_social: r.razao_social,
    cnpj: r.cnpj,
    tipo_nome: r.tipo?.nome || '',
    esfera_nome: r.tipo?.esfera?.nome || '',
    abrangencia: r.abrangencia || 'nacional',
    cidade: r.cidade,
    uf: r.uf,
  }
}

// ---------------------------------------------------------------------------
// Etapa 1 — busca (ou, para origem='documento', criação da fonte única)
// ---------------------------------------------------------------------------
async function executarBusca(pesquisa: PesquisaRow) {
  const modelos = await lerModelosPesquisa()
  if (!modelos) throw new Error('Modelo de pesquisa não configurado — configure em IA do Workspace.')

  const convenio = await carregarContextoConvenio(pesquisa.convenio_id)
  if (convenio.abrangencia === 'municipal' && !convenio.cidade) {
    throw new Error('Convênio municipal sem cidade cadastrada — preencha em Dados Básicos antes de pesquisar.')
  }
  if (convenio.abrangencia === 'estadual' && !convenio.uf) {
    throw new Error('Convênio estadual sem UF cadastrada — preencha em Dados Básicos antes de pesquisar.')
  }

  await marcarEmAndamento(pesquisa.id, pesquisa.lease_token, { status: 'buscando', etapa_msg: 'Pesquisando normas na web...', progresso: 5 })

  const prompt = montarPromptBusca(convenio)
  const resultado = await chamarIaJson({
    apiKey: modelos.apiKey,
    modelo: modelos.modeloPesquisa,
    mensagens: [{ role: 'user', content: prompt }],
    buscaWeb: { maxResultados: 8 },
    maxTokens: 4000,
  })

  const json = extrairJson<{ normas?: any[] }>(resultado.texto)
  const normas = Array.isArray(json.normas) ? json.normas.slice(0, 8) : []

  // Dedupe em JS (não via ON CONFLICT): o índice único de
  // convenio_pesquisa_fontes é PARCIAL (where url is not null), e o Postgres
  // não infere um índice parcial a partir de um ON CONFLICT (col, col) puro
  // — confirmado testando contra o banco (erro 42P10). Consultar o que já
  // existe cobre igualmente o caso de retomar uma busca após erro.
  const { data: existentes } = await admin.from('convenio_pesquisa_fontes').select('url').eq('pesquisa_id', pesquisa.id)
  const urlsExistentes = new Set((existentes || []).map((r: any) => r.url).filter(Boolean))

  const vistos = new Set<string>()
  const linhas: any[] = []
  let ordem = 0
  for (const n of normas) {
    const url = typeof n?.url === 'string' ? n.url.trim() : ''
    if (!url || vistos.has(url) || urlsExistentes.has(url)) continue
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue
    } catch {
      continue
    }
    vistos.add(url)
    linhas.push({
      pesquisa_id: pesquisa.id,
      convenio_id: pesquisa.convenio_id,
      url,
      titulo: n?.titulo ? String(n.titulo).slice(0, 300) : null,
      tipo_norma: TIPOS_NORMA.has(n?.tipo_norma) ? n.tipo_norma : 'outro',
      numero: n?.numero ? String(n.numero).slice(0, 50) : null,
      ano: Number.isFinite(Number(n?.ano)) ? Number(n.ano) : null,
      ente_citado: n?.ente ? String(n.ente).slice(0, 200) : null,
      status: 'candidata',
      ordem: ordem++,
    })
  }

  if (linhas.length > 0) {
    const { error } = await admin.from('convenio_pesquisa_fontes').insert(linhas)
    if (error) throw error
  }

  if (linhas.length === 0) {
    await finalizarEtapa(pesquisa.id, pesquisa.lease_token, {
      status: 'concluida',
      etapa_msg: 'Nenhuma norma encontrada na busca.',
      progresso: 100,
      consulta: prompt.slice(0, 4000),
      modelo_pesquisa: resultado.modeloUsado,
      resumo: 'A pesquisa não encontrou nenhuma norma na web. Complete a Base de Conhecimento manualmente.',
      nao_encontrado: ['Nenhuma norma foi encontrada na busca.'],
      concluido_em: new Date().toISOString(),
    })
    return
  }

  await finalizarEtapa(pesquisa.id, pesquisa.lease_token, {
    status: 'baixando',
    etapa_msg: `${linhas.length} norma(s) candidata(s) encontrada(s). Baixando...`,
    progresso: 15,
    consulta: prompt.slice(0, 4000),
    modelo_pesquisa: resultado.modeloUsado,
  })
}

// origem='documento': não busca — cria 1 fonte a partir do documento já
// anexado (texto colado > arquivo do bucket > link) e segue no mesmo pipeline.
async function executarOrigemDocumento(pesquisa: PesquisaRow) {
  if (!pesquisa.documento_id) throw new Error('Pesquisa sem documento de origem.')
  const { data: doc, error } = await admin
    .from('convenio_documentos')
    .select('id, tipo, titulo, texto, url, arquivo_path, arquivo_mime')
    .eq('id', pesquisa.documento_id)
    .maybeSingle()
  if (error) throw error
  if (!doc) throw new Error('Documento não encontrado.')

  const fonteBase = {
    pesquisa_id: pesquisa.id,
    convenio_id: pesquisa.convenio_id,
    url: doc.url,
    titulo: doc.titulo,
    tipo_norma: doc.tipo === 'decreto' ? 'decreto' : 'outro',
    documento_id: doc.id,
    ordem: 0,
  }

  if (doc.texto && doc.texto.trim()) {
    const { error: insErr } = await admin.from('convenio_pesquisa_fontes').insert({
      ...fonteBase,
      texto_extraido: doc.texto,
      texto_hash: sha256(doc.texto),
      status: 'candidata', // ainda passa pela verificação do ente na próxima etapa
    })
    if (insErr) throw insErr
  } else if (doc.arquivo_path) {
    const { data: arquivo, error: dlErr } = await admin.storage.from(BUCKET).download(doc.arquivo_path)
    if (dlErr) throw dlErr
    const bytes = Buffer.from(await arquivo.arrayBuffer())
    const mime = doc.arquivo_mime || 'application/pdf'
    const { texto } = await extrairTexto(bytes, mime)
    const util = textoUtilSuficiente(texto)
    const { error: insErr } = await admin.from('convenio_pesquisa_fontes').insert({
      ...fonteBase,
      conteudo_mime: mime,
      arquivo_path: doc.arquivo_path, // reaproveita o arquivo já no bucket — não duplica
      tamanho: bytes.length,
      texto_extraido: util ? texto : null,
      texto_hash: util ? sha256(texto) : null,
      status: util ? 'candidata' : 'sem_texto',
    })
    if (insErr) throw insErr
  } else if (doc.url) {
    const { error: insErr } = await admin.from('convenio_pesquisa_fontes').insert({ ...fonteBase, status: 'candidata' })
    if (insErr) throw insErr
  } else {
    throw new Error('Documento sem texto, arquivo ou link — nada para ler.')
  }

  await finalizarEtapa(pesquisa.id, pesquisa.lease_token, {
    status: 'baixando',
    etapa_msg: 'Lendo o documento...',
    progresso: 20,
  })
}

// ---------------------------------------------------------------------------
// Etapa 2 — download (uma fonte "candidata" por passo) + verificação do ente
// ---------------------------------------------------------------------------
async function executarDownload(pesquisa: PesquisaRow) {
  const { data: fontes, error } = await admin
    .from('convenio_pesquisa_fontes')
    .select('*')
    .eq('pesquisa_id', pesquisa.id)
    .eq('status', 'candidata')
    .order('ordem')
    .limit(1)
  if (error) throw error
  const fonte = fontes?.[0]

  if (!fonte) {
    const proxima = await buscarProximaFonteParaExtrair(pesquisa.id)
    if (proxima) {
      await finalizarEtapa(pesquisa.id, pesquisa.lease_token, { status: 'extraindo', etapa_msg: 'Analisando o conteúdo das fontes...', progresso: 50 })
    } else {
      await concluirPesquisa(pesquisa)
    }
    return
  }

  await marcarEmAndamento(pesquisa.id, pesquisa.lease_token, { etapa_msg: `Baixando "${fonte.titulo || fonte.url || 'documento'}"...` })

  try {
    let texto: string | null = fonte.texto_extraido
    let mime: string | null = fonte.conteudo_mime
    let arquivoPath: string | null = fonte.arquivo_path
    let tamanho: number | null = fonte.tamanho

    if (!texto) {
      if (!fonte.url) throw new Error('Fonte sem URL e sem texto — nada para baixar.')
      const download = await baixarSeguro(fonte.url)
      mime = download.mime
      tamanho = download.bytes.length
      const extensao = mime === 'application/pdf' ? 'pdf' : mime === 'text/html' ? 'html' : 'txt'
      arquivoPath = `convenios/${pesquisa.convenio_id}/pesquisa/${fonte.id}/fonte.${extensao}`
      const { error: upErr } = await admin.storage.from(BUCKET).upload(arquivoPath, download.bytes, { contentType: mime, upsert: true })
      if (upErr) throw upErr
      const extraido = await extrairTexto(download.bytes, mime)
      texto = textoUtilSuficiente(extraido.texto) ? extraido.texto : null
    }

    if (!texto) {
      await admin
        .from('convenio_pesquisa_fontes')
        .update({ status: 'sem_texto', conteudo_mime: mime, arquivo_path: arquivoPath, tamanho, motivo: 'O documento não tem texto extraível (provavelmente PDF escaneado/imagem).' })
        .eq('id', fonte.id)
    } else {
      const contexto = await carregarContextoConvenio(pesquisa.convenio_id)
      const verificacao = verificarEnte(texto, contexto)
      await admin
        .from('convenio_pesquisa_fontes')
        .update({
          status: verificacao.status,
          conteudo_mime: mime,
          arquivo_path: arquivoPath,
          tamanho,
          texto_extraido: texto,
          texto_hash: sha256(texto),
          ente_detectado: verificacao.enteDetectado,
          uf_detectada: verificacao.ufDetectada,
          motivo: verificacao.motivo,
        })
        .eq('id', fonte.id)
    }
  } catch (e: any) {
    await admin.from('convenio_pesquisa_fontes').update({ status: 'falha_download', motivo: String(e?.message || e).slice(0, 500) }).eq('id', fonte.id)
  }

  const { count: restantes } = await admin
    .from('convenio_pesquisa_fontes')
    .select('id', { count: 'exact', head: true })
    .eq('pesquisa_id', pesquisa.id)
    .eq('status', 'candidata')

  await finalizarEtapa(pesquisa.id, pesquisa.lease_token, {
    status: (restantes || 0) > 0 ? 'baixando' : 'extraindo',
    etapa_msg: (restantes || 0) > 0 ? `Baixando fontes... (${restantes} restante(s))` : 'Analisando o conteúdo das fontes...',
    progresso: (restantes || 0) > 0 ? 30 : 50,
  })
}

// ---------------------------------------------------------------------------
// Etapa 3 — extração de sugestões (uma fonte verificada/confirmada por passo)
// ---------------------------------------------------------------------------
async function buscarProximaFonteParaExtrair(pesquisaId: string): Promise<any | null> {
  const { data, error } = await admin
    .from('convenio_pesquisa_fontes')
    .select('*')
    .eq('pesquisa_id', pesquisaId)
    .is('extraida_em', null)
    .in('status', ['verificada', 'nao_verificada'])
    .order('ordem')
  if (error) throw error
  return (data || []).find((f: any) => f.status === 'verificada' || (f.status === 'nao_verificada' && f.confirmada_em)) || null
}

async function executarExtracao(pesquisa: PesquisaRow) {
  const fonte = await buscarProximaFonteParaExtrair(pesquisa.id)
  if (!fonte) {
    await concluirPesquisa(pesquisa)
    return
  }

  if (!fonte.texto_extraido) {
    // não deveria acontecer (só entram aqui fontes com texto), mas evita loop infinito
    await admin.from('convenio_pesquisa_fontes').update({ extraida_em: new Date().toISOString() }).eq('id', fonte.id)
    await finalizarEtapa(pesquisa.id, pesquisa.lease_token, { status: 'extraindo', etapa_msg: 'Analisando o conteúdo das fontes...', progresso: 60 })
    return
  }

  const modelos = await lerModelosPesquisa()
  if (!modelos) throw new Error('Modelo de leitura não configurado — configure em IA do Workspace.')

  await marcarEmAndamento(pesquisa.id, pesquisa.lease_token, { status: 'extraindo', etapa_msg: `Lendo "${fonte.titulo || fonte.url || 'documento'}"...`, progresso: 60 })

  const [contexto, formasRes, publicosRes, convenioRes] = await Promise.all([
    carregarContextoConvenio(pesquisa.convenio_id),
    admin.from('formas_contrato').select('id, nome').eq('is_active', true),
    admin.from('publicos_atendidos').select('id, nome').eq('is_active', true).is('deleted_at', null),
    admin
      .from('convenios')
      .select('max_comprometimento_salarial, prazo_minimo_geral, prazo_maximo_geral, numero_servidores')
      .eq('id', pesquisa.convenio_id)
      .maybeSingle(),
  ])

  const catalogo: CatalogoExtracao = {
    formas: formasRes.data || [],
    publicos: publicosRes.data || [],
    valoresAtuais: {
      max_comprometimento_salarial: convenioRes.data?.max_comprometimento_salarial ?? null,
      prazo_minimo_geral: convenioRes.data?.prazo_minimo_geral ?? null,
      prazo_maximo_geral: convenioRes.data?.prazo_maximo_geral ?? null,
      numero_servidores: convenioRes.data?.numero_servidores ?? null,
    },
  }

  const prompt = montarPromptExtracao(contexto, fonte.texto_extraido, catalogo)
  const resultado = await chamarIaJson({
    apiKey: modelos.apiKey,
    modelo: modelos.modeloLeitura,
    mensagens: [{ role: 'user', content: prompt }],
    maxTokens: 6000,
  })

  const json = extrairJson<{ sugestoes?: any[] }>(resultado.texto)
  const sugestoesBrutas = Array.isArray(json.sugestoes) ? json.sugestoes : []

  const idsFormasValidas = new Set(catalogo.formas.map((f) => f.id))
  const idsPublicosValidos = new Set(catalogo.publicos.map((p) => p.id))
  const textoNormalizadoFonte = normalizarParaCitacao(fonte.texto_extraido)

  const linhasParaInserir: any[] = []
  for (const s of sugestoesBrutas) {
    const secao = String(s?.secao || '')
    const citacaoBruta = typeof s?.citacao === 'string' ? s.citacao.trim() : ''
    if (!['geral', 'publicos', 'formas', 'faq', 'observacao'].includes(secao)) continue
    if (citacaoBruta.length < 10) continue
    if (!textoNormalizadoFonte.includes(normalizarParaCitacao(citacaoBruta))) continue // citação precisa existir no texto — regra central da Fase 3

    let campo = ''
    let valor: Record<string, unknown> = {}

    if (secao === 'geral') {
      campo = String(s?.campo || '')
      if (!['max_comprometimento_salarial', 'prazo_minimo_geral', 'prazo_maximo_geral', 'numero_servidores'].includes(campo)) continue
      const numero = Number(s?.valor?.numero)
      if (!Number.isFinite(numero)) continue
      if (campo === 'max_comprometimento_salarial' && (numero <= 0 || numero > 100)) continue
      if (campo !== 'max_comprometimento_salarial' && (numero <= 0 || !Number.isInteger(numero))) continue
      valor = { numero }
    } else if (secao === 'formas') {
      const formaId = s?.valor?.forma_contrato_id
      const percentual = Number(s?.valor?.percentual_margem)
      if (!Number.isFinite(percentual) || percentual <= 0 || percentual > 100) continue
      campo = formaId && idsFormasValidas.has(formaId) ? `forma:${formaId}` : 'forma:?'
      valor = { forma_contrato_id: campo === 'forma:?' ? null : formaId, percentual_margem: percentual, nome_no_documento: s?.valor?.nome_no_documento || null }
    } else if (secao === 'publicos') {
      const publicoId = s?.valor?.publico_id
      campo = publicoId && idsPublicosValidos.has(publicoId) ? `publico:${publicoId}` : 'publico:?'
      valor = { publico_id: campo === 'publico:?' ? null : publicoId, nome_no_documento: s?.valor?.nome_no_documento || null }
    } else if (secao === 'faq') {
      campo = 'faq'
      const pergunta = String(s?.valor?.pergunta || '').trim()
      const resposta = String(s?.valor?.resposta || '').trim()
      if (!pergunta || !resposta) continue
      valor = { categoria: s?.valor?.categoria || null, pergunta, resposta }
    } else {
      campo = 'observacao'
      const textoObs = String(s?.valor?.texto || '').trim()
      if (!textoObs) continue
      valor = { texto: textoObs }
    }

    linhasParaInserir.push({
      pesquisa_id: pesquisa.id,
      convenio_id: pesquisa.convenio_id,
      fonte_id: fonte.id,
      secao,
      campo,
      valor,
      valor_atual: secao === 'geral' ? { numero: (catalogo.valoresAtuais as any)[campo] ?? null } : null,
      citacao: citacaoBruta.slice(0, 2000),
      artigo: s?.artigo ? String(s.artigo).slice(0, 100) : null,
    })
  }

  if (linhasParaInserir.length > 0) {
    const { error: insErr } = await admin.from('convenio_bc_sugestoes').insert(linhasParaInserir)
    if (insErr) throw insErr
  }

  await admin.from('convenio_pesquisa_fontes').update({ extraida_em: new Date().toISOString() }).eq('id', fonte.id)

  const proxima = await buscarProximaFonteParaExtrair(pesquisa.id)
  await finalizarEtapa(pesquisa.id, pesquisa.lease_token, {
    status: 'extraindo', // a próxima chamada detecta "sem próxima fonte" e conclui
    etapa_msg: proxima ? 'Analisando o conteúdo das fontes...' : 'Finalizando...',
    progresso: proxima ? 70 : 90,
    modelo_leitura: resultado.modeloUsado,
  })
}

// ---------------------------------------------------------------------------
// Conclusão
// ---------------------------------------------------------------------------
async function concluirPesquisa(pesquisa: PesquisaRow) {
  const [{ data: fontes }, { data: sugestoes }] = await Promise.all([
    admin.from('convenio_pesquisa_fontes').select('status').eq('pesquisa_id', pesquisa.id),
    admin.from('convenio_bc_sugestoes').select('id').eq('pesquisa_id', pesquisa.id),
  ])

  const porStatus = (fontes || []).reduce((acc: Record<string, number>, f: any) => {
    acc[f.status] = (acc[f.status] || 0) + 1
    return acc
  }, {})

  const partes: string[] = []
  if (porStatus.verificada) partes.push(`${porStatus.verificada} fonte(s) verificada(s)`)
  if (porStatus.ente_divergente) partes.push(`${porStatus.ente_divergente} fonte(s) descartada(s) por serem de outro ente`)
  if (porStatus.nao_verificada) partes.push(`${porStatus.nao_verificada} fonte(s) sem confirmação de ente (revise manualmente)`)
  if (porStatus.sem_texto) partes.push(`${porStatus.sem_texto} fonte(s) sem texto extraível`)
  if (porStatus.falha_download) partes.push(`${porStatus.falha_download} fonte(s) com falha no download`)
  partes.push(`${sugestoes?.length || 0} sugestão(ões) geradas para revisão`)

  const naoEncontrado: string[] = []
  if (!porStatus.verificada && !porStatus.nao_verificada) naoEncontrado.push('Nenhuma fonte confiável foi encontrada — preencha manualmente.')
  if ((sugestoes?.length || 0) === 0) naoEncontrado.push('Nenhuma sugestão foi extraída — confira as fontes ou complete manualmente.')

  await finalizarEtapa(pesquisa.id, pesquisa.lease_token, {
    status: 'concluida',
    etapa_msg: 'Pesquisa concluída.',
    progresso: 100,
    resumo: `${partes.join('; ')}.`,
    nao_encontrado: naoEncontrado,
    concluido_em: new Date().toISOString(),
  })
}

async function tratarErroEtapa(pesquisa: PesquisaRow, err: any) {
  const mensagem = String(err?.message || err || 'Erro desconhecido.').slice(0, 1000)
  const tentativas = (pesquisa.tentativas || 0) + 1
  await admin
    .from('convenio_pesquisas')
    .update({
      status: tentativas >= MAX_TENTATIVAS ? 'erro' : pesquisa.status,
      erro: mensagem,
      tentativas,
      lease_token: null,
      lease_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', pesquisa.id)
    .eq('lease_token', pesquisa.lease_token)
}

// ---------------------------------------------------------------------------
// Entrada pública — uma chamada avança UMA etapa
// ---------------------------------------------------------------------------
export async function avancarPesquisa(pesquisaId?: string): Promise<any | null> {
  const { data: claimed, error: claimErr } = await admin.rpc('convenio_pesquisas_claim', {
    p_id: pesquisaId ?? null,
    p_limite: 1,
    p_lease_segundos: 90,
  })
  if (claimErr) throw claimErr
  const pesquisa = (Array.isArray(claimed) ? claimed[0] : claimed) as PesquisaRow | undefined
  if (!pesquisa) return null

  try {
    if (pesquisa.status === 'pendente' || pesquisa.status === 'buscando') {
      if (pesquisa.origem === 'documento') await executarOrigemDocumento(pesquisa)
      else await executarBusca(pesquisa)
    } else if (pesquisa.status === 'baixando') {
      await executarDownload(pesquisa)
    } else if (pesquisa.status === 'extraindo') {
      await executarExtracao(pesquisa)
    }
  } catch (e: any) {
    await tratarErroEtapa(pesquisa, e)
  }

  const { data: atual } = await admin.from('convenio_pesquisas').select('*').eq('id', pesquisa.id).maybeSingle()
  return atual
}

/**
 * Cron `/api/cron/convenio-pesquisas` (a cada 2 min) — retoma pesquisas
 * paradas (lease vencido, ex.: função anterior derrubada no meio). Cada
 * chamada de `avancarPesquisa()` sem id já faz "claim de 1" via a RPC;
 * repetir em loop dentro do orçamento de tempo cobre várias pesquisas
 * paradas na mesma execução do cron sem precisar de um claim multi-linha.
 */
export async function rodarWorkerPesquisas(): Promise<{ processadas: number }> {
  const inicio = Date.now()
  let processadas = 0
  while (Date.now() - inicio < 50_000 && processadas < 10) {
    const resultado = await avancarPesquisa()
    if (!resultado) break
    processadas++
  }
  return { processadas }
}
