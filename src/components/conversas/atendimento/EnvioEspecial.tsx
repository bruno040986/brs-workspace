'use client'

import { useRef, useState } from 'react'
import { BarChart3, Contact, Image as ImageIcon, MapPin, Plus, Smile } from 'lucide-react'
import { enviarEspecialConversa, type EnvioEspecial } from '@/lib/central-conversas/grupos-actions'

type Tipo = 'localizacao' | 'contato' | 'enquete' | 'figurinha' | 'visualizacaoUnica'

const ITENS: Array<{ tipo: Tipo; rotulo: string; Icone: typeof MapPin }> = [
  { tipo: 'localizacao', rotulo: 'Localização', Icone: MapPin },
  { tipo: 'contato', rotulo: 'Contato', Icone: Contact },
  { tipo: 'enquete', rotulo: 'Enquete', Icone: BarChart3 },
  { tipo: 'figurinha', rotulo: 'Figurinha (imagem)', Icone: Smile },
  { tipo: 'visualizacaoUnica', rotulo: 'Foto de visualização única', Icone: ImageIcon },
]

const MAX_IMAGEM = 5 * 1024 * 1024

function lerComoDataUrl(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('Não foi possível ler a imagem.'))
    r.readAsDataURL(arquivo)
  })
}

/** Menu "+" do composer (B2): localização, contato, enquete, figurinha e foto de visualização única. Só Baileys (o servidor recusa o resto com mensagem clara). */
export default function EnvioEspecialMenu({ conversationId, onEnviado, onErro }: { conversationId: number; onEnviado: () => void; onErro: (mensagem: string) => void }) {
  const [menuAberto, setMenuAberto] = useState(false)
  const [tipo, setTipo] = useState<Tipo | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  // Uma chave por intenção: reenviar depois de "incerto" reaproveita a MESMA (não duplica); fechar/abrir gera outra.
  const operationId = useRef<string>('')

  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [nomeLocal, setNomeLocal] = useState('')
  const [nomeContato, setNomeContato] = useState('')
  const [telefone, setTelefone] = useState('')
  const [pergunta, setPergunta] = useState('')
  const [opcoes, setOpcoes] = useState(['', ''])
  const [multipla, setMultipla] = useState(false)
  const [imagem, setImagem] = useState<File | null>(null)

  function abrir(t: Tipo) {
    operationId.current = globalThis.crypto.randomUUID()
    setErro(null)
    setMenuAberto(false)
    setTipo(t)
  }
  function fechar() {
    setTipo(null)
    setImagem(null)
  }

  async function enviar() {
    if (!tipo) return
    setErro(null)
    let envio: EnvioEspecial
    try {
      if (tipo === 'localizacao') envio = { tipo, lat: Number(lat.replace(',', '.')), lng: Number(lng.replace(',', '.')), nome: nomeLocal || undefined }
      else if (tipo === 'contato') envio = { tipo, nome: nomeContato, telefone }
      else if (tipo === 'enquete') envio = { tipo, pergunta, opcoes: opcoes.filter((o) => o.trim()), multipla }
      else {
        if (!imagem) return setErro('Escolha uma imagem.')
        if (imagem.size > MAX_IMAGEM) return setErro('A imagem passa de 5 MB.')
        envio = { tipo, imagemBase64: await lerComoDataUrl(imagem) }
      }
    } catch (e) {
      return setErro(e instanceof Error ? e.message : 'Dados inválidos.')
    }
    setEnviando(true)
    const r = await enviarEspecialConversa(conversationId, envio, operationId.current).catch(() => ({ ok: false as const, error: 'Falha ao comunicar com o servidor.' }))
    setEnviando(false)
    if (!r.ok) return setErro(r.error)
    fechar()
    onEnviado()
  }

  function usarMinhaLocalizacao() {
    navigator.geolocation?.getCurrentPosition(
      (p) => {
        setLat(String(p.coords.latitude))
        setLng(String(p.coords.longitude))
      },
      () => onErro('Não foi possível obter sua localização (permita o acesso no navegador).'),
    )
  }

  const rotulo = ITENS.find((i) => i.tipo === tipo)?.rotulo
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" className="brs-messenger-toolbar-btn" onClick={() => setMenuAberto((v) => !v)} title="Mais tipos de mensagem">
        <Plus size={13} />
      </button>
      {menuAberto && (
        <div className="brs-messenger" style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 4, zIndex: 60, padding: 4, minWidth: 210, background: 'var(--msn-surface)', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,.18)' }} data-brs-messenger-ignore-close="true">
          {ITENS.map(({ tipo: t, rotulo: r, Icone }) => (
            <button key={t} type="button" onClick={() => abrir(t)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 10px', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--msn-text)', borderRadius: 4, textAlign: 'left' }}>
              <Icone size={14} /> {r}
            </button>
          ))}
        </div>
      )}
      {tipo && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'grid', placeItems: 'center', zIndex: 400 }} data-brs-messenger-ignore-close="true">
          <div className="brs-messenger" style={{ width: 360, maxWidth: '92vw', borderRadius: 6, overflow: 'hidden' }} data-brs-messenger-ignore-close="true">
            <div className="brs-messenger-titlebar"><span>{rotulo}</span></div>
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--msn-surface)' }}>
              {tipo === 'localizacao' && (
                <>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="brs-messenger-input" placeholder="Latitude" value={lat} onChange={(e) => setLat(e.target.value)} />
                    <input className="brs-messenger-input" placeholder="Longitude" value={lng} onChange={(e) => setLng(e.target.value)} />
                  </div>
                  <button type="button" className="brs-messenger-pill-btn" onClick={usarMinhaLocalizacao}><MapPin size={12} /> Usar minha localização</button>
                  <input className="brs-messenger-input" placeholder="Nome do local (opcional)" value={nomeLocal} onChange={(e) => setNomeLocal(e.target.value)} />
                </>
              )}
              {tipo === 'contato' && (
                <>
                  <input className="brs-messenger-input" placeholder="Nome do contato" value={nomeContato} onChange={(e) => setNomeContato(e.target.value)} />
                  <input className="brs-messenger-input" placeholder="Telefone com DDD (ex.: 61 99999-1234)" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
                </>
              )}
              {tipo === 'enquete' && (
                <>
                  <input className="brs-messenger-input" placeholder="Pergunta" value={pergunta} onChange={(e) => setPergunta(e.target.value)} />
                  {opcoes.map((o, i) => (
                    <input key={i} className="brs-messenger-input" placeholder={`Opção ${i + 1}`} value={o} onChange={(e) => setOpcoes((p) => p.map((x, j) => (j === i ? e.target.value : x)))} />
                  ))}
                  {opcoes.length < 12 && <button type="button" className="brs-messenger-pill-btn" onClick={() => setOpcoes((p) => [...p, ''])}><Plus size={12} /> Adicionar opção</button>}
                  <label style={{ fontSize: 12 }}><input type="checkbox" checked={multipla} onChange={(e) => setMultipla(e.target.checked)} /> Permitir mais de uma resposta</label>
                </>
              )}
              {(tipo === 'figurinha' || tipo === 'visualizacaoUnica') && (
                <>
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setImagem(e.target.files?.[0] ?? null)} />
                  <div style={{ fontSize: 11, color: 'var(--msn-muted)' }}>
                    {tipo === 'figurinha' ? 'A imagem é convertida em figurinha (WebP 512×512).' : 'O destinatário só consegue abrir a foto uma vez.'}
                  </div>
                </>
              )}
              {erro && <div style={{ fontSize: 11.5, color: '#dc2626' }}>{erro}</div>}
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button type="button" className="brs-messenger-toolbar-btn" onClick={fechar} disabled={enviando}>Cancelar</button>
                <button type="button" className="brs-messenger-primary-button" style={{ padding: '3px 12px' }} onClick={() => void enviar()} disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
