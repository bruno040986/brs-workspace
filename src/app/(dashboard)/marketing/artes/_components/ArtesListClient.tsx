'use client'

/**
 * Biblioteca de Artes — lista (staff). Cadastro/edição no ArteEditor.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ImageOff, Loader2, Palette, Pencil, Plus, ToggleLeft, ToggleRight } from 'lucide-react'
import { listarArtes, setArteStatus, type MarketingArte } from '@/lib/marketing/artes-actions'

export default function ArtesListClient() {
  const [artes, setArtes] = useState<MarketingArte[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')

  async function carregar() {
    try {
      const res = await listarArtes()
      if (!res.success) throw new Error(res.error)
      setArtes(res.data || [])
      setErro('')
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao carregar.')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    carregar()
  }, [])

  async function toggle(a: MarketingArte) {
    await setArteStatus(a.id, !a.is_active)
    await carregar()
  }

  const filtradas = artes.filter((a) => {
    if (!busca.trim()) return true
    const destinosTxt = (a.destinos || []).map((d) => `${d.grupo} ${d.categoria} ${d.formato}`).join(' ')
    return `${a.nome} ${a.convenio_nome || ''} ${a.tipo_convenio_nome || ''} ${a.formato_rotulo || ''} ${destinosTxt}`
      .toLowerCase()
      .includes(busca.toLowerCase())
  })

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Palette size={22} /> Biblioteca de Artes
        </h1>
        <input className="form-control" style={{ width: 260 }} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, categoria, convênio…" />
        <Link href="/marketing/artes/nova" className="btn btn-primary" style={{ marginLeft: 'auto' }}>
          <Plus size={15} /> Nova Arte
        </Link>
      </div>

      {erro && <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-danger)', marginBottom: '1rem', color: 'var(--brs-danger)', fontWeight: 600 }}>{erro}</div>}

      {carregando ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brs-gray-400)', padding: '2rem 0' }}><Loader2 size={18} className="animate-spin" /> Carregando…</div>
      ) : filtradas.length === 0 ? (
        <div className="card" style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--brs-gray-400)' }}>
          Nenhuma arte cadastrada. Crie a primeira — o parceiro personaliza com o próprio logotipo no portal.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.9rem' }}>
          {filtradas.map((a) => (
            <div key={a.id} className="card" style={{ padding: 0, overflow: 'hidden', opacity: a.is_active ? 1 : 0.55 }}>
              <div style={{ aspectRatio: `${a.largura_px} / ${a.altura_px}`, background: 'var(--brs-gray-100)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {a.imagem_signed_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.imagem_signed_url} alt={a.nome} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <ImageOff size={28} style={{ color: 'var(--brs-gray-400)' }} />
                )}
              </div>
              <div style={{ padding: '0.7rem' }}>
                <div style={{ fontWeight: 700, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.nome}</div>
                <div style={{ fontSize: '0.68rem', color: 'var(--brs-gray-400)', marginTop: 2 }}>
                  {[a.formato_rotulo, (a.destinos && a.destinos.length ? `${a.destinos.length} destino(s)` : ''), a.convenio_nome, `${a.elementos.length} elem.`].filter(Boolean).join(' · ')}
                </div>
                <div style={{ display: 'flex', gap: 4, marginTop: '0.5rem' }}>
                  <Link href={`/marketing/artes/${a.id}`} className="btn btn-outline btn-sm" style={{ flex: 1, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Pencil size={13} /> Editar
                  </Link>
                  <button className="btn btn-ghost btn-icon" title={a.is_active ? 'Inativar' : 'Ativar'} onClick={() => toggle(a)}>
                    {a.is_active ? <ToggleRight size={18} style={{ color: 'var(--brs-success)' }} /> : <ToggleLeft size={18} style={{ color: 'var(--brs-gray-400)' }} />}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
