import { AlertTriangle } from 'lucide-react'
import { getCatalogoCertificacoes, listarVencimentos } from './actions'

export const dynamic = 'force-dynamic'

/**
 * Agente Corban › Certificações — versão inicial (fatia 3, Fable): leitura do
 * catálogo e dos vencimentos. A edição (3 abas + upload de logotipo) segue o
 * roteiro em docs/ROTEIRO-FATIA-3-CERTIFICACOES.md (Sonnet).
 */
export default async function CertificacoesPage() {
  const [catalogo, vencimentos] = await Promise.all([getCatalogoCertificacoes(), listarVencimentos(60)])

  if (!catalogo.success) {
    return (
      <div className="page-content">
        <div className="card" style={{ padding: '1.25rem', color: '#991B1B' }}>{catalogo.error}</div>
      </div>
    )
  }
  const tipoNome = new Map(catalogo.tipos.map((t) => [t.id, t.nome]))
  const certificadoraNome = new Map(catalogo.certificadoras.map((c) => [c.id, c.nome]))

  return (
    <div className="page-content">
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--brs-gray-900)', margin: 0 }}>Certificações</h1>
        <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-500)' }}>
          Certificadoras, tipos (com a marcação de obrigatório) e certificações que cada uma cobre. Lançamentos por pessoa acontecem na Análise de
          cada cadastro. Tela de edição em construção — ver roteiro da fatia 3.
        </div>
      </div>

      <div style={{ display: 'grid', gap: '1rem' }}>
        <div className="card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Certificadoras</div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Logotipo</th>
                <th>Nome</th>
                <th>Site</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {catalogo.certificadoras.map((c) => (
                <tr key={c.id}>
                  <td>{c.logotipo_url ? <img src={c.logotipo_url} alt={c.nome} style={{ height: 24 }} /> : <span style={{ color: 'var(--brs-gray-400)' }}>—</span>}</td>
                  <td style={{ fontWeight: 600 }}>{c.nome}</td>
                  <td>
                    {c.site ? (
                      <a href={c.site} target="_blank" rel="noreferrer">
                        {c.site}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{c.is_active ? 'Ativa' : 'Inativa'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Tipos de certificação</div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Obrigatório</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {catalogo.tipos.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 600 }}>{t.nome}</td>
                  <td>{t.obrigatorio ? <span className="badge badge-danger">Obrigatório</span> : '—'}</td>
                  <td>{t.is_active ? 'Ativo' : 'Inativo'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Certificações</div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Certificadora</th>
                <th>Certificação</th>
                <th>Cobre os tipos</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {catalogo.certificacoes.map((c) => (
                <tr key={c.id}>
                  <td>{certificadoraNome.get(c.certificadora_id) || '—'}</td>
                  <td style={{ fontWeight: 600 }}>{c.nome}</td>
                  <td>{c.tipo_ids.map((id) => tipoNome.get(id)).filter(Boolean).join(', ') || '—'}</td>
                  <td>{c.is_active ? 'Ativa' : 'Inativa'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontWeight: 700, marginBottom: '0.5rem', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <AlertTriangle size={16} style={{ color: '#b45309' }} /> Vencimentos em até 60 dias (inclui vencidas)
          </div>
          {!vencimentos.success ? (
            <div style={{ color: '#991B1B' }}>{vencimentos.error}</div>
          ) : vencimentos.rows.length === 0 ? (
            <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-500)' }}>Nenhuma certificação conferida vence nos próximos 60 dias.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Pessoa</th>
                  <th>CPF</th>
                  <th>Certificação</th>
                  <th>Validade</th>
                  <th>Dias</th>
                  <th>Parceiro</th>
                </tr>
              </thead>
              <tbody>
                {vencimentos.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.nome || '—'}</td>
                    <td style={{ fontFamily: 'monospace' }}>{r.cpf}</td>
                    <td>
                      {r.certificacao_nome} <span style={{ color: 'var(--brs-gray-400)' }}>{r.certificadora_nome}</span>
                    </td>
                    <td>{r.data_validade.split('-').reverse().join('/')}</td>
                    <td style={{ color: r.dias < 0 ? '#b91c1c' : '#b45309', fontWeight: 700 }}>{r.dias < 0 ? `vencida há ${-r.dias}` : r.dias}</td>
                    <td>{r.agente_nome || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
