/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { nomeCompletoValido, somenteDigitos, telefoneBrValido, telefoneParaE164Digitos } from '@/lib/promocoes/validacao'
import {
  LIMITE_EXCEDIDO,
  LINK_INVALIDO,
  PRAZO_ENCERRADO,
  carregarGeracao,
  erro,
  ipDe,
  lerSnapshot,
  limiteExcedido,
  numerosDaGeracao,
  numerosValidosDoTitular,
  registrarEvento,
  NO_STORE,
  tokenValido,
  uaDe,
} from '@/lib/promocoes/geracao-publico'
import { formatarNumeroSorte, hashToken } from '@/lib/promocoes/codigos'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

async function resposta(admin: any, g: any, token: string) {
  const [numeros, validos] = await Promise.all([numerosDaGeracao(admin, g.id), numerosValidosDoTitular(admin, g)])
  return NextResponse.json({ numeros: numeros.map(formatarNumeroSorte), totalNumeros: validos.length, comprovanteToken: token }, { headers: NO_STORE })
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return erro(422, 'DADOS_INVALIDOS', 'Dados inválidos.')
  if (body.site) return NextResponse.json({ ok: true })

  const { t, submissionId, telefoneConfirmacao, dados, aceiteRegulamento, regulamentoVersao } = body
  if (!tokenValido(t) || typeof submissionId !== 'string' || !UUID.test(submissionId)) return LINK_INVALIDO()

  const admin: any = await createAdminClient()
  const ip = ipDe(request)
  if (await limiteExcedido(admin, `rl:geracao:ip:${ip}`, 300, 600)) return LIMITE_EXCEDIDO()

  const carregada = await carregarGeracao(admin, t, true)
  if (!carregada || (body.campanha && carregada.campanha?.slug !== body.campanha)) return LINK_INVALIDO()
  const { g, campanha } = carregada

  // repetição do mesmo envio (duplo clique, retry de rede): devolve o resultado já gerado
  if (g.status === 'usado') return g.submission_id === submissionId ? resposta(admin, g, t) : LINK_INVALIDO()
  if (carregada.estado === 'invalido') return LINK_INVALIDO()
  if (carregada.estado === 'encerrado') return PRAZO_ENCERRADO()

  if (aceiteRegulamento !== true || typeof regulamentoVersao !== 'string' || !regulamentoVersao) {
    return erro(409, 'ACEITE_OBRIGATORIO', 'É necessário aceitar o regulamento para gerar os números.')
  }

  if (regulamentoVersao !== campanha.regulamento_versao) {
    return erro(409, 'REGULAMENTO_DESATUALIZADO', 'O regulamento foi atualizado. Recarregue a página e aceite novamente.')
  }

  const campos: Array<{ campo: string; msg: string }> = []
  const nome = String(dados?.nome || '').trim()
  const telefone = somenteDigitos(String(dados?.telefone || ''))
  const email = String(dados?.email || '').trim()
  if (!nomeCompletoValido(nome)) campos.push({ campo: 'nome', msg: 'Informe o nome completo.' })
  if (!telefoneBrValido(telefone.replace(/^55(?=\d{10,11}$)/, ''))) campos.push({ campo: 'telefone', msg: 'Informe um WhatsApp válido com DDD.' })
  if (email && !EMAIL.test(email)) campos.push({ campo: 'email', msg: 'E-mail inválido.' })
  if (campos.length) return erro(422, 'DADOS_INVALIDOS', 'Confira os dados informados.', { campos })

  const hash = hashToken(t)
  if (await limiteExcedido(admin, `rl:geracao-tel:${hash}`, 5, 21600)) {
    return erro(423, 'LINK_BLOQUEADO', 'Muitas tentativas de confirmação. Fale com a NuAzul.')
  }
  if (!/^\d{4}$/.test(String(telefoneConfirmacao || '')) || String(g.telefone).slice(-4) !== telefoneConfirmacao) {
    return erro(422, 'TELEFONE_NAO_CONFERE', 'Os 4 últimos dígitos do WhatsApp não conferem.')
  }

  // reserva o submissionId neste link (um link = uma tentativa em andamento)
  const { data: reservada } = await admin
    .from('promocao_geracoes')
    .update({ submission_id: submissionId })
    .eq('id', g.id)
    .in('status', ['pendente', 'enviado'])
    .or(`submission_id.is.null,submission_id.eq.${submissionId}`)
    .select('id')
  if (!reservada?.length) return LINK_INVALIDO()

  const dadosConfirmados = {
    nome,
    telefone: telefoneParaE164Digitos(telefone) || telefone,
    email: email || null,
    aceiteRegulamento: true,
    regulamentoVersao: campanha.regulamento_versao,
  }
  const { error } = await admin.rpc('promocao_gerar_numeros', {
    p_geracao_id: g.id,
    p_token_hash: hash,
    p_dados: dadosConfirmados,
    p_ip: ip,
    p_ua: uaDe(request),
  })

  if (error) {
    const msg = String(error.message || '')
    if (msg.includes('LINK_INVALIDO')) {
      const { data: atual } = await admin.from('promocao_geracoes').select('status, submission_id').eq('id', g.id).maybeSingle()
      if (atual?.status === 'usado' && atual.submission_id === submissionId) return resposta(admin, g, t)
      return LINK_INVALIDO()
    }
    await admin.from('promocao_geracoes').update({ submission_id: null }).eq('id', g.id).in('status', ['pendente', 'enviado'])
    if (msg.includes('SERIE_ESGOTADA')) return erro(500, 'SERIE_ESGOTADA', 'Não foi possível gerar os números agora. Fale com a NuAzul.')
    console.error('promocao_gerar_numeros falhou', g.id, msg)
    return erro(500, 'ERRO_INTERNO', 'Não foi possível gerar os números agora. Tente novamente.')
  }

  // pós-geração: nada aqui pode desfazer os números já gerados
  try {
    await admin.from('promocao_aceites').insert({
      campanha_id: g.campanha_id,
      sujeito_tipo: 'geracao',
      sujeito_id: g.id,
      finalidade: 'regulamento_geracao',
      aceito: true,
      versao_texto: campanha.regulamento_versao,
      ip,
      user_agent: uaDe(request),
    })
    if (g.titular_tipo === 'inscricao' && email) await admin.from('promocao_inscricoes').update({ email }).eq('id', g.titular_id)
    await registrarEvento(admin, g, 'geracao.confirmada', { qtd: g.qtd, regulamentoVersao, usadoNesta: lerSnapshot(g.snapshot).usadoNestaCentavos, campanha: campanha.slug })
  } catch (e: any) {
    console.error('promocao geracao pos-processamento falhou', g.id, e?.message)
  }

  return resposta(admin, g, t)
}
