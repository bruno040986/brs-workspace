/**
 * Convênio — Base de Conhecimento, Fase 3 (Jarvis pesquisador).
 * Spec: docs/SPEC-CONVENIO-BASE-CONHECIMENTO.md §6.4.
 *
 * Download de URL protegido contra SSRF. As URLs vêm da SAÍDA de um modelo
 * de IA (busca na web) — sem esta blindagem, seria possível a IA (por erro
 * ou injeção) devolver uma URL apontando para a rede interna da Vercel/
 * Supabase e o servidor "vazar" essa resposta pro atacante.
 */
import dns from 'node:dns'
import net from 'node:net'

const MAX_BYTES = 15 * 1024 * 1024
const TIMEOUT_MS = 20_000
const MAX_REDIRECTS = 3
const USER_AGENT = 'BRSWorkspaceJarvisBot/1.0 (+https://gestao.brspromotora.com.br)'
const MIMES_ACEITOS = new Set(['application/pdf', 'text/html', 'text/plain'])

export type DownloadResultado = { bytes: Buffer; mime: string; urlFinal: string }

function ipv4ParaNumero(ip: string): number {
  const partes = ip.split('.').map(Number)
  return (((partes[0] << 24) | (partes[1] << 16) | (partes[2] << 8) | partes[3]) >>> 0)
}

// Faixas privadas/reservadas — RFC 1918, loopback, link-local, CGNAT (RFC
// 6598), "this network", benchmarking, multicast/reservado.
const FAIXAS_IPV4: [string, number][] = [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['100.64.0.0', 10],
  ['0.0.0.0', 8],
  ['192.0.0.0', 24],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

function ipv4EmFaixaBloqueada(ip: string): boolean {
  const n = ipv4ParaNumero(ip)
  return FAIXAS_IPV4.some(([base, bits]) => {
    const mascara = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
    return (n & mascara) === (ipv4ParaNumero(base) & mascara)
  })
}

function ipv6EmFaixaBloqueada(ip: string): boolean {
  const normalizado = ip.toLowerCase()
  if (normalizado === '::1' || normalizado === '::') return true
  if (/^fe[89ab]/.test(normalizado)) return true // fe80::/10 (link-local)
  if (/^f[cd]/.test(normalizado)) return true // fc00::/7 (unique local)
  const mapeado = normalizado.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapeado) return ipv4EmFaixaBloqueada(mapeado[1])
  return false
}

function enderecoBloqueado(ip: string): boolean {
  if (net.isIPv4(ip)) return ipv4EmFaixaBloqueada(ip)
  if (net.isIPv6(ip)) return ipv6EmFaixaBloqueada(ip)
  return true // formato não reconhecido → bloqueia por segurança
}

async function resolverEChecar(hostname: string): Promise<void> {
  if (net.isIP(hostname)) {
    if (enderecoBloqueado(hostname)) throw new Error(`Endereço bloqueado: ${hostname}.`)
    return
  }
  let enderecos: { address: string }[]
  try {
    enderecos = await dns.promises.lookup(hostname, { all: true })
  } catch {
    throw new Error(`Não foi possível resolver o host "${hostname}".`)
  }
  if (enderecos.length === 0) throw new Error(`Não foi possível resolver o host "${hostname}".`)
  for (const { address } of enderecos) {
    if (enderecoBloqueado(address)) {
      throw new Error(`O host "${hostname}" resolve para um endereço interno/privado (${address}) — download bloqueado.`)
    }
  }
}

function validarUrl(urlStr: string): URL {
  let url: URL
  try {
    url = new URL(urlStr)
  } catch {
    throw new Error('URL inválida.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Só URLs http/https são aceitas.')
  }
  return url
}

export async function baixarSeguro(urlOriginal: string): Promise<DownloadResultado> {
  let urlAtual = validarUrl(urlOriginal)

  for (let salto = 0; salto <= MAX_REDIRECTS; salto++) {
    await resolverEChecar(urlAtual.hostname)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(urlAtual.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/pdf,text/html,text/plain;q=0.9,*/*;q=0.1' },
      })
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new Error('Download excedeu o tempo limite (20s).')
      throw new Error(`Falha de rede ao baixar: ${e?.message || e}`)
    } finally {
      clearTimeout(timeoutId)
    }

    if (res.status >= 300 && res.status < 400) {
      const local = res.headers.get('location')
      if (!local) throw new Error('Redirecionamento sem cabeçalho Location.')
      if (salto === MAX_REDIRECTS) throw new Error('Excesso de redirecionamentos (máx. 3).')
      urlAtual = validarUrl(new URL(local, urlAtual).toString())
      continue
    }

    if (!res.ok) throw new Error(`Falha ao baixar (HTTP ${res.status}).`)

    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    const contentLength = Number(res.headers.get('content-length') || 0)
    if (contentLength > MAX_BYTES) throw new Error('Arquivo maior que 15 MB.')

    if (!res.body) throw new Error('Resposta sem corpo.')
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        if (total > MAX_BYTES) {
          await reader.cancel().catch(() => {})
          throw new Error('Arquivo maior que 15 MB.')
        }
        chunks.push(value)
      }
    }
    const bytes = Buffer.concat(chunks.map((c) => Buffer.from(c)))

    const assinaturaPdf = bytes.subarray(0, 4).toString('latin1') === '%PDF'
    let mime: string
    if (contentType === 'application/pdf' || assinaturaPdf) {
      if (!assinaturaPdf) throw new Error('O conteúdo dizia ser PDF mas não tem a assinatura %PDF — recusado.')
      mime = 'application/pdf'
    } else if (MIMES_ACEITOS.has(contentType)) {
      mime = contentType
    } else {
      throw new Error(`Tipo de conteúdo não aceito: "${contentType || 'desconhecido'}".`)
    }

    return { bytes, mime, urlFinal: urlAtual.toString() }
  }

  throw new Error('Falha ao baixar o documento.')
}
