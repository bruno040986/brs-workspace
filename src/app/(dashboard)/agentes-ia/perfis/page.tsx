import Link from 'next/link'
import { carregarTipos } from '../actions'

export const dynamic = 'force-dynamic'

export default async function PerfisPage() {
  const tipos = await carregarTipos()
  return (
    <div className="page-content">
      <h1 style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--brs-gray-900)', margin: 0 }}>Criar Agentes de IA</h1>
      <p style={{ fontSize: '0.85rem', color: 'var(--brs-gray-500)', margin: '0.25rem 0 1rem' }}>
        Tipos de agente e o perfil padrão de fábrica de cada um. Cada parceiro parte deste padrão e personaliza só o que quiser no CRM.
      </p>
      <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {tipos.map((t) => (
          <Link key={t.tipo} href={`/agentes-ia/perfis/${t.tipo}`} className="card" style={{ padding: '1rem 1.25rem', textDecoration: 'none', color: 'inherit' }}>
            <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)' }}>{t.nome}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)', margin: '0.25rem 0' }}>{t.descricao}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--brs-gray-500)' }}>{t.versao ? `Perfil padrão v${t.versao}` : 'Sem perfil padrão'}{t.ativo ? '' : ' · inativo'}</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
