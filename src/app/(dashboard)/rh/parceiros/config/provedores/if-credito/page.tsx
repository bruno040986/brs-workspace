'use client'

/**
 * Provedores e APIs › APIs de Instituições Financeiras de Crédito.
 * Cada IF tem campos de integração próprios (a FyDigital exige OAuth +
 * assinatura RS256 + 3 chaves; outras IFs vão exigir outra coisa) — por isso
 * NÃO existe um formulário genérico com seletor de IF. Só as IFs com "API
 * Disponível" marcada no cadastro (Instituições Financeiras › Conexão de
 * API) aparecem aqui: a FyDigital ganha um card DEDICADO (FyDigitalCard.tsx —
 * credencial + teste de autenticação + descoberta + webhook, ver
 * fydigital-actions.ts); as demais aparecem como card simples (logo + "API
 * não configurada") até ganharem seu próprio adaptador. Credenciais no
 * cofre AES, write-only. Permissão: sistema-config-if-credito.
 */
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Banknote, Landmark, Loader2 } from 'lucide-react'
import { listarInstituicoesConfig, type InstituicaoConfigResumo } from '@/lib/if-credito/config-actions'
import { AmigozCard } from './AmigozCard'
import { FyDigitalCard } from './FyDigitalCard'

// "FyDigital" não tem acento em nenhuma variação plausível de cadastro —
// só normaliza caixa e remove espaços/pontuação antes de comparar.
function ehFyDigital(nome: string): boolean {
  const n = nome.toLowerCase().replace(/[^a-z0-9]/g, '')
  return n.includes('fydigital')
}

// Amigoz (grupo Pine): card dedicado com login de operador + corban.
function ehAmigoz(nome: string): boolean {
  return nome.toLowerCase().replace(/[^a-z0-9]/g, '').includes('amigoz')
}

function LogoBox({ logoUrl, nome, size = 44 }: { logoUrl: string; nome: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, border: '1px solid var(--brs-gray-200)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: '#fff', flexShrink: 0 }}>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={nome} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      ) : (
        <Landmark size={size * 0.45} style={{ color: 'var(--brs-gray-300)' }} />
      )}
    </div>
  )
}

export default function IfCreditoConfigPage() {
  const [instituicoes, setInstituicoes] = useState<InstituicaoConfigResumo[]>([])
  const [carregandoLista, setCarregandoLista] = useState(true)
  const [erroLista, setErroLista] = useState('')

  useEffect(() => {
    listarInstituicoesConfig()
      .then((res) => {
        if (!res.success) {
          setErroLista(res.error || 'Sem permissão.')
          return
        }
        setInstituicoes(res.data || [])
      })
      .catch(() => setErroLista('Erro ao carregar instituições.'))
      .finally(() => setCarregandoLista(false))
  }, [])

  const fyDigital = instituicoes.find((i) => ehFyDigital(i.name)) || null
  const amigoz = instituicoes.find((i) => ehAmigoz(i.name)) || null
  const outras = instituicoes.filter((i) => i.id !== fyDigital?.id && i.id !== amigoz?.id)

  return (
    <div style={{ maxWidth: 880 }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 0.35rem', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Banknote size={24} /> APIs de Instituições Financeiras de Crédito
      </h1>
      <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.88rem', margin: '0 0 1.25rem' }}>
        Credenciais das APIs de propostas de crédito — cifradas no cofre, usadas só pelo servidor. As propostas
        criadas por essas integrações aparecem no <strong>Painel de Operações</strong>. Só aparecem aqui as IFs com
        "API Disponível" marcada em <Link href="/instituicoes-financeiras" style={{ color: 'var(--brs-navy)' }}>Instituições Financeiras</Link> › Conexão de API.
      </p>

      {erroLista && <div className="card" style={{ padding: '0.8rem 1rem', marginBottom: '1rem', borderLeft: '4px solid var(--brs-danger)', color: 'var(--brs-danger)', fontWeight: 600 }}>{erroLista}</div>}

      {carregandoLista ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brs-gray-400)', padding: '2rem' }}><Loader2 size={18} className="animate-spin" /> Carregando…</div>
      ) : (
        <>
          {fyDigital ? (
            <FyDigitalCard instituicao={fyDigital} onAtualizado={(patch) => setInstituicoes((prev) => prev.map((i) => (i.id === fyDigital.id ? { ...i, ...patch } : i)))} />
          ) : (
            <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <LogoBox logoUrl="" nome="FyDigital" />
              <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-500)' }}>
                A FyDigital ainda não está marcada como "API Disponível" no cadastro de Instituições Financeiras — marque
                lá para configurar a credencial aqui.
              </div>
            </div>
          )}

          {amigoz && (
            <AmigozCard
              instituicao={amigoz}
              logo={<LogoBox logoUrl={amigoz.logo_url} nome={amigoz.name} size={48} />}
              onAtualizado={(patch) => setInstituicoes((prev) => prev.map((i) => (i.id === amigoz.id ? { ...i, ...patch } : i)))}
            />
          )}

          {outras.length > 0 && (
            <>
              <h2 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--brs-gray-500)', textTransform: 'uppercase', letterSpacing: '0.03em', margin: '0 0 0.75rem' }}>
                Outras IFs com API disponível
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem' }}>
                {outras.map((i) => (
                  <div key={i.id} className="card" style={{ padding: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
                    <LogoBox logoUrl={i.logo_url} nome={i.name} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{i.name}</div>
                      <span className="badge badge-gray" style={{ marginTop: 4 }}>
                        {i.temConfig ? (i.ativo ? 'Configurada' : 'Configuração inativa') : 'API não configurada'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
