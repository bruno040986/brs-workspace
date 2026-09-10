'use client'

import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import type { ConvenioBc, InstituicaoAtiva } from '../../bc-actions'
import type { OrgaoEmpregador } from '../../cadastros-actions'

export default function OrgaosRestricoesTab({
  convenioId,
  bc,
  orgaosTodos,
  instituicoesAtivas,
}: {
  convenioId: string
  bc: ConvenioBc
  orgaosTodos: OrgaoEmpregador[]
  instituicoesAtivas: InstituicaoAtiva[]
}) {
  function nomeIf(id: string) {
    return instituicoesAtivas.find((i) => i.id === id)?.name || '(instituição inativa)'
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div className="card" style={{ padding: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ fontWeight: 800 }}>Órgãos do Convênio</div>
          <Link href={`/convenios/orgaos?convenio=${convenioId}`} className="btn btn-outline btn-sm">
            <ExternalLink size={14} />
            Gerenciar Órgãos
          </Link>
        </div>
        {orgaosTodos.length === 0 ? (
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.85rem' }}>
            Nenhum órgão cadastrado para este convênio. Cadastre um órgão só quando uma instituição financeira restringir o
            atendimento a ele (ex.: Embrapa dentro do SIAPE) — na aba Instituições, ao criar a restrição.
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Órgão</th>
                  <th>Status</th>
                  <th>Aparece em (Instituição · Modo)</th>
                </tr>
              </thead>
              <tbody>
                {orgaosTodos.map((o) => {
                  const referencias = bc.instituicoes
                    .filter((inst) => inst.orgaos.includes(o.id))
                    .map((inst) => `${nomeIf(inst.financial_institution_id)} · ${inst.modo_orgaos === 'somente' ? 'atende somente' : 'não atende'}`)
                  return (
                    <tr key={o.id}>
                      <td style={{ fontWeight: 600 }}>{o.nome}</td>
                      <td>
                        <span className={`badge ${o.is_active ? 'badge-success' : 'badge-gray'}`}>{o.is_active ? 'Ativo' : 'Inativo'}</span>
                      </td>
                      <td style={{ fontSize: '0.85rem' }}>{referencias.length > 0 ? referencias.join(' · ') : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
