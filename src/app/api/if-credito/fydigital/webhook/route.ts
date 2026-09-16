/**
 * Receptor do webhook da FyDigital (URL a cadastrar no suporte deles,
 * tecnologia@fy.digital: {domínio}/api/if-credito/fydigital/webhook?key=…).
 *
 * Fail-closed pela ?key= (mesmo padrão Nuvidio/Assinafy) — é a 1ª barreira,
 * porque a doc deles não define um segredo de webhook próprio. A validação
 * "de verdade" seria a assinatura RS256 (a doc chama de "criptografia", mas
 * é JWT::decode com a chave pública da API deles); só que os exemplos de
 * webhook na doc mostram JSON legível, não uma string JWT — então esta
 * rota aceita os dois formatos: tenta verificar como JWT primeiro (marca
 * assinatura_valida=true se validar), senão usa o JSON puro tal como veio.
 * NUNCA descarta um evento por não conseguir classificar — é assim que a
 * descoberta fixa o formato real antes do fluxo de produção (Fatia 4
 * completa: mapa de enum, correlação por request_id, automação Nuvidio).
 */
import { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { decifrarTexto } from '@/lib/central-conversas/cofre'
import { obterInstituicaoFyDigital, verificarAssinaturaFyDigital } from '@/lib/if-credito/fydigital/client'

export const dynamic = 'force-dynamic'

function primeiro(obj: any, caminho: string): any {
  const partes = caminho.split('.')
  let atual = obj
  for (const p of partes) {
    if (atual == null) return undefined
    atual = atual[p]
  }
  return atual
}

function extrairTexto(obj: any, caminhos: string[]): string {
  for (const c of caminhos) {
    let v = primeiro(obj, c)
    if (Array.isArray(v)) v = v[0]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

export async function POST(req: NextRequest) {
  try {
    const inst = await obterInstituicaoFyDigital()
    if (!inst) return Response.json({ ok: false, error: 'FyDigital não cadastrada' }, { status: 503 })

    const admin = await createAdminClient()
    const { data: cfgRow } = await admin
      .from('if_credito_config')
      .select('webhook_key, api_public_key_enc')
      .eq('instituicao_financeira_id', inst.id)
      .maybeSingle()

    const esperado = String(cfgRow?.webhook_key || '')
    if (!esperado) return Response.json({ ok: false, error: 'webhook key not configured' }, { status: 503 })
    const recebido = req.nextUrl.searchParams.get('key') || ''
    if (recebido !== esperado) return Response.json({ ok: false, error: 'invalid key' }, { status: 401 })

    const bruto = await req.text()
    let payload: any = null
    let assinaturaValida = false

    // Tenta JWT primeiro (chave pública da API) — se validar, o payload
    // decodificado é a fonte da verdade.
    if (cfgRow?.api_public_key_enc) {
      try {
        const apiPublicKey = decifrarTexto(String(cfgRow.api_public_key_enc))
        const candidato = bruto.replace(/^"|"$/g, '').trim()
        const decodificado = verificarAssinaturaFyDigital(candidato, apiPublicKey)
        if (decodificado !== null) {
          payload = decodificado
          assinaturaValida = true
        }
      } catch {
        // segue pro fallback de JSON puro abaixo
      }
    }

    // Fallback: JSON legível (é o formato que os exemplos da doc mostram).
    if (payload === null) {
      try {
        payload = bruto ? JSON.parse(bruto) : {}
      } catch {
        payload = null
      }
    }

    if (payload === null) {
      // Nem JSON válido nem JWT reconhecível — grava mesmo assim, nunca perde.
      await admin.from('if_webhook_eventos').insert({
        instituicao_financeira_id: inst.id,
        webhook: 'desconhecido',
        payload: { raw: bruto.slice(0, 5000) },
        assinatura_valida: false,
        evento_hash: createHash('sha256').update(bruto || randomFallback()).digest('hex'),
      })
      return Response.json({ received: true, parsed: false })
    }

    const webhook = extrairTexto(payload, ['webhook']) || 'desconhecido'
    const tipoWebhook = extrairTexto(payload, ['tipo_webhook']) || null
    const requestId = extrairTexto(payload, ['request_id']) || null
    const idExterno =
      extrairTexto(payload, [
        'proposta.id_proposta',
        'proposta.0.id_proposta',
        'id_proposta_consignado',
        'identificador',
        'simulacao.id_simulacao',
      ]) ||
      (typeof payload?.proposta === 'string' || typeof payload?.proposta === 'number' ? String(payload.proposta) : '') ||
      null

    const evento_hash = createHash('sha256')
      .update(JSON.stringify({ webhook, requestId, idExterno, payload }))
      .digest('hex')

    const { error } = await admin.from('if_webhook_eventos').insert({
      instituicao_financeira_id: inst.id,
      webhook,
      tipo_webhook: tipoWebhook,
      request_id: requestId,
      id_externo: idExterno,
      payload,
      assinatura_valida: assinaturaValida,
      evento_hash,
    })
    // Índice único em evento_hash: reentrega do mesmo evento não é erro.
    if (error && !/duplicate|unique/i.test(String(error.message || ''))) {
      console.error('Erro ao gravar webhook FyDigital:', error.message)
    }

    return Response.json({ received: true, webhook, assinatura_valida: assinaturaValida })
  } catch (error: any) {
    console.error('Erro no webhook da FyDigital:', error?.message)
    return Response.json({ ok: false }, { status: 200 })
  }
}

function randomFallback(): string {
  return `vazio-${Date.now()}-${Math.random()}`
}

export async function GET() {
  return Response.json({ ok: true, endpoint: 'fydigital-webhook' })
}
